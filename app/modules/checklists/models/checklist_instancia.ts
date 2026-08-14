import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import ChecklistRespuesta from './checklist_respuesta.js'

/**
 * Instancia de un checklist para una participación concreta.
 *
 * Las instancias ya creadas conservan la versión de ítems con la que se
 * generaron: editar la plantilla solo afecta a instancias futuras (SGEB-4017).
 */
export default class ChecklistInstancia extends BaseModel {
  static table = 'checklist_instancia'

  @column({ isPrimary: true, columnName: 'id_instancia', serializeAs: 'id_instancia' })
  declare id: number

  @column({ columnName: 'id_participacion', serializeAs: 'id_participacion' })
  declare idParticipacion: number

  @column({ columnName: 'id_checklist', serializeAs: 'id_checklist' })
  declare idChecklist: number

  @column()
  declare completado: boolean

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare fecha: DateTime

  @hasMany(() => ChecklistRespuesta, { foreignKey: 'idInstancia', localKey: 'id' })
  declare respuestas: HasMany<typeof ChecklistRespuesta>
}
