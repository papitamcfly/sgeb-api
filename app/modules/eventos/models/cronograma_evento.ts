import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class CronogramaEvento extends BaseModel {
  static table = 'cronograma_evento'

  @column({ isPrimary: true, columnName: 'id_cronograma', serializeAs: 'id_cronograma' })
  declare id: number

  @column({ columnName: 'id_evento', serializeAs: 'id_evento' })
  declare idEvento: number

  @column({ columnName: 'tipo_tiempo', serializeAs: 'tipo_tiempo' })
  declare tipoTiempo: 'ENTRADA' | 'FUERTE' | 'POSTRE' | 'OTRO'

  @column({ columnName: 'hora_objetivo', serializeAs: 'hora_objetivo' })
  declare horaObjetivo: string

  @column()
  declare descripcion: string | null

  /**
   * Bandera de idempotencia. Sin ella, un reinicio del proceso que recorre el
   * cronograma vuelve a notificar hitos ya enviados y los meseros reciben
   * "sirvan el postre" tres veces.
   */
  @column()
  declare disparado: boolean

  @column.dateTime({ columnName: 'fecha_disparo', serializeAs: 'fecha_disparo' })
  declare fechaDisparo: DateTime | null
}
