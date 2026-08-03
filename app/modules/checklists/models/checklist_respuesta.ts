import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ChecklistRespuesta extends BaseModel {
  static table = 'checklist_respuesta'

  @column({ isPrimary: true, columnName: 'id_respuesta', serializeAs: 'id_respuesta' })
  declare id: number

  @column({ columnName: 'id_instancia', serializeAs: 'id_instancia' })
  declare idInstancia: number

  @column({ columnName: 'id_item', serializeAs: 'id_item' })
  declare idItem: number

  @column()
  declare cantidad: number

  @column()
  declare hecho: boolean
}
