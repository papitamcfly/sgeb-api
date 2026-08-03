import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Trace-Id por petición.
 *
 * Va como middleware de servidor —antes que todo lo demás— para que exista
 * incluso cuando la petición ni siquiera llega a una ruta.
 *
 * Sirve para lo mismo que sirve en soporte: el mesero reporta "me salió un
 * error a las 9:40", el capitán le pide el identificador que aparece en
 * pantalla, y con eso se encuentra la línea exacta en los logs. Sin esto hay
 * que adivinar entre todas las peticiones de ese minuto.
 *
 * Si el cliente ya manda uno (porque la app lo generó al iniciar el flujo), se
 * respeta: así una operación que cruza varias peticiones queda hilada.
 */
export default class TraceIdMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const traceId = ctx.request.header('x-trace-id') ?? randomUUID()

    ctx.traceId = traceId
    ctx.logger = ctx.logger.child({ traceId })
    ctx.response.header('X-Trace-Id', traceId)

    return next()
  }
}

declare module '@adonisjs/core/http' {
  interface HttpContext {
    traceId: string
  }
}
