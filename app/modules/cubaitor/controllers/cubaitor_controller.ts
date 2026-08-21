import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { CubaitorService } from '#modules/cubaitor/services/cubaitor_service'
import {
  cubaitorValidator,
  configPinValidator,
  recargaValidator,
  heartbeatValidator,
  cubaitorParcialValidator,
  configParcialValidator,
} from '#modules/cubaitor/validators/cubaitor_validator'

@inject()
export default class CubaitorController {
  constructor(private cubaitor: CubaitorService) {}

  async listar(ctx: HttpContext) {
    return responder.lista(ctx, await this.cubaitor.listar())
  }

  async mostrar(ctx: HttpContext) {
    return responder.ok(ctx, await this.cubaitor.obtener(ctx.request.param('id_cubaitor')))
  }

  /** La MAC no se edita: es la identidad física del dispositivo. */
  async actualizar(ctx: HttpContext) {
    const datos = await cubaitorParcialValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.cubaitor.actualizar(ctx.request.param('id_cubaitor'), {
      nombre: datos.nombre,
      numPins: datos.num_pins,
      hostIp: datos.host_ip,
      estado: datos.estado,
    }))
  }

  async desactivar(ctx: HttpContext) {
    await this.cubaitor.desactivar(ctx.request.param('id_cubaitor'))
    return responder.ok(ctx, null, `CUBAITOR id=${ctx.request.param('id_cubaitor')} estado=inactivo.`)
  }

  /** Alertas derivadas del estado actual; no hay tabla de alertas. */
  async alertas(ctx: HttpContext) {
    const r = await this.cubaitor.alertas(ctx.request.param('id_evento'))
    // Punto 4: Devolver la lista directa (AlertaOperativa[]) en lugar de un wrapper
    return responder.lista(ctx, r.alertas)
  }

  async actualizarConfig(ctx: HttpContext) {
    const datos = await configParcialValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.cubaitor.actualizarConfig(ctx.request.param('id_config'), {
      caudalMlSeg: datos.caudal_ml_seg,
      pinGpio: datos.pin_gpio,
      idInsumo: datos.id_insumo,
      volumenCargadoMl: datos.volumen_cargado_ml,
    }))
  }

  async desactivarConfig(ctx: HttpContext) {
    await this.cubaitor.desactivarConfig(ctx.request.param('id_config'))
    return responder.ok(ctx, null, `CONFIG_DISPENSADO id=${ctx.request.param('id_config')} activo=0.`)
  }

  async registrar(ctx: HttpContext) {
    const datos = await cubaitorValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.cubaitor.registrar({
      nombre: datos.nombre,
      mac: datos.mac,
      numPins: datos.num_pins,
      hostIp: datos.host_ip,
    }))
  }

  /**
   * Semáforo de la barra en el dashboard.
   *
   * Responde 200 aunque el dispositivo esté caído: no es un error de la
   * petición, es información. El evento continúa con dispensado manual
   * (RNF-13); devolver 503 haría que el frontend pintara una alerta roja de
   * fallo cuando lo que hay es una barra trabajando a mano.
   */
  async estado(ctx: HttpContext) {
    return responder.ok(ctx, await this.cubaitor.estado(ctx.request.param('id_cubaitor')))
  }

  /**
   * Heartbeat del ESP32.
   *
   * El dispositivo se identifica por su MAC, no por un token de usuario: no es
   * una persona. Su identidad la da la red privada WireGuard más las
   * credenciales del broker MQTT.
   */
  async heartbeat(ctx: HttpContext) {
    const { mac } = await heartbeatValidator.validate(ctx.request.body())
    return responder.ok(ctx, await this.cubaitor.heartbeat(mac))
  }

  // ────────────────────────────────────────────── configuración de pines

  async listarConfig(ctx: HttpContext) {
    return responder.lista(ctx, await this.cubaitor.listarConfig(ctx.request.param('id_evento')))
  }

  async configurarPin(ctx: HttpContext) {
    const datos = await configPinValidator.validate(ctx.request.body())
    const c = await this.cubaitor.configurarPin({
      idEvento: ctx.request.param('id_evento'),
      idCubaitor: datos.id_cubaitor,
      idInsumo: datos.id_insumo,
      pinGpio: datos.pin_gpio,
      caudalMlSeg: datos.caudal_ml_seg,
      volumenCargadoMl: datos.volumen_cargado_ml,
    })
    return responder.creado(ctx, c)
  }

  /**
   * Contraparte operativa de SGEB-4009: el capitán cambia la botella física y
   * las órdenes que esperaban ese insumo vuelven a la cola.
   */
  async recargar(ctx: HttpContext) {
    const datos = await recargaValidator.validate(ctx.request.body())
    const r = await this.cubaitor.recargar(
      ctx.request.param('id_config'),
      datos.volumen_cargado_ml,
      datos.reanudar_ordenes ?? true
    )

    // Punto 5: Devolver el recurso base ConfigDispensado en lugar de un wrapper anidado
    return responder.ok(
      ctx,
      r.config,
      `CONFIG_DISPENSADO id=${r.config.id} recargada. ${r.detallesReanudados} detalles reanudados.`
    )
  }
}
