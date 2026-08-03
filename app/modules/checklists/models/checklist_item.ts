import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ChecklistItem extends BaseModel {
  static table = 'checklist_item'

  @column({ isPrimary: true, columnName: 'id_item', serializeAs: 'id_item' })
  declare id: number

  @column({ columnName: 'id_checklist', serializeAs: 'id_checklist' })
  declare idChecklist: number

  @column()
  declare descripcion: string

  @column({ columnName: 'cantidad_esperada', serializeAs: 'cantidad_esperada' })
  declare cantidadEsperada: number

  @column()
  declare orden: number

  @column()
  declare activo: boolean
}
