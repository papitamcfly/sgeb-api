import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { SsoError } from '#modules/identidad/errores_sso'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LÍMITE DE PETICIONES POR IP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El bloqueo por cuenta ya existía: cinco intentos fallidos en diez minutos y
 * el usuario queda bloqueado quince. Pero **eso no detiene el ataque
 * distribuido sobre muchas cuentas**: probar tres contraseñas contra mil
 * correos nunca dispara un bloqueo por cuenta, y era el hueco real.
 *
 * Esto lo cierra por el otro eje: cuántas veces puede una misma IP tocar los
 * endpoints sensibles, sin importar contra qué cuenta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  POR QUÉ EN LA BASE Y NO EN MEMORIA
 * ────────────────────────────────────────────────────────────────────────────
 * Un contador en memoria se pierde al reiniciar y no se comparte entre
 * procesos: bastaría con esperar un despliegue, o tener suerte con el balanceo,
 * para reiniciar la cuenta. En la base sobrevive a ambos.
 *
 * El costo es una escritura por petición sensible. Son unas decenas por minuto
 * en el peor caso —el login no es un endpoint de alto tráfico— y a cambio el
 * límite es real.
 *
 * Si algún día el volumen lo justifica, esto se cambia por Redis sin tocar a
 * quien lo llama.
 */

/**
 * Ventanas por acción. Deliberadamente generosas: un capitán que se equivoca
 * tres veces de contraseña y luego pide recuperación no debe toparse con esto.
 *
 * `login` permite 20 en 15 minutos. Un humano rara vez pasa de 5; 20 deja
 * margen para varias personas tras el mismo NAT —el WiFi de un salón— sin abrir
 * la puerta a un ataque, que necesitaría miles.
 */
const LIMITES: Record<string, { max: number; ventanaMin: number }> = {
  login: { max: 20, ventanaMin: 15 },
  verificacion: { max: 30, ventanaMin: 15 },
  recuperacion: { max: 5, ventanaMin: 60 },
  registro: { max: 10, ventanaMin: 60 },
  token: { max: 60, ventanaMin: 15 },
  publico: { max: 40, ventanaMin: 10 },
}

export class LimitePeticionesService {
  /**
   * Registra el intento y lanza SSO-4009 si se pasó del límite.
   *
   * Se cuenta **antes** de procesar, no después: contar solo los fallidos
   * dejaría pasar un ataque que acierta de vez en cuando, y contar después
   * permitiría al atacante saturar el endpoint aunque nunca llegue a contarse.
   */
  async exigir(accion: string, ip: string | null | undefined): Promise<void> {
    const limite = LIMITES[accion]
    if (!limite || !ip) return

    const desde = DateTime.now().minus({ minutes: limite.ventanaMin })

    try {
      const [{ n }] = await db
        .from('auth.peticion_ip')
        .where('ip', ip)
        .where('accion', accion)
        .where('creado_en', '>=', desde.toSQL())
        .count('* as n')

      const usados = Number(n)

      if (usados >= limite.max) {
        throw new SsoError('SSO-4009', {
          tecnico:
            `IP ${ip} superó el límite de '${accion}': ${usados}/${limite.max} ` +
            `en ${limite.ventanaMin} min. Ventana desde ${desde.toISO()}.`,
        })
      }

      await db.table('auth.peticion_ip').insert({ ip, accion })
    } catch (error) {
      if (error instanceof SsoError) throw error
      /**
       * Un fallo del limitador **no bloquea la petición**. Si la tabla no
       * responde, es peor dejar a todo el mundo fuera que aceptar una petición
       * sin contar: el bloqueo por cuenta sigue activo por debajo.
       */
      logger.error({ err: error, accion, ip }, 'Fallo al aplicar el límite por IP')
    }
  }

  /**
   * Purga los registros fuera de toda ventana. La ejecuta `sso:purgar`.
   *
   * Sin esto la tabla crece sin límite: es la única del módulo que recibe una
   * fila por petición.
   */
  async purgar(): Promise<number> {
    const masLarga = Math.max(...Object.values(LIMITES).map((l) => l.ventanaMin))
    const r = await db
      .from('auth.peticion_ip')
      .where('creado_en', '<', DateTime.now().minus({ minutes: masLarga * 2 }).toSQL())
      .delete()
    return Array.isArray(r) ? Number(r[0] ?? 0) : Number(r)
  }

  /** Cuántos intentos le quedan a una IP. Para diagnóstico, no para el cliente. */
  async restantes(accion: string, ip: string): Promise<number | null> {
    const limite = LIMITES[accion]
    if (!limite) return null

    const [{ n }] = await db
      .from('auth.peticion_ip')
      .where('ip', ip)
      .where('accion', accion)
      .where('creado_en', '>=', DateTime.now().minus({ minutes: limite.ventanaMin }).toSQL())
      .count('* as n')

    return Math.max(0, limite.max - Number(n))
  }
}
