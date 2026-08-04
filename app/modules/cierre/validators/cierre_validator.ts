import vine from '@vinejs/vine'

export const mermaValidator = vine.compile(
  vine.object({
    observaciones: vine.string().trim().maxLength(255).nullable().optional(),
    detalles: vine
      .array(
        vine.object({
          tipo: vine.enum([
            'vaso_roto',
            'plato_roto',
            'copa_rota',
            'comida_desperdiciada',
            'otro',
          ] as const),
          descripcion: vine.string().trim().maxLength(150).nullable().optional(),
          cantidad: vine.number().min(1).max(65535),
          /** Nulo cuando el capitán no puede valorarlo en el momento. */
          costoEstimado: vine.number().min(0).max(999999.99).nullable().optional(),
        })
      )
      .minLength(1),
  })
)

export const pagoValidator = vine.compile(
  vine.object({
    /** Referencia bancaria de la transferencia; solo alfanumérico y guion. */
    referencia: vine.string().trim().minLength(1).maxLength(40).regex(/^[A-Za-z0-9-]+$/),
  })
)

export const fallidoValidator = vine.compile(
  vine.object({ motivo: vine.string().trim().minLength(3).maxLength(200) })
)
