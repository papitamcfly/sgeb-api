import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Notificacion extends BaseModel {
  static table = 'notificacion'

  @column({ isPrimary: true, columnName: 'id_notificacion', serializeAs: 'id_notificacion' })
  declare id: number

  @column({ columnName: 'id_evento', serializeAs: 'id_evento' })
  declare idEvento: number

  /** NULL = notificación general a todo el evento. */
  @column({ columnName: 'id_participacion', serializeAs: 'id_participacion' })
  declare idParticipacion: number | null

  @column({ columnName: 'id_cronograma', serializeAs: 'id_cronograma' })
  declare idCronograma: number | null

  @column({ columnName: 'id_solicitud', serializeAs: 'id_solicitud' })
  declare idSolicitud: number | null

  @column()
  declare tipo: 'TIEMPO_COMIDA' | 'SOLICITUD_SERVICIO' | 'GENERAL' | 'ALERTA_BOTELLA_VACIA'

  @column()
  declare canal: 'push' | 'wearable'

  @column()
  declare mensaje: string

  @column()
  declare leida: boolean

  @column.dateTime({ autoCreate: true, columnName: 'enviada_en', serializeAs: 'enviada_en' })
  declare enviadaEn: DateTime
}
