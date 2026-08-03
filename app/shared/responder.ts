import type { HttpContext } from '@adonisjs/core/http'
import { CODIGOS, type CodigoSGEB } from './errors/catalogo.js'
import { envelope } from './envelope.js'

/**
 * Respuestas de éxito.
 *
 * Los fallos NO pasan por aquí: se lanzan como SgebError y los arma el
 * manejador global. Un controlador que construye un envelope de error a mano
 * es una señal de que la lógica se está saliendo de la capa de servicios.
 *
 * Uso:
 *   return responder.ok(ctx, salones)
 *   return responder.creado(ctx, { id_salon: 42 })
 *   return responder.lista(ctx, filas, { page: 1, total: 120 })
 */
export const responder = {
  ok<T>(ctx: HttpContext, datos: T, tecnico?: string) {
    return this.enviar(ctx, 'SGEB-0000', datos, tecnico)
  },

  creado<T>(ctx: HttpContext, datos: T, tecnico?: string) {
    return this.enviar(ctx, 'SGEB-0001', datos, tecnico)
  },

  /**
   * Listas: si viene vacía responde SGEB-0002 en lugar de SGEB-0000.
   *
   * Ambos son HTTP 200 y ambos son éxito —la consulta corrió bien—, pero el
   * frontend necesita distinguirlos para pintar "no hay resultados con esos
   * filtros" en vez de una tabla vacía sin explicación. Centralizarlo aquí
   * evita que cada controlador lo decida distinto.
   */
  lista<T>(ctx: HttpContext, filas: T[], meta?: Record<string, unknown>) {
    const codigo: CodigoSGEB = filas.length === 0 ? 'SGEB-0002' : 'SGEB-0000'
    const cuerpo = envelope(
      { code: codigo, message: CODIGOS[codigo].mensaje },
      meta ? { items: filas, meta } : filas
    )
    return ctx.response.status(200).send(cuerpo)
  },

  /**
   * Éxito parcial de una lectura agregada (dashboard). HTTP 200, secciones que
   * fallaron en null. La pantalla pinta esas tarjetas como "no disponible" en
   * lugar de caerse entera.
   */
  parcial<T>(ctx: HttpContext, datos: T, fallidas: string[]) {
    return this.enviar(
      ctx,
      'SGEB-0004',
      datos,
      `Agregado parcial. Secciones fallidas: ${fallidas.join(', ')}.`
    )
  },

  encolado(ctx: HttpContext, idJob: string, cola: string) {
    return this.enviar(ctx, 'SGEB-0003', { id_job: idJob }, `Job encolado id=${idJob} en cola ${cola}.`)
  },

  enviar<T>(ctx: HttpContext, codigo: CodigoSGEB, datos: T | null, tecnico?: string) {
    const def = CODIGOS[codigo]
    return ctx.response
      .status(def.http)
      .send(envelope({ code: codigo, message: def.mensaje, technical_message: tecnico }, datos))
  },
}
