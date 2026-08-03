import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type ParticipacionEstado =
  | 'aparto'
  | 'seleccionado'
  | 'confirmo_asistencia'
  | 'confirmo_llegada'
  | 'asignado'
  | 'vinculo'
  | 'salida'

/**
 * PARTICIPACION_EVENTO — ciclo de vida del mesero dentro de un evento.
 *
 * Es una máquina de estados: el orden del enumerado ES la secuencia válida.
 * Las transiciones fuera de orden responden SGEB-4011.
 */
export default class ParticipacionEvento extends BaseModel {
  static table = 'participacion_evento'

  @column({ isPrimary: true, columnName: 'id_participacion', serializeAs: 'id_participacion' })
  declare id: number

  @column({ columnName: 'id_evento', serializeAs: 'id_evento' })
  declare idEvento: number

  /** Entero interno; hacia afuera el mesero se expone como `uuid_usuario`. */
  @column({ columnName: 'id_usuario', serializeAs: null })
  declare idUsuario: number

  @column()
  declare puesto: 'mesero' | 'barra'

  @column()
  declare estado: ParticipacionEstado

  @column.dateTime({ columnName: 'fecha_aparto', serializeAs: 'fecha_aparto' })
  declare fechaAparto: DateTime | null

  @column.dateTime({ columnName: 'fecha_seleccion', serializeAs: 'fecha_seleccion' })
  declare fechaSeleccion: DateTime | null

  @column.dateTime({
    columnName: 'fecha_confirma_asistencia',
    serializeAs: 'fecha_confirma_asistencia',
  })
  declare fechaConfirmaAsistencia: DateTime | null

  @column.dateTime({ columnName: 'fecha_llegada', serializeAs: 'fecha_llegada' })
  declare fechaLlegada: DateTime | null

  @column.dateTime({ columnName: 'fecha_salida', serializeAs: 'fecha_salida' })
  declare fechaSalida: DateTime | null

  /** Bloquea la asignación de mesas mientras sea false (SGEB-4005). */
  @column({ columnName: 'checklist_ok', serializeAs: 'checklist_ok' })
  declare checklistOk: boolean
}
