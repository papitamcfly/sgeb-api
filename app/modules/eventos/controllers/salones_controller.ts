import vine from '@vinejs/vine'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { SalonService } from '#modules/eventos/services/salon_service'

/**
 * CONTROLADOR DE REFERENCIA.
 *
 * Un controlador hace exactamente tres cosas: validar la entrada, llamar al
 * servicio y responder. Si tiene un `if` de negocio o un `try/catch`, algo se
 * salió de lugar.
 *
 * No hay `try/catch` aquí a propósito: SgebError y las excepciones de VineJS
 * suben solas al manejador global, que las convierte en envelope. Atraparlas
 * aquí duplicaría esa lógica y terminaría divergiendo entre controladores.
 */
@inject()
export default class SalonesController {
  constructor(private servicio: SalonService) {}

  async listar(ctx: HttpContext) {
    const filtros = await filtrosValidator.validate(ctx.request.qs())
    return responder.lista(ctx, await this.servicio.listar(filtros))
  }

  async mostrar(ctx: HttpContext) {
    return responder.ok(ctx, await this.servicio.obtener(ctx.request.param('id')))
  }

  async crear(ctx: HttpContext) {
    const datos = await salonValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.servicio.crear(datos))
  }

  async actualizar(ctx: HttpContext) {
    const datos = await salonValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.servicio.actualizar(ctx.request.param('id'), datos))
  }

  async desactivar(ctx: HttpContext) {
    await this.servicio.desactivar(ctx.request.param('id'))
    return responder.ok(ctx, null, `SALON id=${ctx.request.param('id')} activo=0.`)
  }
}

/**
 * Los límites replican el Diccionario de Datos, que es la misma fuente que usa
 * el frontend. Cuando divergen, el usuario ve un error del servidor sobre un
 * campo que su pantalla dio por bueno: coherencia BD ↔ API ↔ UI.
 */
const salonValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(3).maxLength(60),
    direccion: vine.string().trim().minLength(5).maxLength(150),
    latitud: vine.number().min(-90).max(90),
    longitud: vine.number().min(-180).max(180),
    capacidadMaxMesas: vine.number().positive().max(500),
  })
)

const filtrosValidator = vine.compile(
  vine.object({
    activo: vine.boolean().optional(),
    q: vine.string().trim().maxLength(60).optional(),
  })
)
