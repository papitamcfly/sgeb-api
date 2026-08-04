import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Purga los artefactos efímeros del módulo de identidad ya vencidos.
 *
 *   node ace sso:purgar
 *
 * Pensado para una tarea programada diaria. Sin ella, `flujo_autorizacion` y
 * `codigo_autorizacion` crecen sin límite: viven 10 minutos y 60 segundos
 * respectivamente, así que cada login abandonado deja basura permanente.
 *
 * Lo que NO se purga, a propósito:
 *   · INTENTO_LOGIN  — es la bitácora que sostiene el bloqueo por fuerza bruta
 *                      y la única evidencia para investigar un incidente.
 *   · BLOQUEO_CUENTA — histórico de bloqueos; se marca inactivo, no se borra.
 *   · REFRESH_TOKEN  — un token revocado debe seguir existiendo para DETECTAR
 *                      su reúso. Borrarlo haría que un token robado se viera
 *                      igual que uno inventado y se perdería la señal de robo.
 */
export default class SsoPurgar extends BaseCommand {
  static commandName = 'sso:purgar'
  static description = 'Elimina flujos, códigos y tokens de recuperación vencidos'
  static options: CommandOptions = { startApp: true }

  async run() {
    const db = (await import('@adonisjs/lucid/services/db')).default
    const ahora = new Date().toISOString()

    const flujos = await db.from('auth.flujo_autorizacion').where('expira_en', '<', ahora).delete()
    const codigos = await db.from('auth.codigo_autorizacion').where('expira_en', '<', ahora).delete()
    const recuperacion = await db
      .from('auth.token_recuperacion')
      .where('expira_en', '<', ahora)
      .delete()
    const verificacion = await db
      .from('auth.codigo_verificacion')
      .where('expira_en', '<', ahora)
      .delete()

    /** Las sesiones vencidas se marcan revocadas antes de borrarse, por si algo las consulta. */
    const sesiones = await db
      .from('auth.sesion_sso')
      .where('expira_en', '<', ahora)
      .delete()

    this.logger.success(
      `Purgado: ${flujos} flujos, ${codigos} códigos de autorización, ` +
        `${verificacion} códigos 2FA, ${recuperacion} tokens de recuperación, ${sesiones} sesiones.`
    )
  }
}
