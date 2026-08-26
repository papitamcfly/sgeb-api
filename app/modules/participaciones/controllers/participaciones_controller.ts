import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import { LlegadaService } from '#modules/participaciones/services/llegada_service'
import {
  estadoParticipacionValidator,
  asignarMesaValidator,
  vincularValidator,
  llegadaValidator,
} from '#modules/participaciones/validators/participacion_validator'

@inject()
export default class ParticipacionesController {
  constructor(
    private servicio: ParticipacionService,
    private llegada: LlegadaService
  ) {}

  async listar(ctx: HttpContext) {
    const filas = await this.servicio.listarPorEvento(
      ctx.request.param('id_evento'),
      ctx.request.input('estado')
    )
    return responder.lista(ctx, filas)
  }

  async mostrar(ctx: HttpContext) {
    return responder.ok(ctx, await this.servicio.obtener(ctx.request.param('id_participacion')))
  }

  /** El mesero aparta su lugar. El sujeto sale del token, nunca del cuerpo. */
  async apartar(ctx: HttpContext) {
    const p = await this.servicio.apartar(ctx.request.param('id_evento'), ctx.sujeto.uuid)
    return responder.creado(ctx, p)
  }

  async liberar(ctx: HttpContext) {
    await this.servicio.liberar(ctx.request.param('id_participacion'), ctx.sujeto.uuid)
    return responder.ok(ctx, null, `PARTICIPACION id=${ctx.request.param('id_participacion')} liberada por el mesero (RF-14).`)
  }

  /**
   * El mesero confirma que sí va. El sujeto sale del token: nadie confirma por
   * otro.
   */
  async confirmarAsistencia(ctx: HttpContext) {
    const p = await this.servicio.confirmarAsistencia(
      ctx.request.param('id_participacion'),
      ctx.sujeto.uuid
    )
    return responder.ok(ctx, p)
  }

  async cambiarEstado(ctx: HttpContext) {
    const { estado } = await estadoParticipacionValidator.validate(ctx.request.body())
    const p = await this.servicio.cambiarEstado(ctx.request.param('id_participacion'), estado)
    return responder.ok(ctx, p)
  }

  /**
   * Confirmación de llegada. El sujeto viene del token: nadie confirma la
   * llegada de otro, y el servicio lo verifica de nuevo (SGEB-1004).
   */
  async confirmarLlegada(ctx: HttpContext) {
    const datos = await llegadaValidator.validate(ctx.request.body())
    const r = await this.llegada.confirmar(
      ctx.request.param('id_participacion'),
      ctx.sujeto.uuid,
      datos
    )
    return responder.creado(ctx, r)
  }

  /**
   * Readback del panel de piso: qué mesa tiene quién, en todo el evento.
   *
   * Sin esto el panel sabía asignar y vincular pero no reconstruir su estado
   * tras una recarga.
   */
  async listarAsignaciones(ctx: HttpContext) {
    const v = ctx.request.input('vinculada')
    const a = ctx.request.input('activa')
    const filas = await this.servicio.listarAsignaciones(ctx.request.param('id_evento'), {
      vinculada: v === undefined ? undefined : v === 'true',
      activa: a === undefined ? undefined : a === 'true',
    })
    return responder.lista(ctx, filas)
  }

  async asignarMesa(ctx: HttpContext) {
    const { idMesa } = await asignarMesaValidator.validate(ctx.request.body())
    const a = await this.servicio.asignarMesa(ctx.request.param('id_participacion'), idMesa)
    return responder.creado(ctx, a)
  }

  /**
   * El mesero escanea el QR de la mesa y queda vinculado.
   *
   * Es el camino que usa la app: no necesita conocer ningún identificador
   * interno, solo el código que acaba de leer. El servidor resuelve la mesa, su
   * asignación vigente y si le corresponde a quien escaneó.
   */
  async vincularPorQr(ctx: HttpContext) {
    const { codigoQr } = await vincularValidator.validate(ctx.request.body())
    const a = await this.servicio.vincularPorQr(codigoQr, ctx.sujeto.uuid)
    return responder.ok(ctx, a, 'Mesa vinculada.')
  }

  async vincularMesa(ctx: HttpContext) {
    const { codigoQr } = await vincularValidator.validate(ctx.request.body())
    const a = await this.servicio.vincularMesa(
      ctx.request.param('id_asignacion'),
      codigoQr,
      ctx.sujeto.uuid
    )
    return responder.ok(ctx, a)
  }

  async liberarMesa(ctx: HttpContext) {
    await this.servicio.liberarMesa(ctx.request.param('id_asignacion'))
    return responder.ok(ctx, null, `ASIGNACION_MESA id=${ctx.request.param('id_asignacion')} liberada.`)
  }
}
