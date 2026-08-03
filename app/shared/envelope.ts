/**
 * Envelope de respuesta estándar de Mediocres Inc.
 *
 * TODA respuesta del API —éxito o error, sin importar el estatus HTTP— viaja con
 * esta forma. El frontend nunca programa `if (status === 400)`: lee `result.code`
 * y usa el HTTP solo para elegir el color del componente.
 *
 * Referencia: diccionario-errores-sgeb.md §1
 */

export interface Result {
  code: string
  message: string
  /** Detalle para soporte. NUNCA se muestra al usuario final. */
  technical_message?: string
}

export interface Envelope<T = unknown> {
  result: Result
  data: T | null
}

/**
 * Construye el envelope. No decide el estatus HTTP: eso lo hace quien responde,
 * a partir del catálogo de códigos.
 */
export function envelope<T>(result: Result, data: T | null = null): Envelope<T> {
  return { result, data }
}

/**
 * Punto único donde se decide si `technical_message` sale al cliente.
 *
 * En producción se omite siempre: puede contener stack traces, valores recibidos
 * y nombres de tabla. Fuera de producción se conserva porque es la herramienta de
 * depuración del equipo.
 */
export function limpiarParaCliente(env: Envelope, esProduccion: boolean): Envelope {
  if (!esProduccion) return env
  const { technical_message, ...resto } = env.result
  return { result: resto, data: env.data }
}
