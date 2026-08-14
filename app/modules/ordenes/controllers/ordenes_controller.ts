import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { OrdenService } from '#modules/ordenes/services/orden_service'
import {
  crearOrdenValidator,
  estadoOrdenValidator,
  reporteValidator,
} from '#modules/ordenes/validators/orden_validator'

@inject()
export default class OrdenesController {
  constructor(private ordenes: OrdenService) {}

  /** Tablero de barra y fuente de la sección "barra" del dashboard. */
  async listarPorEvento(ctx: HttpContext) {
    const filas = await this.ordenes.listarPorEvento(ctx.request.param('id_evento'), {
      estado: ctx.request.input('estado'),
      idMesa: ctx.request.input('id_mesa'),
    })
    return responder.lista(ctx, filas)
  }

  async mostrar(ctx: HttpContext) {
    return responder.ok(ctx, await this.ordenes.obtener(ctx.request.param('id_orden')))
  }

  async crear(ctx: HttpContext) {
    const datos = await crearOrdenValidator.validate(ctx.request.body())
    return responder.creado(
      ctx,
      await this.ordenes.crear({ ...datos, idMesa: Number(ctx.request.param('id_mesa')) })
    )
  }

  async cambiarEstado(ctx: HttpContext) {
    const { estado } = await estadoOrdenValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.ordenes.cambiarEstado(ctx.request.param('id_orden'), estado))
  }

  /**
   * Calcula la receta y devuelve las instrucciones para el Cubaitor.
   *
   * Hoy la respuesta viaja al cliente, que las reenvía al dispositivo. Cuando
   * exista el cliente MQTT, el servidor las publicará directamente en el broker
   * y esta respuesta quedará solo como confirmación.
   *
   * Si algún insumo no alcanza, NADA se dispensa: la orden se pausa entera
   * (SGEB-4008/4009) en vez de servir medio vaso.
   */
  async dispensar(ctx: HttpContext) {
    const r = await this.ordenes.procesarDetalle(ctx.request.param('id_detalle'))
    return responder.creado(ctx, r)
  }

  /** Reporte del dispositivo al cerrar la válvula. */
  async reportar(ctx: HttpContext) {
    const { segundosReal } = await reporteValidator.validate(ctx.request.body())
    const d = await this.ordenes.reportarDispensado(ctx.request.param('id_dispensado'), segundosReal)
    return responder.ok(ctx, d)
  }
}
