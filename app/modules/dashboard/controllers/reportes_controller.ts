import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { responder } from '#shared/responder'
import { ReporteService } from '#modules/dashboard/services/reporte_service'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

const desempenoValidator = vine.compile(
  vine.object({
    fechaDesde: vine.string().trim().regex(FECHA),
    fechaHasta: vine.string().trim().regex(FECHA),
    uuidMesero: vine.string().trim().regex(UUID_V4).optional(),
    page: vine.number().min(1).optional(),
    pageSize: vine.number().min(1).max(100).optional(),
  })
)

/** Solo capitán y admin: es información de desempeño del personal. */
@inject()
export default class ReportesController {
  constructor(private reportes: ReporteService) {}

  /**
   * Desempeño histórico de meseros en un rango de fechas.
   *
   * No confundir con `/dashboard/meseros`, que es self-service —lo que le toca
   * hacer AHORA a quien pregunta—. Este es el reporte agregado por persona que
   * alimenta la pantalla de personal.
   */
  async desempenoMeseros(ctx: HttpContext) {
    const f = await desempenoValidator.validate(ctx.request.qs())
    const r = await this.reportes.desempenoMeseros(f)
    return responder.lista(ctx, r.filas, { ...r.meta, periodo: r.periodo })
  }
}
