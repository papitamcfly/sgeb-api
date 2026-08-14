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
    return responder.ok(ctx, await this.servicio.obtener(ctx.request.param('id_salon')))
  }

  async crear(ctx: HttpContext) {
    const datos = await salonValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.servicio.crear(datos))
  }

  async actualizar(ctx: HttpContext) {
    const datos = await salonValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.servicio.actualizar(ctx.request.param('id_salon'), datos))
  }

  /**
   * Fechas ocupadas del salón en un rango.
   *
   * Solo cuentan `publicado` y `en_curso`: un borrador es un plan, no un
   * compromiso, y bloquear la fecha por él impediría agendar algo real.
   */
  async disponibilidad(ctx: HttpContext) {
    const { EventoService } = await import('#modules/eventos/services/evento_service')
    const eventos = await ctx.containerResolver.make(EventoService)
    const r = await eventos.disponibilidadSalon(
      ctx.request.param('id_salon'),
      ctx.request.input('fecha_desde'),
      ctx.request.input('fecha_hasta')
    )
    return responder.ok(ctx, r)
  }

  async desactivar(ctx: HttpContext) {
    await this.servicio.desactivar(ctx.request.param('id_salon'))
    return responder.ok(ctx, null, `SALON id=${ctx.request.param('id_salon')} activo=0.`)
  }
}

/**
 * Los límites replican el Diccionario de Datos, que es la misma fuente que usa
 * el frontend. Cuando divergen, el usuario ve un error del servidor sobre un
 * campo que su pantalla dio por bueno: coherencia BD ↔ API ↔ UI.
 */
const salonValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(3).maxLength(80),
    calle: vine.string().trim().minLength(5).maxLength(50),
    cp: vine.string().trim().fixedLength(5).regex(/^\d{5}$/),
    colonia: vine.string().trim().minLength(2).maxLength(40),
    ciudad: vine.string().trim().minLength(2).maxLength(40),
    estado: vine.string().trim().minLength(2).maxLength(25),
    latitud: vine.number().min(-90).max(90),
    longitud: vine.number().min(-180).max(180),
    capacidadMaxMesas: vine.number().positive().max(255),
    capacidadPersonas: vine.number().positive().max(65535),
  })
)

const filtrosValidator = vine.compile(
  vine.object({
    activo: vine.boolean().optional(),
    q: vine.string().trim().maxLength(60).optional(),
  })
)
