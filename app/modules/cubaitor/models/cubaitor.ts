import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Cubaitor extends BaseModel {
  static table = 'cubaitor'

  @column({ isPrimary: true, columnName: 'id_cubaitor', serializeAs: 'id_cubaitor' })
  declare id: number

  @column()
  declare nombre: string

  /** Identidad física del ESP32 y llave con la que se anuncia en MQTT. Inmutable. */
  @column()
  declare mac: string

  @column({ columnName: 'host_ip', serializeAs: 'host_ip' })
  declare hostIp: string | null

  @column({ columnName: 'num_pins', serializeAs: 'num_pins' })
  declare numPins: number

  @column()
  declare estado: 'activo' | 'inactivo' | 'mantenimiento'

  /**
   * Heartbeat. Si rebasa el umbral, el dashboard marca el dispositivo fuera de
   * línea (SGEB-5003) y se habilita el dispensado manual: el evento NO se
   * bloquea porque la barra automática deje de responder (RNF-13).
   */
  @column.dateTime({ columnName: 'ultima_conexion', serializeAs: 'ultima_conexion' })
  declare ultimaConexion: DateTime | null
}
