import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { CronogramaService } from '#modules/eventos/services/cronograma_service'

@inject()
export default class NotificacionesController {
  constructor(private cronograma: CronogramaService) {}

  /**
   * Bandeja del usuario autenticado. El sujeto sale del token: nadie consulta
   * las notificaciones de otro.
   */
  async listar(ctx: HttpContext) {
    const leida = ctx.request.input('leida')
    const r = await this.cronograma.listarNotificaciones(ctx.sujeto.uuid, {
      leida: leida === undefined ? undefined : leida === 'true',
    })
    return responder.ok(ctx, r)
  }

  async marcarLeida(ctx: HttpContext) {
    const n = await this.cronograma.marcarLeida(
      ctx.request.param('id_notificacion'),
      ctx.sujeto.uuid
    )
    return responder.ok(ctx, n)
  }
}
