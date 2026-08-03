import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type MotivoFallo =
  | 'credenciales_invalidas'
  | 'cuenta_desactivada'
  | 'bloqueo_temporal'
  | 'codigo_invalido'
  | 'codigo_expirado'
  | 'invitacion_expirada'
  | 'token_expirado'

/**
 * Bitácora de intentos. Base del bloqueo temporal por fuerza bruta.
 *
 * Se registra el correo aunque no exista la cuenta: es lo que permite detectar
 * a alguien probando direcciones al azar, que no dejaría rastro si solo se
 * guardaran los intentos contra cuentas reales.
 */
export default class IntentoLogin extends BaseModel {
  static table = 'auth.intento_login'

  @column({ isPrimary: true, columnName: 'id_intento', serializeAs: null })
  declare id: number

  @column({ columnName: 'id_usuario', serializeAs: null })
  declare idUsuario: number | null

  @column({ columnName: 'correo_capturado', serializeAs: null })
  declare correoCapturado: string

  @column()
  declare metodo: 'password' | 'codigo_2fa'

  @column()
  declare exitoso: boolean

  @column({ columnName: 'motivo_fallo', serializeAs: 'motivo_fallo' })
  declare motivoFallo: MotivoFallo | null

  @column({ columnName: 'codigo_error', serializeAs: 'codigo_error' })
  declare codigoError: string | null

  @column()
  declare ip: string | null

  @column({ columnName: 'user_agent', serializeAs: null })
  declare userAgent: string | null

  @column.dateTime({ autoCreate: true })
  declare timestamp: DateTime
}
