import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * INSUMO — líquidos cargados en el Cubaitor.
 *
 * `estado` y `activo` son cosas distintas y conviene no confundirlas:
 *   estado → operativo. "Se acabó la botella". Vuelve mañana.
 *   activo → de catálogo. "Ya no lo compramos". Desaparece del alta, pero sigue
 *            apareciendo en las recetas y en el consumo histórico.
 */
export default class Insumo extends BaseModel {
  static table = 'insumo'

  @column({ isPrimary: true, columnName: 'id_insumo', serializeAs: 'id_insumo' })
  declare id: number

  @column()
  declare nombre: string

  @column()
  declare tipo: 'alcohol' | 'refresco' | 'jugo' | 'agua' | 'otro'

  @column()
  declare unidad: string

  @column({ consume: (v) => (v === null ? null : Number(v)) })
  declare costo: number

  @column()
  declare estado: 'disponible' | 'bajo' | 'agotado' | 'inactivo'

  @column()
  declare activo: boolean
}
