import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { ComensalService } from '#modules/comensal/services/comensal_service'
import { LimitePeticionesService } from '#shared/services/limite_peticiones_service'
import {
  solicitudValidator,
  estadoSolicitudValidator,
  calificacionValidator,
} from '#modules/comensal/validators/comensal_validator'

/**
 * Rutas del comensal. Las de `/publico` no llevan token de usuario: el comensal
 * es anonimo y su unica credencial es haber escaneado el QR impreso en la mesa.
 */
@inject()
export default class ComensalController {
  constructor(
    private comensal: ComensalService,
    private limite: LimitePeticionesService
  ) {}

  // ─────────────────────────────────────────────────── publico (sin token)

  async solicitar(ctx: HttpContext) {
    /**
     * Sin token de usuario, la IP es lo único que identifica al llamante. El
     * anti-spam por mesa (SGEB-4014) cubre al comensal impaciente; esto cubre a
     * quien recorre códigos QR desde fuera.
     */
    await this.limite.exigir('publico', ctx.request.ip())
    const { tipo } = await solicitudValidator.validate(ctx.request.body())
    const s = await this.comensal.solicitar(ctx.request.param('codigo_qr'), tipo)

    /**
     * Se devuelve lo minimo para que la pantalla del comensal confirme el
     * envio. Nada del mesero ni del evento: una vista sin autenticar no debe
     * servir de puerta al resto del sistema.
     */
    return responder.creado(ctx, {
      id_solicitud: s.id,
      tipo: s.tipo,
      estado: s.estado,
      creada_en: s.creadaEn,
    })
  }

  async calificar(ctx: HttpContext) {
    await this.limite.exigir('publico', ctx.request.ip())
    const datos = await calificacionValidator.validate(ctx.request.body())
    const c = await this.comensal.calificar(ctx.request.param('codigo_qr'), datos)

    /** El token no vuelve: devolverlo permitiria deducir quien dijo que. */
    return responder.creado(ctx, {
      id_calificacion: c.id,
      puntuacion: c.puntuacion,
      creada_en: c.creadaEn,
    })
  }

  /** Emite el token que el navegador del comensal conserva para calificar una vez. */
  async token(ctx: HttpContext) {
    await this.limite.exigir('publico', ctx.request.ip())
    return responder.creado(ctx, { token_comensal: this.comensal.tokenComensal() })
  }

  // ─────────────────────────────────────────────────── personal del evento

  async listarSolicitudes(ctx: HttpContext) {
    const filas = await this.comensal.listarSolicitudes(ctx.request.param('id_evento'), {
      estado: ctx.request.input('estado'),
      idMesa: ctx.request.input('id_mesa'),
      idParticipacion: ctx.request.input('id_participacion'),
    })
    return responder.lista(ctx, filas)
  }

  async cambiarEstado(ctx: HttpContext) {
    const { estado } = await estadoSolicitudValidator.validate(ctx.request.body())
    const s = await this.comensal.cambiarEstado(
      ctx.request.param('id_solicitud'),
      estado,
      ctx.request.input('id_participacion')
    )
    return responder.ok(ctx, s)
  }

  /**
   * Solo capitan y admin. El comensal es anonimo: la respuesta expone la mesa y
   * el mesero calificado, nunca datos de quien escribio.
   */
  async listarCalificaciones(ctx: HttpContext) {
    const r = await this.comensal.listarCalificaciones(ctx.request.param('id_evento'), {
      idParticipacion: ctx.request.input('id_participacion'),
      puntuacionMax: ctx.request.input('puntuacion_max'),
    })
    return responder.ok(ctx, r)
  }
}
