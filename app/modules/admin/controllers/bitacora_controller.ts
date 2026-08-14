import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { responder } from '#shared/responder'
import { BitacoraService } from '#modules/admin/services/bitacora_service'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const filtrosValidator = vine.compile(
  vine.object({
    tipoEntidad: vine.string().trim().maxLength(40).optional(),
    accion: vine
      .enum(['crear', 'actualizar', 'desactivar', 'activar', 'eliminar', 'aprobar', 'cancelar'] as const)
      .optional(),
    uuidResponsable: vine.string().trim().regex(UUID_V4).optional(),
    fechaDesde: vine.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fechaHasta: vine.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: vine.number().min(1).optional(),
    pageSize: vine.number().min(1).max(100).optional(),
  })
)

/** Solo admin. La bitácora expone quién hizo qué en todo el sistema. */
@inject()
export default class BitacoraController {
  constructor(private bitacora: BitacoraService) {}

  async listar(ctx: HttpContext) {
    const filtros = await filtrosValidator.validate(ctx.request.qs())
    const p = await this.bitacora.listar(filtros)

    return responder.lista(ctx, p.all(), {
      page: p.currentPage,
      page_size: p.perPage,
      total: p.total,
      last_page: p.lastPage,
    })
  }
}
