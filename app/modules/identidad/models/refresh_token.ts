import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class RefreshToken extends BaseModel {
  static table = 'auth.refresh_token'

  @column({ isPrimary: true, columnName: 'id_refresh', serializeAs: null })
  declare id: number

  @column({ columnName: 'id_usuario', serializeAs: null })
  declare idUsuario: number

  @column({ columnName: 'id_dispositivo', serializeAs: null })
  declare idDispositivo: number | null

  /** SHA-256 del token. El valor en claro viaja al cliente una sola vez. */
  @column({ columnName: 'token_hash', serializeAs: null })
  declare tokenHash: string

  /**
   * Encadenamiento de la rotación. Presentar un token que ya rotó significa que
   * alguien más lo tenía: se revoca la cadena completa (SSO-1007). Sin
   * `idPadre` no habría forma de saber qué revocar.
   */
  @column({ columnName: 'id_padre', serializeAs: null })
  declare idPadre: number | null

  @column()
  declare cliente: 'web' | 'movil'

  @column({ columnName: 'metodo_login', serializeAs: 'metodo_login' })
  declare metodoLogin: 'password' | 'password_2fa'

  @column()
  declare ip: string | null

  @column({ columnName: 'user_agent', serializeAs: 'user_agent' })
  declare userAgent: string | null

  @column.dateTime({ columnName: 'expira_en', serializeAs: 'expira_en' })
  declare expiraEn: DateTime

  @column()
  declare revocado: boolean

  @column.dateTime({ autoCreate: true, columnName: 'creado_en', serializeAs: 'creado_en' })
  declare creadoEn: DateTime

  @column.dateTime({ columnName: 'ultimo_uso', serializeAs: 'ultimo_uso' })
  declare ultimoUso: DateTime | null
}
