import vine from '@vinejs/vine'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const solicitudValidator = vine.compile(
  vine.object({ tipo: vine.enum(['atencion', 'cuenta', 'otro'] as const) })
)

export const estadoSolicitudValidator = vine.compile(
  vine.object({ estado: vine.enum(['atendida', 'cancelada'] as const) })
)

/**
 * `tokenComensal` lo emite el servidor al escanear y el navegador lo conserva.
 * Es lo unico que impide una segunda calificacion (SGEB-4010): el comensal es
 * anonimo y no hay cuenta contra la cual deduplicar.
 */
export const calificacionValidator = vine.compile(
  vine.object({
    tokenComensal: vine.string().trim().regex(UUID_V4),
    puntuacion: vine.number().min(1).max(5),
    comentario: vine.string().trim().maxLength(255).nullable().optional(),
  })
)
