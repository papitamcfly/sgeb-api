import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class TokenRecuperacion extends BaseModel {
  static table = 'auth.token_recuperacion'

  @column({ isPrimary: true, columnName: 'id_token', serializeAs: null })
  declare id: number

  @column({ columnName: 'id_usuario', serializeAs: null })
  declare idUsuario: number

  @column({ columnName: 'token_hash', serializeAs: null })
  declare tokenHash: string

  @column()
  declare usado: boolean

  @column.dateTime({ columnName: 'expira_en', serializeAs: 'expira_en' })
  declare expiraEn: DateTime

  @column({ columnName: 'ip_solicitud', serializeAs: null })
  declare ipSolicitud: string | null

  @column.dateTime({ columnName: 'usado_en', serializeAs: 'usado_en' })
  declare usadoEn: DateTime | null

  @column.dateTime({ autoCreate: true, columnName: 'creado_en', serializeAs: 'creado_en' })
  declare creadoEn: DateTime
}
