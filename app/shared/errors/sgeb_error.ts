import { Exception } from '@adonisjs/core/exceptions'
import { CODIGOS, type CodigoSGEB } from './catalogo.js'

/**
 * Excepción de dominio del SGEB.
 *
 * Es la ÚNICA forma en que la capa de servicios comunica un fallo de negocio.
 * Los servicios nunca arman respuestas HTTP ni tocan el objeto `response`:
 * lanzan esto y el manejador global lo convierte en envelope.
 *
 *   throw new SgebError('SGEB-4016', {
 *     tecnico: `DELETE rechazado: SALON id=${id} referenciada por ${n} EVENTO.`,
 *     data: { alternativa: 'desactivar' },
 *   })
 *
 * Sobre `tecnico`: entre más detallado, mejor. Campo, valor recibido, tabla,
 * cuántas filas. Es lo que soporte va a leer a las 2 de la mañana. Lo que NO
 * debe llevar: contraseñas, tokens completos ni CLABEs sin enmascarar.
 */
export class SgebError extends Exception {
  static status = 500

  readonly codigo: CodigoSGEB
  readonly tecnico?: string
  readonly datos: unknown
  /**
   * Estatus HTTP de esta instancia.
   *
   * Se guarda explícitamente en lugar de confiar en el `status` heredado de
   * Exception: el `static status` de la clase lo sombrea al leerlo desde
   * TypeScript, y el manejador global necesita el de la instancia, que sale del
   * catálogo y varía por código.
   */
  readonly httpStatus: number

  constructor(
    codigo: CodigoSGEB,
    opciones: { tecnico?: string; datos?: unknown; causa?: unknown } = {}
  ) {
    const def = CODIGOS[codigo]
    super(def.mensaje, { status: def.http, code: codigo, cause: opciones.causa })
    this.codigo = codigo
    this.tecnico = opciones.tecnico
    this.datos = opciones.datos ?? null
    this.httpStatus = def.http
  }
}

/**
 * Atajos para los casos que aparecen en casi todos los módulos.
 * Existen para que el código de negocio se lea como el diccionario.
 */
export const errores = {
  noEncontrado: (tabla: string, llave: string | number, ruta?: string) =>
    new SgebError('SGEB-3001', {
      tecnico: `SELECT ${tabla} WHERE pk=${llave} → 0 filas.${ruta ? ` Ruta: ${ruta}.` : ''}`,
    }),

  desactivado: (tabla: string, id: number) =>
    new SgebError('SGEB-3004', {
      tecnico: `${tabla}.activo=0 para id=${id}. Recurso lógicamente eliminado.`,
    }),

  /**
   * El caso más frecuente al implementar los DELETE de catálogo.
   * Toda baja es lógica: si el borrado rompería historia, esto es la respuesta.
   */
  enUso: (tabla: string, id: number, dependiente: string, n: number) =>
    new SgebError('SGEB-4016', {
      tecnico:
        `DELETE rechazado: ${tabla} id=${id} referenciada por ${n} filas en ` +
        `${dependiente}. Sugerir baja lógica activo=0.`,
      datos: { alternativa: 'desactivar', dependencias: n },
    }),

  eventoEnCurso: (tabla: string, id: number, idEvento: number, estado: string) =>
    new SgebError('SGEB-4017', {
      tecnico: `${tabla} id=${id} vinculada a EVENTO id=${idEvento} estado='${estado}'.`,
    }),

  transicionInvalida: (tabla: string, id: number, actual: string, solicitado: string) =>
    new SgebError('SGEB-4011', {
      tecnico: `Transición inválida ${actual} → ${solicitado} en ${tabla} id=${id}.`,
    }),

  sinPermisos: (rol: string, sub: string, metodo: string, ruta: string, permitidos: string[]) =>
    new SgebError('SGEB-1004', {
      tecnico: `Rol '${rol}' (sub=${sub}) intentó ${metodo} ${ruta}. Roles permitidos: ${permitidos.join(', ')}.`,
    }),
}
