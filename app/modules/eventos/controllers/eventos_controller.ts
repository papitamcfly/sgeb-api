import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { EventoService } from '#modules/eventos/services/evento_service'
import {
  crearEventoValidator,
  actualizarEventoValidator,
  estadoEventoValidator,
  filtrosEventoValidator,
  mesaValidator,
} from '#modules/eventos/validators/evento_validator'

/**
 * Un controlador hace tres cosas: validar la entrada, llamar al servicio y
 * responder. No hay `try/catch`: SgebError y las excepciones de VineJS suben
 * solas al manejador global, que las convierte en envelope. Atraparlas aquí
 * duplicaría esa lógica y terminaría divergiendo entre controladores.
 */
@inject()
export default class EventosController {
  constructor(private servicio: EventoService) {}

  async listar(ctx: HttpContext) {
    const filtros = await filtrosEventoValidator.validate(ctx.request.qs())

    /**
     * Un capitán solo ve sus eventos; el admin ve todos. Se resuelve aquí y no
     * en el servicio porque depende de quién pregunta, no de la regla en sí.
     */
    if (ctx.sujeto.rol === 'capitan') filtros.uuidCapitan = ctx.sujeto.uuid

    return responder.lista(ctx, await this.servicio.listar(filtros))
  }

  async mostrar(ctx: HttpContext) {
    return responder.ok(ctx, await this.servicio.obtener(ctx.request.param('id_evento')))
  }

  async crear(ctx: HttpContext) {
    const datos = await crearEventoValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.servicio.crear(datos, ctx.sujeto.uuid))
  }

  async actualizar(ctx: HttpContext) {
    const datos = await actualizarEventoValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.servicio.actualizar(ctx.request.param('id_evento'), datos))
  }

  async cambiarEstado(ctx: HttpContext) {
    const { estado } = await estadoEventoValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.servicio.cambiarEstado(ctx.request.param('id_evento'), estado))
  }

  // ──────────────────────────────────────────────────────────────── mesas

  async listarMesas(ctx: HttpContext) {
    return responder.lista(ctx, await this.servicio.listarMesas(ctx.request.param('id_evento')))
  }

  async mostrarMesa(ctx: HttpContext) {
    const m = await this.servicio.obtenerMesa(
      ctx.request.param('id_evento'),
      ctx.request.param('id_mesa')
    )
    return responder.ok(ctx, m)
  }

  /** El `codigo_qr` no se toca aquí: regenerarlo tiene su propia ruta. */
  async actualizarMesa(ctx: HttpContext) {
    const datos = await mesaValidator.validate(ctx.request.body())
    const m = await this.servicio.actualizarMesa(
      ctx.request.param('id_evento'),
      ctx.request.param('id_mesa'),
      datos
    )
    return responder.ok(ctx, m)
  }

  async agregarMesa(ctx: HttpContext) {
    const datos = await mesaValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.servicio.agregarMesa(ctx.request.param('id_evento'), datos))
  }

  async regenerarQr(ctx: HttpContext) {
    const r = await this.servicio.regenerarQr(
      ctx.request.param('id_evento'),
      ctx.request.param('id_mesa')
    )
    return responder.ok(ctx, r, `MESA id=${ctx.request.param('id_mesa')}: QR regenerado (RF-22).`)
  }

  async eliminarMesa(ctx: HttpContext) {
    await this.servicio.eliminarMesa(ctx.request.param('id_evento'), ctx.request.param('id_mesa'))
    return responder.ok(ctx, null, `MESA id=${ctx.request.param('id_mesa')} eliminada.`)
  }
}
