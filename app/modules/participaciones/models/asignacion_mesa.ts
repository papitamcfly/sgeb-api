import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class AsignacionMesa extends BaseModel {
  static table = 'asignacion_mesa'

  @column({ isPrimary: true, columnName: 'id_asignacion', serializeAs: 'id_asignacion' })
  declare id: number

  @column({ columnName: 'id_participacion', serializeAs: 'id_participacion' })
  declare idParticipacion: number

  @column({ columnName: 'id_mesa', serializeAs: 'id_mesa' })
  declare idMesa: number

  /**
   * El capitán asigna; el mesero vincula escaneando el QR/NFC en la mesa. La
   * diferencia importa: una mesa asignada pero no vinculada significa que el
   * mesero aún no llegó físicamente a ella.
   */
  @column()
  declare vinculada: boolean

  @column.dateTime({ autoCreate: true, columnName: 'fecha_asignacion', serializeAs: 'fecha_asignacion' })
  declare fechaAsignacion: DateTime

  @column.dateTime({ columnName: 'fecha_vinculacion', serializeAs: 'fecha_vinculacion' })
  declare fechaVinculacion: DateTime | null
}
