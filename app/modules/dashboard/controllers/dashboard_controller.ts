import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { DashboardService } from '#modules/dashboard/services/dashboard_service'

@inject()
export default class DashboardController {
  constructor(private dashboard: DashboardService) {}

  async capitan(ctx: HttpContext) {
    return responder.ok(ctx, await this.dashboard.capitan(ctx.sujeto.uuid))
  }

  async meseros(ctx: HttpContext) {
    return responder.ok(ctx, await this.dashboard.meseros(ctx.sujeto.uuid))
  }

  /**
   * Dashboard del evento. `?secciones=barra,servicio` pide solo lo necesario.
   *
   * Si alguna sección falla, la respuesta es SGEB-0004 (éxito parcial) con esa
   * sección en `null`: media pantalla a media fiesta vale más que un 500.
   */
  async evento(ctx: HttpContext) {
    const secciones = ctx.request
      .input('secciones', '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)

    const r = await this.dashboard.evento(ctx.request.param('id_evento'), secciones)

    if (r.fallidas.length > 0) {
      return responder.parcial(ctx, r.data, r.fallidas)
    }
    return responder.ok(ctx, r.data)
  }
}
