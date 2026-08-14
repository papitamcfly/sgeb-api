import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * CONFIRMACION_LLEGADA — un renglón por INTENTO, exitoso o no.
 *
 * Los fallidos no se borran: son la evidencia con la que el capitán resuelve una
 * disputa de asistencia, y de la asistencia depende el pago.
 */
export default class ConfirmacionLlegada extends BaseModel {
  static table = 'confirmacion_llegada'

  @column({ isPrimary: true, columnName: 'id_confirmacion', serializeAs: 'id_confirmacion' })
  declare id: number

  @column({ columnName: 'id_participacion', serializeAs: 'id_participacion' })
  declare idParticipacion: number

  @column()
  declare metodo: 'huella' | 'face_id' | 'ninguno'

  /**
   * Atestación local: lo reporta la app tras invocar la API biométrica del
   * sistema. El servidor no verifica firma criptográfica; la garantía viene de
   * la vinculación de dispositivo (SGEB-4024/4025), no de la criptografía.
   */
  @column({ columnName: 'biometrico_verificado', serializeAs: 'biometrico_verificado' })
  declare biometricoVerificado: boolean

  @column({ consume: (v) => (v === null ? null : Number(v)) })
  declare latitud: number

  /**
   * DECIMAL(11,8): tres dígitos enteros. El Diccionario declara (10,8), que
   * desborda con cualquier longitud de México (−86 a −118). Ver README.
   */
  @column({ consume: (v) => (v === null ? null : Number(v)) })
  declare longitud: number

  @column({
    columnName: 'distancia_m',
    serializeAs: 'distancia_m',
    consume: (v) => (v === null ? null : Number(v)),
  })
  declare distanciaM: number

  @column({ columnName: 'dentro_geocerca', serializeAs: 'dentro_geocerca' })
  declare dentroGeocerca: boolean

  @column()
  declare resultado: 'exitoso' | 'fallido'

  @column.dateTime({ autoCreate: true })
  declare timestamp: DateTime
}
