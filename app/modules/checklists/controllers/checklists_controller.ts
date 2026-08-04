import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { ChecklistService } from '#modules/checklists/services/checklist_service'
import {
  checklistValidator,
  instanciarValidator,
  respuestasValidator,
} from '#modules/checklists/validators/checklist_validator'

@inject()
export default class ChecklistsController {
  constructor(private checklists: ChecklistService) {}

  // ──────────────────────────────────────────────────────────── plantillas

  async listar(ctx: HttpContext) {
    return responder.lista(ctx, await this.checklists.listar(ctx.request.input('tipo')))
  }

  async mostrar(ctx: HttpContext) {
    return responder.ok(ctx, await this.checklists.obtener(ctx.request.param('id_checklist')))
  }

  async crear(ctx: HttpContext) {
    const datos = await checklistValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.checklists.crear(datos))
  }

  async actualizar(ctx: HttpContext) {
    const datos = await checklistValidator.validate(ctx.request.body())
    const c = await this.checklists.actualizar(ctx.request.param('id_checklist'), datos)
    return responder.ok(ctx, c)
  }

  async desactivar(ctx: HttpContext) {
    await this.checklists.desactivar(ctx.request.param('id_checklist'))
    return responder.ok(ctx, null, `CHECKLIST id=${ctx.request.param('id_checklist')} activo=0.`)
  }

  // ──────────────────────────────────────────────────────────── instancias

  async listarInstancias(ctx: HttpContext) {
    const filas = await this.checklists.listarInstancias(ctx.request.param('id_participacion'))
    return responder.lista(ctx, filas)
  }

  async instanciar(ctx: HttpContext) {
    const { idChecklist } = await instanciarValidator.validate(ctx.request.body())
    const i = await this.checklists.instanciar(ctx.request.param('id_participacion'), idChecklist)
    return responder.creado(ctx, i)
  }

  /** El mesero marca sus respuestas. `completado` lo decide el servidor. */
  async responder(ctx: HttpContext) {
    const { respuestas } = await respuestasValidator.validate(ctx.request.body())
    const r = await this.checklists.responder(ctx.request.param('id_instancia'), respuestas)

    return responder.ok(
      ctx,
      { instancia: r.instancia, pendientes: r.pendientes },
      r.pendientes > 0 ? `Faltan ${r.pendientes} ítems por marcar.` : 'Checklist completo.'
    )
  }

  /**
   * El capitán aprueba. Es lo que desbloquea la asignación de mesas cuando el
   * checklist es de montaje (RF-21, SGEB-4005).
   */
  async aprobar(ctx: HttpContext) {
    const r = await this.checklists.aprobar(ctx.request.param('id_instancia'))
    return responder.ok(ctx, r)
  }
}
