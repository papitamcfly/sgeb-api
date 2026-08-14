import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Dispara los hitos del cronograma cuya hora ya llegó.
 *
 *   node ace cronograma:disparar
 *
 * Pensado para correr cada minuto durante los eventos. Es idempotente: un hito
 * ya disparado no vuelve a notificar, así que dos ejecuciones solapadas —o un
 * reinicio a media ejecución— no producen avisos duplicados.
 *
 * Peor que no avisar es avisar de más: el mesero deja de confiar en el aviso y
 * empieza a ignorarlo.
 */
export default class CronogramaDisparar extends BaseCommand {
  static commandName = 'cronograma:disparar'
  static description = 'Notifica los hitos del cronograma que ya vencieron'
  static options: CommandOptions = { startApp: true }

  async run() {
    const { CronogramaService } = await import('#modules/eventos/services/cronograma_service')
    const servicio = await this.app.container.make(CronogramaService)

    const n = await servicio.dispararVencidos()

    if (n === 0) this.logger.info('Sin hitos vencidos.')
    else this.logger.success(`${n} hitos disparados.`)
  }
}
