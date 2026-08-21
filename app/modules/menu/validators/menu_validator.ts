import vine from '@vinejs/vine'

/** Límites del Diccionario, tablas 14–17. */

export const insumoValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(2).maxLength(30),
    tipo: vine.enum(['alcohol', 'refresco', 'jugo', 'agua', 'otro'] as const),
    unidad: vine.string().trim().minLength(1).maxLength(10),
    costo: vine.number().min(0).max(99999.99),
  })
)

export const estadoInsumoValidator = vine.compile(
  vine.object({ estado: vine.enum(['disponible', 'bajo', 'agotado', 'inactivo'] as const) })
)

export const bebidaValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(2).maxLength(30),
    descripcion: vine.string().trim().maxLength(70).nullable().optional(),
    alcoholica: vine.boolean(),
  })
)

/**
 * La receta completa. Que las proporciones sumen ≤ 1.00 y que los insumos
 * existan no se valida aquí: necesita consultar la base y vive en el servicio.
 */
export const recetaValidator = vine.compile(
  vine.object({
    ingredientes: vine
      .array(
        vine.object({
          id_insumo: vine.number().positive(),
          tipo_porcion: vine.enum(['PROPORCION', 'FIJO_ML', 'RESTO'] as const),
          valor: vine.number().min(0).max(999.99),
          orden_servido: vine.number().min(1).max(255),
        })
      )
      .minLength(1),
  })
)

export const envaseValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(2).maxLength(50),
    volumen_ml: vine.number().min(1).max(65535),
  })
)

/**
 * Variantes parciales para PUT. Todo opcional: se parchea lo que venga.
 *
 * `estado` del insumo NO está aquí: marcarlo 'agotado' pausa órdenes, y ese
 * efecto no debe ocurrir de rebote al corregir un nombre mal escrito. Tiene su
 * propia ruta.
 */
export const insumoParcialValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(2).maxLength(30).optional(),
    tipo: vine.enum(['alcohol', 'refresco', 'jugo', 'agua', 'otro'] as const).optional(),
    unidad: vine.string().trim().minLength(1).maxLength(10).optional(),
    costo: vine.number().min(0).max(99999.99).optional(),
  })
)

export const bebidaParcialValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(2).maxLength(30).optional(),
    descripcion: vine.string().trim().maxLength(70).nullable().optional(),
    alcoholica: vine.boolean().optional(),
  })
)

export const envaseParcialValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(2).maxLength(50).optional(),
    volumen_ml: vine.number().min(1).max(65535).optional(),
  })
)
