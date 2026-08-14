import { DateTime } from 'luxon'
import { randomInt, createHash, randomBytes } from 'node:crypto'
import hash from '@adonisjs/core/services/hash'
import { inject } from '@adonisjs/core'
import { CorreoService } from '#shared/services/correo_service'
import db from '@adonisjs/lucid/services/db'
import Usuario from '#modules/identidad/models/usuario'
import IntentoLogin, { type MotivoFallo } from '#modules/identidad/models/intento_login'
import BloqueoCuenta from '#modules/identidad/models/bloqueo_cuenta'
import CodigoVerificacion from '#modules/identidad/models/codigo_verificacion'
import DispositivoConfiable from '#modules/identidad/models/dispositivo_confiable'
import { SsoError } from '#modules/identidad/errores_sso'

/**
 * Autenticación por credenciales y segundo factor.
 *
 * **Este servicio solo lo consume la pantalla del proveedor** (rutas bajo
 * `/interno/`). Ninguna aplicación cliente lo llama: las apps nunca ven la
 * contraseña del usuario. Si aparece una llamada desde el panel React o desde
 * iOS, es un defecto de arquitectura.
 */

const MAX_INTENTOS = 5
const VENTANA_INTENTOS_MIN = 10
const BLOQUEO_MIN = 15
const VIDA_CODIGO_MIN = 10
const MAX_INTENTOS_CODIGO = 5
const MAX_REENVIOS = 3
const ESPERA_REENVIO_SEG = 60
const DIAS_DISPOSITIVO_CONFIABLE = 30

export type ResultadoLogin =
  | { estado: 'autenticado'; usuario: Usuario; metodoLogin: 'password' | 'password_2fa' }
  | { estado: 'verificacion_requerida'; usuario: Usuario; ticket2fa: string }

@inject()
export class CredencialesService {
  constructor(private correo: CorreoService) {}

  /**
   * Valida correo y contraseña.
   *
   * Nunca revela cuál de los dos falló: un mensaje distinto para "correo no
   * existe" convertiría el login en un enumerador de cuentas. Por la misma
   * razón, cuando el correo no existe se hace igualmente una verificación de
   * hash contra un valor ficticio — sin eso, la diferencia de tiempo delata
   * qué correos están registrados.
   */
  async autenticar(opciones: {
    correo: string
    password: string
    cliente: 'web' | 'movil'
    tokenDispositivo?: string | null
    ip?: string | null
    userAgent?: string | null
  }): Promise<ResultadoLogin> {
    const correo = opciones.correo.trim().toLowerCase()

    const usuario = await Usuario.query().where('correo', correo).preload('rol').first()

    // ── Bloqueo vigente: se revisa ANTES que las credenciales ──────────────
    if (usuario) {
      const bloqueo = await this.bloqueoVigente(usuario.id)
      if (bloqueo) {
        await this.registrarIntento({
          usuario,
          correo,
          exitoso: false,
          motivo: 'bloqueo_temporal',
          codigo: 'SSO-1008',
          ip: opciones.ip,
          userAgent: opciones.userAgent,
        })
        throw new SsoError('SSO-1008', {
          tecnico:
            `Cuenta bloqueada hasta ${bloqueo.fin?.toISO() ?? 'indefinido'}. ` +
            `motivo=${bloqueo.motivo}, intentos=${bloqueo.intentosAcumulados}. id_bloqueo=${bloqueo.id}.`,
        })
      }
    }

    /** Hash ficticio con el mismo costo, para igualar tiempos. */
    const hashComparar =
      usuario?.passwordHash ??
      '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123'

    const coincide = await hash.verify(hashComparar, opciones.password).catch(() => false)

    if (!usuario || !coincide) {
      await this.registrarIntento({
        usuario,
        correo,
        exitoso: false,
        motivo: 'credenciales_invalidas',
        codigo: 'SSO-1001',
        ip: opciones.ip,
        userAgent: opciones.userAgent,
      })
      await this.evaluarBloqueo(correo, usuario?.id)

      throw new SsoError('SSO-1001', {
        tecnico:
          `Login fallido para '${correo}': ` +
          `${usuario ? 'hash Bcrypt no coincide' : 'correo inexistente'}. ` +
          `Nunca revelar cuál de los dos al usuario.`,
      })
    }

    if (!usuario.activo) {
      await this.registrarIntento({
        usuario,
        correo,
        exitoso: false,
        motivo: 'cuenta_desactivada',
        codigo: 'SSO-1005',
        ip: opciones.ip,
        userAgent: opciones.userAgent,
      })
      throw new SsoError('SSO-1005', {
        tecnico: `USUARIO.activo=0 para id_usuario=${usuario.id}. Bloqueo de acceso (RF-6).`,
      })
    }

    // ── Dispositivo confiable vigente: se omite el 2FA ─────────────────────
    if (opciones.tokenDispositivo) {
      const disp = await DispositivoConfiable.query()
        .where('token_hash', this.hash(opciones.tokenDispositivo))
        .where('id_usuario', usuario.id)
        .where('activo', true)
        .first()

      if (disp && disp.expiraEn > DateTime.now()) {
        disp.ultimoUso = DateTime.now()
        await disp.save()
        await this.registrarIntento({
          usuario,
          correo,
          exitoso: true,
          ip: opciones.ip,
          userAgent: opciones.userAgent,
        })
        return { estado: 'autenticado', usuario, metodoLogin: 'password' }
      }
      /**
       * Un dispositivo caducado NO es error terminal (SSO-1014): el flujo
       * continúa hacia la verificación en dos pasos, solo que sin atajo.
       */
    }

    const ticket2fa = await this.emitirCodigo(usuario, 'login')
    await this.registrarIntento({
          usuario,
          correo,
          exitoso: true,
          ip: opciones.ip,
          userAgent: opciones.userAgent,
        })
    return { estado: 'verificacion_requerida', usuario, ticket2fa }
  }

  /**
   * Emite un código de 6 dígitos e invalida los anteriores del mismo usuario y
   * propósito. Si no se invalidaran, un código viejo seguiría sirviendo y la
   * ventana de ataque se multiplicaría por cada reenvío.
   */
  async emitirCodigo(usuario: Usuario, proposito: 'login' | 'registro'): Promise<string> {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0')

    await db.transaction(async (trx) => {
      await CodigoVerificacion.query({ client: trx })
        .where('id_usuario', usuario.id)
        .where('proposito', proposito)
        .where('usado', false)
        .update({ usado: true })

      await CodigoVerificacion.create(
        {
          idUsuario: usuario.id,
          codigoHash: await hash.make(codigo),
          proposito,
          canal: 'correo',
          intentosFallidos: 0,
          reenvios: 0,
          usado: false,
          expiraEn: DateTime.now().plus({ minutes: VIDA_CODIGO_MIN }),
        },
        { client: trx }
      )
    })

    /**
     * El envío ocurre FUERA de la transacción que guardó el código, a propósito.
     *
     * Si fallara dentro, el rollback borraría el código y el usuario recibiría
     * un error genérico. Así el código queda guardado y el fallo se reporta como
     * SSO-5003, que le dice al usuario que reintente el envío en vez de volver a
     * capturar sus credenciales.
     *
     * En modo `log` el código se escribe en el registro. Sin eso no habría forma
     * de completar el flujo al desarrollar, y la alternativa —desactivar el
     * segundo factor en desarrollo— haría que se probara un flujo distinto del
     * que corre en producción, que es justo donde aparecen los errores de
     * cableado.
     */
    await this.correo.codigoVerificacion(usuario.correo, codigo)

    return codigo
  }

  /** Verifica el código de 6 dígitos (pantalla S3). */
  async verificarCodigo(opciones: {
    idUsuario: number
    codigo: string
    proposito: 'login' | 'registro'
  }): Promise<Usuario> {
    /**
     * Efectos que deben SOBREVIVIR al throw. Marcarlos aquí y aplicarlos en el
     * `finally` es la única forma: hacerlos dentro de la transacción los
     * deshace el rollback que provoca la excepción, y el contador de intentos
     * nunca subiría — dejando la ventana abierta a probar el código de seis
     * dígitos sin límite.
     */
    let incrementarIntentoDe: number | null = null
    let invalidarCodigo: number | null = null

    try {
      return await db.transaction(async (trx) => {
      const fila = await CodigoVerificacion.query({ client: trx })
        .where('id_usuario', opciones.idUsuario)
        .where('proposito', opciones.proposito)
        .where('usado', false)
        .orderBy('id_codigo', 'desc')
        .forUpdate()
        .first()

      if (!fila) {
        throw new SsoError('SSO-1010', {
          tecnico: `Sin CODIGO_VERIFICACION vigente para id_usuario=${opciones.idUsuario}, proposito=${opciones.proposito}.`,
        })
      }

      if (fila.expiraEn < DateTime.now()) {
        invalidarCodigo = fila.id
        throw new SsoError('SSO-1010', {
          tecnico: `Código expirado el ${fila.expiraEn.toISO()}. id_codigo=${fila.id}.`,
        })
      }

      if (fila.intentosFallidos >= MAX_INTENTOS_CODIGO) {
        invalidarCodigo = fila.id
        throw new SsoError('SSO-1010', {
          tecnico: `Código invalidado: ${fila.intentosFallidos} intentos fallidos (tope ${MAX_INTENTOS_CODIGO}).`,
        })
      }

      if (!(await hash.verify(fila.codigoHash, opciones.codigo).catch(() => false))) {
        incrementarIntentoDe = fila.id
        throw new SsoError('SSO-1009', {
          tecnico:
            `Código incorrecto. Intento ${fila.intentosFallidos + 1} de ${MAX_INTENTOS_CODIGO}. ` +
            `id_codigo=${fila.id}. Nunca loguear el valor capturado.`,
        })
      }

      fila.usado = true
      await fila.useTransaction(trx).save()

      const usuario = await Usuario.query({ client: trx })
        .where('id_usuario', opciones.idUsuario)
        .preload('rol')
        .firstOrFail()

      return usuario
      })
    } finally {
      if (invalidarCodigo !== null) {
        await CodigoVerificacion.query().where('id_codigo', invalidarCodigo).update({ usado: true })
      }
      if (incrementarIntentoDe !== null) {
        await db
          .from('auth.codigo_verificacion')
          .where('id_codigo', incrementarIntentoDe)
          .increment('intentos_fallidos', 1)
      }
    }
  }

  /** Reenvío con tope y espera mínima, para que no sirva de amplificador de correo. */
  async reenviarCodigo(idUsuario: number, proposito: 'login' | 'registro'): Promise<string> {
    const fila = await CodigoVerificacion.query()
      .where('id_usuario', idUsuario)
      .where('proposito', proposito)
      .where('usado', false)
      .orderBy('id_codigo', 'desc')
      .first()

    if (fila) {
      const segundos = DateTime.now().diff(fila.creadoEn, 'seconds').seconds
      if (segundos < ESPERA_REENVIO_SEG) {
        throw new SsoError('SSO-1011', {
          tecnico: `Reenvío pedido a los ${Math.round(segundos)} s; mínimo ${ESPERA_REENVIO_SEG} s.`,
        })
      }
      if (fila.reenvios >= MAX_REENVIOS) {
        throw new SsoError('SSO-1011', {
          tecnico: `Tope de reenvíos alcanzado (${MAX_REENVIOS}) para id_codigo=${fila.id}.`,
        })
      }
    }

    const usuario = await Usuario.query().where('id_usuario', idUsuario).preload('rol').firstOrFail()
    const codigo = await this.emitirCodigo(usuario, proposito)

    if (fila) {
      await CodigoVerificacion.query()
        .where('id_usuario', idUsuario)
        .where('proposito', proposito)
        .where('usado', false)
        .update({ reenvios: fila.reenvios + 1 })
    }
    return codigo
  }

  /** Registra "recordar este equipo" y devuelve el token para el cliente. */
  async confiarDispositivo(opciones: {
    idUsuario: number
    plataforma: 'web' | 'ios' | 'android'
    nombre?: string | null
    userAgent?: string | null
  }): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    await DispositivoConfiable.create({
      idUsuario: opciones.idUsuario,
      tokenHash: this.hash(token),
      nombreDispositivo: opciones.nombre ?? null,
      plataforma: opciones.plataforma,
      userAgent: opciones.userAgent ?? null,
      expiraEn: DateTime.now().plus({ days: DIAS_DISPOSITIVO_CONFIABLE }),
      activo: true,
    })
    return token
  }

  // ── internos ────────────────────────────────────────────────────────────

  private async bloqueoVigente(idUsuario: number): Promise<BloqueoCuenta | null> {
    const b = await BloqueoCuenta.query()
      .where('id_usuario', idUsuario)
      .where('activo', true)
      .orderBy('id_bloqueo', 'desc')
      .first()

    if (!b) return null

    // Un bloqueo temporal ya vencido se cierra solo al consultarlo.
    if (b.fin && b.fin < DateTime.now()) {
      b.activo = false
      await b.save()
      return null
    }
    return b
  }

  /**
   * Cuenta los fallos recientes **por correo**, no por usuario: así también se
   * frena a quien prueba contraseñas contra una cuenta que no existe, que de
   * otro modo tendría intentos ilimitados.
   */
  private async evaluarBloqueo(correo: string, idUsuario?: number): Promise<void> {
    if (!idUsuario) return

    const desde = DateTime.now().minus({ minutes: VENTANA_INTENTOS_MIN })
    const [{ n }] = await db
      .from('auth.intento_login')
      .where('correo_capturado', correo)
      .where('exitoso', false)
      .where('timestamp', '>=', desde.toSQL()!)
      .count('* as n')

    if (Number(n) >= MAX_INTENTOS) {
      await BloqueoCuenta.create({
        idUsuario,
        motivo: 'intentos_excedidos',
        intentosAcumulados: Number(n),
        inicio: DateTime.now(),
        fin: DateTime.now().plus({ minutes: BLOQUEO_MIN }),
        activo: true,
      })
    }
  }

  private async registrarIntento(o: {
    usuario?: Usuario | null
    correo: string
    exitoso: boolean
    motivo?: MotivoFallo
    codigo?: string
    ip?: string | null
    userAgent?: string | null
  }): Promise<void> {
    await IntentoLogin.create({
      idUsuario: o.usuario?.id ?? null,
      correoCapturado: o.correo,
      metodo: 'password',
      exitoso: o.exitoso,
      motivoFallo: o.motivo ?? null,
      codigoError: o.codigo ?? null,
      ip: o.ip ?? null,
      userAgent: o.userAgent?.slice(0, 255) ?? null,
    })
  }

  private hash(valor: string): string {
    return createHash('sha256').update(valor).digest('hex')
  }
}
