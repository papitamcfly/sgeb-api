import vine from '@vinejs/vine'

/**
 * Los límites replican el Diccionario de Datos, que es la misma fuente que usa
 * el frontend. Cuando divergen, el usuario ve un error del servidor sobre un
 * campo que su pantalla dio por bueno.
 *
 * Las reglas que dependen de OTROS datos —que el salón esté libre, que las
 * mesas quepan, que el capitán tenga el rol— no van aquí: necesitan consultar
 * la base y viven en el servicio, con su propio código de negocio.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

export const crearEventoValidator = vine.compile(
  vine.object({
    idSalon: vine.number().positive(),
    uuidCapitan: vine.string().trim().regex(UUID_V4),
    titulo: vine.string().trim().minLength(3).maxLength(120),
    tipo: vine.enum(['social', 'empresarial'] as const),
    comandaUrl: vine.string().trim().url().maxLength(2048).nullable().optional(),
    fecha: vine.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    horaPresentacion: vine.string().trim().regex(HORA),
    inicio: vine.string().trim(),
    cupoMeseros: vine.number().min(1).max(500),
    numMesas: vine.number().min(1).max(255),
    tarifaPorMesero: vine.number().min(0).max(9999.99),
    /** Rango de negocio 10–1000 m; el tope técnico de la columna es 65 535. */
    radioGeocercaM: vine.number().min(10).max(1000),
  })
)

export const actualizarEventoValidator = vine.compile(
  vine.object({
    uuidCapitan: vine.string().trim().regex(UUID_V4).optional(),
    titulo: vine.string().trim().minLength(3).maxLength(120).optional(),
    tipo: vine.enum(['social', 'empresarial'] as const).optional(),
    comandaUrl: vine.string().trim().url().maxLength(2048).nullable().optional(),
    cupoMeseros: vine.number().min(1).max(500).optional(),
    numMesas: vine.number().min(1).max(255).optional(),
    tarifaPorMesero: vine.number().min(0).max(9999.99).optional(),
    radioGeocercaM: vine.number().min(10).max(1000).optional(),
  })
)

export const estadoEventoValidator = vine.compile(
  vine.object({
    estado: vine.enum(['borrador', 'publicado', 'en_curso', 'finalizado', 'cancelado'] as const),
  })
)

export const mesaValidator = vine.compile(
  vine.object({
    etiqueta: vine.string().trim().minLength(1).maxLength(20),
    nfcUid: vine.string().trim().regex(/^[0-9A-Fa-f:]{4,50}$/).nullable().optional(),
  })
)

export const filtrosEventoValidator = vine.compile(
  vine.object({
    estado: vine
      .enum(['borrador', 'publicado', 'en_curso', 'finalizado', 'cancelado'] as const)
      .optional(),
    fechaDesde: vine.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fechaHasta: vine.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    uuidCapitan: vine.string().trim().regex(UUID_V4).optional(),
    /** Documentado en el contrato desde la v1.0; faltaba implementarlo. */
    idSalon: vine.number().min(1).optional(),
  })
)
