import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class SolicitudServicio extends BaseModel {
  static table = 'solicitud_servicio'

  @column({ isPrimary: true, columnName: 'id_solicitud', serializeAs: 'id_solicitud' })
  declare id: number

  @column({ columnName: 'id_mesa', serializeAs: 'id_mesa' })
  declare idMesa: number

  /** NULL mientras nadie la toma. Al atenderla se registra quién (SGEB-4021). */
  @column({ columnName: 'id_participacion', serializeAs: 'id_participacion' })
  declare idParticipacion: number | null

  @column()
  declare tipo: 'atencion' | 'cuenta' | 'otro'

  /**
   * `cancelada` no esta en el Diccionario (tabla 24) pero si en el OpenAPI, y
   * la necesidad operativa es real: sin un estado terminal distinto de
   * `atendida`, una solicitud que nadie atiende bloquearia la mesa para siempre
   * por el anti-spam de SGEB-4014. Ver la migracion 010.
   */
  @column()
  declare estado: 'pendiente' | 'atendida' | 'cancelada'

  @column.dateTime({ autoCreate: true, columnName: 'creada_en', serializeAs: 'creada_en' })
  declare creadaEn: DateTime

  @column.dateTime({ columnName: 'atendida_en', serializeAs: 'atendida_en' })
  declare atendidaEn: DateTime | null
}
