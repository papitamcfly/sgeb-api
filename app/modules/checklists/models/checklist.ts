import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import ChecklistItem from './checklist_item.js'

export default class Checklist extends BaseModel {
  static table = 'checklist'

  @column({ isPrimary: true, columnName: 'id_checklist', serializeAs: 'id_checklist' })
  declare id: number

  @column()
  declare nombre: string

  @column()
  declare tipo: 'montaje' | 'servicio' | 'cierre'

  @column()
  declare activo: boolean

  @hasMany(() => ChecklistItem, { foreignKey: 'idChecklist', localKey: 'id' })
  declare items: HasMany<typeof ChecklistItem>
}
