import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { CierreService } from '#modules/cierre/services/cierre_service'
import {
  mermaValidator,
  pagoValidator,
  fallidoValidator,
} from '#modules/cierre/validators/cierre_validator'

@inject()
export default class CierreController {
  constructor(private cierre: CierreService) {}

  // ─────────────────────────────────────────────────────────────── mermas

  async listarMermas(ctx: HttpContext) {
    const r = await this.cierre.listarMermas(ctx.request.param('id_evento'))
    return responder.ok(ctx, r)
  }

  async registrarMerma(ctx: HttpContext) {
    const datos = await mermaValidator.validate(ctx.request.body())
    const r = await this.cierre.registrarMerma(ctx.request.param('id_evento'), ctx.sujeto.uuid, datos)
    return responder.creado(ctx, r)
  }

  // ──────────────────────────────────────────────────────────────── pagos

  /**
   * Qué falta para poder pagar, sin calcular nada.
   *
   * Existe aparte del cálculo porque el capitán necesita ver los pendientes en
   * la pantalla de cierre: recibir un error tras pulsar "pagar" es peor que
   * tener la lista delante.
   */
  async verificar(ctx: HttpContext) {
    return responder.ok(ctx, await this.cierre.verificarCierre(ctx.request.param('id_evento')))
  }

  async listarPagos(ctx: HttpContext) {
    return responder.lista(ctx, await this.cierre.listarPagos(ctx.request.param('id_evento')))
  }

  async calcular(ctx: HttpContext) {
    const r = await this.cierre.calcularPagos(ctx.request.param('id_evento'))
    return responder.creado(
      ctx,
      { pagos: r.pagos, total: r.total, ya_pagados: r.ya_pagados },
      `${r.pagos.length} pagos calculados, ${r.ya_pagados} ya dispersados sin recalcular.`
    )
  }

  async marcarPagado(ctx: HttpContext) {
    const { referencia } = await pagoValidator.validate(ctx.request.body())
    const p = await this.cierre.marcarPagado(ctx.request.param('id_pago'), referencia)
    return responder.ok(ctx, p)
  }

  /** Registra que la transferencia falló. Siempre responde error (SGEB-5004). */
  async marcarFallido(ctx: HttpContext) {
    const { motivo } = await fallidoValidator.validate(ctx.request.body())
    await this.cierre.marcarFallido(ctx.request.param('id_pago'), motivo)
  }
}
