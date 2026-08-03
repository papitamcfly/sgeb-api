import { BaseModel, column } from '@adonisjs/lucid/orm'

export type TipoPorcion = 'PROPORCION' | 'FIJO_ML' | 'RESTO'

/**
 * RECETA_INGREDIENTE — cómo se arma cada bebida.
 *
 *   PROPORCION → fracción 0.00–1.00 del volumen del envase
 *   FIJO_ML    → mililitros exactos, sin importar el envase
 *   RESTO      → lo que sobre tras aplicar los anteriores; `valor` se ignora
 *
 * `ordenServido` importa físicamente: el alcohol va primero y el refresco al
 * final, porque el vaso lleva hielo y el orden inverso lo desborda.
 */
export default class RecetaIngrediente extends BaseModel {
  static table = 'receta_ingrediente'

  @column({ isPrimary: true, columnName: 'id_receta_ing', serializeAs: 'id_receta_ing' })
  declare id: number

  @column({ columnName: 'id_bebida', serializeAs: 'id_bebida' })
  declare idBebida: number

  @column({ columnName: 'id_insumo', serializeAs: 'id_insumo' })
  declare idInsumo: number

  @column({ columnName: 'tipo_porcion', serializeAs: 'tipo_porcion' })
  declare tipoPorcion: TipoPorcion

  @column({ consume: (v) => (v === null ? null : Number(v)) })
  declare valor: number

  @column({ columnName: 'orden_servido', serializeAs: 'orden_servido' })
  declare ordenServido: number
}
