import vine from '@vinejs/vine'

const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

export const hitoValidator = vine.compile(
  vine.object({
    tipoTiempo: vine.enum(['ENTRADA', 'FUERTE', 'POSTRE', 'OTRO'] as const),
    horaObjetivo: vine.string().trim().regex(HORA),
    descripcion: vine.string().trim().maxLength(100).nullable().optional(),
  })
)

/** En la actualización todo es opcional: se parcha lo que venga. */
export const hitoParcialValidator = vine.compile(
  vine.object({
    tipoTiempo: vine.enum(['ENTRADA', 'FUERTE', 'POSTRE', 'OTRO'] as const).optional(),
    horaObjetivo: vine.string().trim().regex(HORA).optional(),
    descripcion: vine.string().trim().maxLength(100).nullable().optional(),
  })
)
