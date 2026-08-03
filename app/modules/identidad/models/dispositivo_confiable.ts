import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class DispositivoConfiable extends BaseModel {
  static table = 'auth.dispositivo_confiable'

  @column({ isPrimary: true, columnName: 'id_dispositivo', serializeAs: null })
  declare id: number

  @column({ columnName: 'id_usuario', serializeAs: null })
  declare idUsuario: number

  @column({ columnName: 'token_hash', serializeAs: null })
  declare tokenHash: string

  @column({ columnName: 'nombre_dispositivo', serializeAs: 'nombre_dispositivo' })
  declare nombreDispositivo: string | null

  @column()
  declare plataforma: 'web' | 'ios' | 'android'

  @column({ columnName: 'user_agent', serializeAs: 'user_agent' })
  declare userAgent: string | null

  @column.dateTime({ columnName: 'expira_en', serializeAs: 'expira_en' })
  declare expiraEn: DateTime

  @column()
  declare activo: boolean

  @column.dateTime({ autoCreate: true, columnName: 'creado_en', serializeAs: 'creado_en' })
  declare creadoEn: DateTime

  @column.dateTime({ columnName: 'ultimo_uso', serializeAs: 'ultimo_uso' })
  declare ultimoUso: DateTime | null
}
