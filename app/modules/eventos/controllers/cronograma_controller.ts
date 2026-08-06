import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { CronogramaService } from '#modules/eventos/services/cronograma_service'
import {
  hitoValidator,
  hitoParcialValidator,
} from '#modules/eventos/validators/cronograma_validator'

@inject()
export default class CronogramaController {
  constructor(private cronograma: CronogramaService) {}

  async listar(ctx: HttpContext) {
    return responder.lista(ctx, await this.cronograma.listar(ctx.request.param('id_evento')))
  }

  async crear(ctx: HttpContext) {
    const datos = await hitoValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.cronograma.crear(ctx.request.param('id_evento'), datos))
  }

  async actualizar(ctx: HttpContext) {
    const datos = await hitoParcialValidator.validate(ctx.request.body())
    const h = await this.cronograma.actualizar(
      ctx.request.param('id_evento'),
      ctx.request.param('id_hito'),
      datos
    )
    return responder.ok(ctx, h)
  }

  async eliminar(ctx: HttpContext) {
    await this.cronograma.eliminar(ctx.request.param('id_evento'), ctx.request.param('id_hito'))
    return responder.ok(ctx, null, `CRONOGRAMA_EVENTO id=${ctx.request.param('id_hito')} eliminado.`)
  }
}
