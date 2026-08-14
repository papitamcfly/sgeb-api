import vine from '@vinejs/vine'

/** Límites del Diccionario, tablas 10–13. */

const items = vine
  .array(
    vine.object({
      descripcion: vine.string().trim().minLength(3).maxLength(80),
      cantidadEsperada: vine.number().min(1).max(255),
      orden: vine.number().min(1).max(255),
    })
  )
  .minLength(1)

export const checklistValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(3).maxLength(40),
    tipo: vine.enum(['montaje', 'servicio', 'cierre'] as const),
    items,
  })
)

export const instanciarValidator = vine.compile(
  vine.object({ idChecklist: vine.number().positive() })
)

/**
 * `hecho` y `cantidad` los manda el mesero; `completado` de la instancia NO:
 * lo calcula el servidor a partir de las respuestas. Si la app pudiera
 * declararlo, bastaría con enviar `completado: true` para saltarse el montaje.
 */
export const respuestasValidator = vine.compile(
  vine.object({
    respuestas: vine
      .array(
        vine.object({
          idItem: vine.number().positive(),
          cantidad: vine.number().min(0).max(255),
          hecho: vine.boolean(),
        })
      )
      .minLength(1),
  })
)
