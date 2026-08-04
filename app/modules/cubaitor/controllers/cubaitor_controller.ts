import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { CubaitorService } from '#modules/cubaitor/services/cubaitor_service'
import {
  cubaitorValidator,
  configPinValidator,
  recargaValidator,
  heartbeatValidator,
} from '#modules/cubaitor/validators/cubaitor_validator'

@inject()
export default class CubaitorController {
  constructor(private cubaitor: CubaitorService) {}

  async listar(ctx: HttpContext) {
    return responder.lista(ctx, await this.cubaitor.listar())
  }

  async registrar(ctx: HttpContext) {
    const datos = await cubaitorValidator.validate(ctx.request.body())
    return responder.creado(ctx, await this.cubaitor.registrar(datos))
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
      ...datos,
      idEvento: ctx.request.param('id_evento'),
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
      datos.volumenCargadoMl,
      datos.reanudarOrdenes ?? true
    )

    return responder.ok(
      ctx,
      { config: r.config, detalles_reanudados: r.detallesReanudados },
      `CONFIG_DISPENSADO id=${r.config.id} recargada. ${r.detallesReanudados} detalles reanudados.`
    )
  }
}
