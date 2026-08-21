import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { MenuService } from '#modules/menu/services/menu_service'
import {
  insumoValidator,
  estadoInsumoValidator,
  bebidaValidator,
  recetaValidator,
  envaseValidator,
  insumoParcialValidator,
  bebidaParcialValidator,
  envaseParcialValidator,
} from '#modules/menu/validators/menu_validator'

@inject()
export default class MenuController {
  constructor(private menu: MenuService) {}

  // ──────────────────────────────────────────────────────────── insumos

  async listarInsumos(ctx: HttpContext) {
    const activo = ctx.request.input('activo')
    return responder.lista(
      ctx,
      await this.menu.listarInsumos({
        activo: activo === undefined ? undefined : activo === 'true',
        estado: ctx.request.input('estado'),
      })
    )
  }

  async mostrarInsumo(ctx: HttpContext) {
    return responder.ok(ctx, await this.menu.obtenerInsumo(ctx.request.param('id_insumo')))
  }

  /** No toca `estado`: ese es operativo y tiene su propia ruta. */
  async actualizarInsumo(ctx: HttpContext) {
    const datos = await insumoParcialValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.menu.actualizarInsumo(ctx.request.param('id_insumo'), datos))
  }

  async crearInsumo(ctx: HttpContext) {
    const datos = await insumoValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.menu.crearInsumo(datos))
  }

  /**
   * Lo usa la barra cuando se acaba o se repone una botella sin pasar por el
   * Cubaitor. Marcar `agotado` pausa las órdenes que dependan del insumo, y la
   * respuesta dice cuántas: el capitán necesita saber el alcance de inmediato.
   */
  async cambiarEstadoInsumo(ctx: HttpContext) {
    const { estado } = await estadoInsumoValidator.validate(ctx.request.body())
    const r = await this.menu.cambiarEstadoInsumo(ctx.request.param('id_insumo'), estado)

    return responder.ok(
      ctx,
      r.insumo,
      r.ordenesPausadas > 0
        ? `INSUMO id=${r.insumo.id} → ${estado}. ${r.ordenesPausadas} detalles pausados.`
        : undefined
    )
  }

  async desactivarInsumo(ctx: HttpContext) {
    await this.menu.desactivarInsumo(ctx.request.param('id_insumo'))
    return responder.ok(ctx, null, `INSUMO id=${ctx.request.param('id_insumo')} activo=0.`)
  }

  // ──────────────────────────────────────────────────────────── bebidas

  async listarBebidas(ctx: HttpContext) {
    return responder.lista(ctx, await this.menu.listarBebidas(ctx.request.input('activo') !== 'false'))
  }

  async mostrarBebida(ctx: HttpContext) {
    return responder.ok(ctx, await this.menu.obtenerBebida(ctx.request.param('id_bebida')))
  }

  async mostrarReceta(ctx: HttpContext) {
    return responder.ok(ctx, await this.menu.obtenerReceta(ctx.request.param('id_bebida')))
  }

  /** Solo el catálogo. La receta se reemplaza completa por su propia ruta. */
  async actualizarBebida(ctx: HttpContext) {
    const datos = await bebidaParcialValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.menu.actualizarBebida(ctx.request.param('id_bebida'), datos))
  }

  async crearBebida(ctx: HttpContext) {
    const datos = await bebidaValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.menu.crearBebida(datos))
  }

  /** Reemplaza la receta completa; no admite parches parciales. */
  async definirReceta(ctx: HttpContext) {
    const { ingredientes } = await recetaValidator.validate(ctx.request.body())
    const b = await this.menu.definirReceta(
      ctx.request.param('id_bebida'),
      ingredientes.map(i => ({ idInsumo: i.id_insumo, tipoPorcion: i.tipo_porcion, valor: i.valor, ordenServido: i.orden_servido }))
    )
    return responder.ok(ctx, b)
  }

  async desactivarBebida(ctx: HttpContext) {
    await this.menu.desactivarBebida(ctx.request.param('id_bebida'))
    return responder.ok(ctx, null, `BEBIDA id=${ctx.request.param('id_bebida')} activo=0.`)
  }

  // ──────────────────────────────────────────────────────────── envases

  async listarEnvases(ctx: HttpContext) {
    return responder.lista(ctx, await this.menu.listarEnvases(ctx.request.input('activo') !== 'false'))
  }

  async mostrarEnvase(ctx: HttpContext) {
    return responder.ok(ctx, await this.menu.obtenerEnvase(ctx.request.param('id_envase')))
  }

  async actualizarEnvase(ctx: HttpContext) {
    const datos = await envaseParcialValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.menu.actualizarEnvase(ctx.request.param('id_envase'), {
      nombre: datos.nombre,
      volumenMl: datos.volumen_ml,
    }))
  }

  async crearEnvase(ctx: HttpContext) {
    const datos = await envaseValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.menu.crearEnvase({
      nombre: datos.nombre,
      volumenMl: datos.volumen_ml,
    }))
  }

  async desactivarEnvase(ctx: HttpContext) {
    await this.menu.desactivarEnvase(ctx.request.param('id_envase'))
    return responder.ok(ctx, null, `ENVASE id=${ctx.request.param('id_envase')} activo=0.`)
  }
}
