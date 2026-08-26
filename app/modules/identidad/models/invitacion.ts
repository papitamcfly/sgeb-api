import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Invitacion extends BaseModel {
  static table = 'auth.invitacion'

  @column({ isPrimary: true, columnName: 'id_invitacion', serializeAs: 'id_invitacion' })
  declare id: number

  @column({ columnName: 'id_emisor', serializeAs: null })
  declare idEmisor: number

  @column({ columnName: 'id_rol_destino', serializeAs: 'id_rol_destino' })
  declare idRolDestino: number

  @column()
  declare nombre: string

  @column({ columnName: 'apellido_paterno', serializeAs: 'apellido_paterno' })
  declare apellidoPaterno: string

  @column({ columnName: 'apellido_materno', serializeAs: 'apellido_materno' })
  declare apellidoMaterno: string | null

  @column()
  declare correo: string

  /**
   * Lo captura el capitán al invitar: ya lo conoce, es como consiguió a la
   * persona. Se copia a USUARIO al completar el registro.
   */
  @column()
  declare telefono: string | null

  @column({ columnName: 'token_hash', serializeAs: null })
  declare tokenHash: string

  @column()
  declare estado: 'pendiente' | 'usada' | 'expirada' | 'revocada'

  @column.dateTime({ columnName: 'expira_en', serializeAs: 'expira_en' })
  declare expiraEn: DateTime

  @column({ columnName: 'id_usuario_creado', serializeAs: null })
  declare idUsuarioCreado: number | null

  @column.dateTime({ columnName: 'usada_en', serializeAs: 'usada_en' })
  declare usadaEn: DateTime | null

  @column.dateTime({ autoCreate: true, columnName: 'creado_en', serializeAs: 'creado_en' })
  declare creadoEn: DateTime
}
