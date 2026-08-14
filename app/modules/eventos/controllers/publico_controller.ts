import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { EventoService } from '#modules/eventos/services/evento_service'

/**
 * Vista del comensal, sin token de usuario.
 *
 * El comensal es anónimo: escanea el QR impreso en la mesa y no tiene cuenta.
 * Hacerlo pasar por el proveedor de identidad obligaría a crear una cuenta por
 * invitado, con el costo de privacidad y de padrón que eso implica, a cambio de
 * ninguna funcionalidad.
 */
@inject()
export default class PublicoController {
  constructor(private eventos: EventoService) {}

  /**
   * Resuelve la mesa desde el código impreso.
   *
   * Devuelve lo mínimo para pintar la pantalla del comensal: nunca datos del
   * mesero, ni del evento más allá del título, ni identificadores internos que
   * permitan explorar el resto del sistema desde una vista sin autenticar.
   */
  async mesa(ctx: HttpContext) {
    const mesa = await this.eventos.porCodigoQr(ctx.request.param('codigo_qr'))

    return responder.ok(ctx, {
      id_mesa: mesa.id,
      etiqueta: mesa.etiqueta,
      evento: {
        id_evento: mesa.evento.id,
        titulo: mesa.evento.titulo,
        estado: mesa.evento.estado,
      },
    })
  }
}
