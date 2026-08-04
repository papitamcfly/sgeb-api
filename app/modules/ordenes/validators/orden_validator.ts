import vine from '@vinejs/vine'

/** `idMesa` viaja en la ruta (`/mesas/:id_mesa/ordenes`), no en el cuerpo. */
export const crearOrdenValidator = vine.compile(
  vine.object({
    idParticipacion: vine.number().positive(),
    lineas: vine
      .array(
        vine.object({
          idBebida: vine.number().positive(),
          idEnvase: vine.number().positive(),
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
 * Reporte del Cubaitor al cerrar la válvula. `segundosReal` nulo significa que
 * el dispositivo no respondió: la válvula se fuerza a cierre y el registro
 * queda en error (SGEB-5006).
 */
export const reporteValidator = vine.compile(
  vine.object({ segundosReal: vine.number().min(0).max(99.99).nullable() })
)
