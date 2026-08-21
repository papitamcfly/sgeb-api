import vine from '@vinejs/vine'

/** `idMesa` viaja en la ruta (`/mesas/:id_mesa/ordenes`), no en el cuerpo. */
export const crearOrdenValidator = vine.compile(
  vine.object({
    id_participacion: vine.number().positive(),
    lineas: vine
      .array(
        vine.object({
          id_bebida: vine.number().positive(),
          id_envase: vine.number().positive(),
          /** Tope de negocio del Diccionario: 50 unidades por renglón. */
          cantidad: vine.number().min(1).max(50),
        })
      )
      .minLength(1),
  })
)

export const estadoOrdenValidator = vine.compile(
  vine.object({
    estado: vine.enum([
      'en_preparacion',
      'dispensando',
      'entregada',
      'cancelada',
      'pausada_por_insumo',
    ] as const),
  })
)

/**
 * Reporte del Cubaitor al cerrar la válvula. `segundos_real` nulo significa que
 * el dispositivo no respondió: la válvula se fuerza a cierre y el registro
 * queda en error (SGEB-5006).
 */
export const reporteValidator = vine.compile(
  vine.object({ segundos_real: vine.number().min(0).max(99.99).nullable() })
)
