import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class CodigoVerificacion extends BaseModel {
  static table = 'auth.codigo_verificacion'

  @column({ isPrimary: true, columnName: 'id_codigo', serializeAs: null })
  declare id: number

  @column({ columnName: 'id_usuario', serializeAs: null })
  declare idUsuario: number

  /** Bcrypt del código de 6 dígitos. Nunca en claro, ni en logs. */
  @column({ columnName: 'codigo_hash', serializeAs: null })
  declare codigoHash: string

  @column()
  declare proposito: 'login' | 'registro'

  @column()
  declare canal: 'correo'

  /** Al llegar a 5, el código se invalida (SSO-1010). */
  @column({ columnName: 'intentos_fallidos', serializeAs: 'intentos_fallidos' })
  declare intentosFallidos: number

  /** Tope 3, con espera mínima de 60 s entre reenvíos (SSO-1011). */
  @column()
  declare reenvios: number

  @column()
  declare usado: boolean

  @column.dateTime({ columnName: 'expira_en', serializeAs: 'expira_en' })
  declare expiraEn: DateTime

  @column.dateTime({ autoCreate: true, columnName: 'creado_en', serializeAs: 'creado_en' })
  declare creadoEn: DateTime
}
