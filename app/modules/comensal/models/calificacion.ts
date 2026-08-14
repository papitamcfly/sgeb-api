import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * CALIFICACION — evaluación anónima del comensal.
 *
 * El comensal no tiene cuenta, así que `token_comensal` (emitido al escanear el
 * QR) es lo ÚNICO que impide una segunda calificación desde la misma mesa
 * (SGEB-4010). Por eso es UNIQUE en la base y no una validación de aplicación.
 */
export default class Calificacion extends BaseModel {
  static table = 'calificacion'

  @column({ isPrimary: true, columnName: 'id_calificacion', serializeAs: 'id_calificacion' })
  declare id: number

  @column({ columnName: 'id_mesa', serializeAs: 'id_mesa' })
  declare idMesa: number

  @column({ columnName: 'id_participacion', serializeAs: 'id_participacion' })
  declare idParticipacion: number

  /**
   * `serializeAs: null`: nunca sale hacia el capitán. Devolverlo permitiría
   * cruzar calificaciones con el orden de escaneo y deducir quién dijo qué,
   * que es justo lo que el anonimato debe impedir.
   */
  @column({ columnName: 'token_comensal', serializeAs: null })
  declare tokenComensal: string

  @column()
  declare puntuacion: number

  @column()
  declare comentario: string | null

  @column.dateTime({ autoCreate: true, columnName: 'creada_en', serializeAs: 'creada_en' })
  declare creadaEn: DateTime
}
