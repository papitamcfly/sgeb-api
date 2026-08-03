import app from '@adonisjs/core/services/app'
import { errors as vineErrors } from '@vinejs/vine'
import { ExceptionHandler, type HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { CODIGOS, type CodigoSGEB } from '#shared/errors/catalogo'
import { SgebError } from '#shared/errors/sgeb_error'
import { envelope, limpiarParaCliente } from '#shared/envelope'

/**
 * Manejador global de excepciones.
 *
 * Su razón de existir: **el spinner siempre termina**. Todo camino del servidor
 * —incluido el fallo no previsto— responde con el envelope. Sin esto, una
 * excepción no controlada devuelve HTML de AdonisJS y el frontend se queda
 * girando porque no encuentra `result.code`.
 *
 * Es también el único lugar donde se traduce una excepción de infraestructura
 * (validación, base de datos) a un código del diccionario. Los servicios no
 * hacen esa traducción: lanzan SgebError o dejan burbujear.
 */
export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  async handle(error: unknown, ctx: HttpContext) {
    const traceId = randomUUID()
    const { codigo, tecnico, datos, status } = this.clasificar(error, ctx, traceId)

    /**
     * Los 5xx se registran completos; los 4xx no, porque son operación normal
     * (un mesero que erró la contraseña o un capitán que intentó borrar un salón
     * en uso no son incidentes) y llenarían los logs de ruido.
     */
    if (status >= 500) {
      ctx.logger.error({ err: error, traceId, codigo, ruta: ctx.request.url() }, tecnico)
    } else {
      ctx.logger.debug({ traceId, codigo, ruta: ctx.request.url() }, tecnico)
    }

    const cuerpo = envelope(
      { code: codigo, message: CODIGOS[codigo].mensaje, technical_message: tecnico },
      datos
    )

    return ctx.response.status(status).send(limpiarParaCliente(cuerpo, app.inProduction))
  }

  private clasificar(error: unknown, ctx: HttpContext, traceId: string) {
    // ---------------------------------------------------------------- dominio
    if (error instanceof SgebError) {
      return {
        codigo: error.codigo,
        status: error.httpStatus,
        datos: error.datos,
        tecnico: error.tecnico ?? `${error.codigo} sin detalle técnico. Trace-Id: ${traceId}.`,
      }
    }

    // ---------------------------------------------------------------- VineJS
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      const campos = error.messages as Array<{ field: string; rule: string; message: string }>
      const codigo = this.codigoDeValidacion(campos[0]?.rule)
      return {
        codigo,
        status: CODIGOS[codigo].http,
        // El frontend pinta el error bajo cada campo; por eso `data` los conserva.
        datos: { errores_campos: campos },
        tecnico: campos
          .map((c) => `Campo '${c.field}' falla regla '${c.rule}': ${c.message}`)
          .join(' | '),
      }
    }

    const e = error as { code?: string; constraint?: string; table?: string; message?: string }

    // ---------------------------------------------------------------- PostgreSQL
    // Se traducen solo los que tienen un código de negocio equivalente. El resto
    // cae en SGEB-5002: una violación de constraint que no previmos es un defecto
    // nuestro, no algo que el usuario pueda corregir.
    if (e.code === '23505') {
      const esCorreo = /correo|email/i.test(e.constraint ?? '')
      const codigo: CodigoSGEB = esCorreo ? 'SGEB-2006' : 'SGEB-2013'
      return {
        codigo,
        status: CODIGOS[codigo].http,
        datos: null,
        tecnico: `UNIQUE violation. constraint='${e.constraint}', tabla='${e.table}'. Trace-Id: ${traceId}.`,
      }
    }

    if (e.code === '23503') {
      return {
        codigo: 'SGEB-3002' as CodigoSGEB,
        status: 422,
        datos: null,
        tecnico: `FK violation. constraint='${e.constraint}', tabla='${e.table}'. Trace-Id: ${traceId}.`,
      }
    }

    if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') {
      return {
        codigo: 'SGEB-5002' as CodigoSGEB,
        status: 500,
        datos: null,
        tecnico: `Fallo de conexión a base de datos (${e.code}). Trace-Id: ${traceId}.`,
      }
    }

    // ---------------------------------------------------------------- 404 de ruta
    if ((error as { status?: number }).status === 404) {
      return {
        codigo: 'SGEB-3001' as CodigoSGEB,
        status: 404,
        datos: null,
        tecnico: `Ruta no registrada: ${ctx.request.method()} ${ctx.request.url()}.`,
      }
    }

    // ---------------------------------------------------------------- desconocido
    return {
      codigo: 'SGEB-5001' as CodigoSGEB,
      status: 500,
      datos: null,
      tecnico:
        `${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? 'sin mensaje'}. ` +
        `Trace-Id: ${traceId}. Stack completo en logs.`,
    }
  }

  /**
   * Mapea la regla de VineJS que falló al código del diccionario, para respetar
   * la distinción entre "falta el dato" (2001), "el formato es otro" (2002),
   * "la longitud no cabe" (2003) y "no está en el catálogo" (2004).
   */
  private codigoDeValidacion(regla?: string): CodigoSGEB {
    if (!regla) return 'SGEB-2001'
    if (regla === 'required') return 'SGEB-2001'
    if (regla === 'minLength' || regla === 'maxLength' || regla === 'fixedLength') return 'SGEB-2003'
    if (regla === 'enum' || regla === 'in') return 'SGEB-2004'
    if (regla === 'range' || regla === 'min' || regla === 'max') return 'SGEB-2012'
    return 'SGEB-2002'
  }

  async report(error: unknown, ctx: HttpContext) {
    // Los errores de dominio no son incidentes: ya quedaron en el log de handle().
    if (error instanceof SgebError) return
    return super.report(error, ctx)
  }
}
