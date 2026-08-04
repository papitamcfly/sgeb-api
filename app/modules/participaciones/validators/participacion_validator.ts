import vine from '@vinejs/vine'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const estadoParticipacionValidator = vine.compile(
  vine.object({
    estado: vine.enum([
      'seleccionado',
      'confirmo_asistencia',
      'confirmo_llegada',
      'asignado',
      'vinculo',
      'salida',
    ] as const),
  })
)

export const asignarMesaValidator = vine.compile(
  vine.object({ idMesa: vine.number().positive() })
)

export const vincularValidator = vine.compile(
  vine.object({ codigoQr: vine.string().trim().regex(UUID_V4) })
)

/**
 * Confirmación de llegada. `metodo: ninguno` cubre el equipo sin biometría
 * configurada; obliga a `biometricoVerificado: false` y deja la confirmación en
 * manos del capitán (SGEB-4004).
 */
export const llegadaValidator = vine.compile(
  vine.object({
    metodo: vine.enum(['huella', 'face_id', 'ninguno'] as const),
    biometricoVerificado: vine.boolean(),
    uuidDispositivo: vine.string().trim().minLength(32).maxLength(64),
    latitud: vine.number().min(-90).max(90),
    longitud: vine.number().min(-180).max(180),
    /** Margen de error del GPS. Mayor que la geocerca hace la medición inconcluyente. */
    precisionM: vine.number().min(0).max(100000).nullable().optional(),
  })
)
