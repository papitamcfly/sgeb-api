import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import RecetaIngrediente from './receta_ingrediente.js'

export default class Bebida extends BaseModel {
  static table = 'bebida'

  @column({ isPrimary: true, columnName: 'id_bebida', serializeAs: 'id_bebida' })
  declare id: number

  @column()
  declare nombre: string

  @column()
  declare descripcion: string | null

  @column()
  declare alcoholica: boolean

  @column()
  declare activo: boolean

  @hasMany(() => RecetaIngrediente, { foreignKey: 'idBebida', localKey: 'id' })
  declare receta: HasMany<typeof RecetaIngrediente>
}
