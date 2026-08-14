import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class BloqueoCuenta extends BaseModel {
  static table = 'auth.bloqueo_cuenta'

  @column({ isPrimary: true, columnName: 'id_bloqueo', serializeAs: null })
  declare id: number

  @column({ columnName: 'id_usuario', serializeAs: null })
  declare idUsuario: number

  @column()
  declare motivo: 'intentos_excedidos' | 'manual'

  @column({ columnName: 'intentos_acumulados', serializeAs: 'intentos_acumulados' })
  declare intentosAcumulados: number | null

  @column.dateTime({ autoCreate: true })
  declare inicio: DateTime

  /** NULL = indefinido; solo válido para bloqueos manuales. */
  @column.dateTime()
  declare fin: DateTime | null

  @column({ columnName: 'levantado_por', serializeAs: null })
  declare levantadoPor: number | null

  @column()
  declare activo: boolean
}
