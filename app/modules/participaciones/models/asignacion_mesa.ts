import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Mesa from '#modules/eventos/models/mesa'
import ParticipacionEvento from '#modules/participaciones/models/participacion_evento'

export default class AsignacionMesa extends BaseModel {
  static table = 'asignacion_mesa'

  @column({ isPrimary: true, columnName: 'id_asignacion', serializeAs: 'id_asignacion' })
  declare id: number

  @column({ columnName: 'id_participacion', serializeAs: 'id_participacion' })
  declare idParticipacion: number

  @column({ columnName: 'id_mesa', serializeAs: 'id_mesa' })
  declare idMesa: number

  /**
   * El capitán asigna; el mesero vincula escaneando el QR/NFC en la mesa. La
   * diferencia importa: una mesa asignada pero no vinculada significa que el
   * mesero aún no llegó físicamente a ella.
   */
  @column()
  declare vinculada: boolean

  @column.dateTime({ autoCreate: true, columnName: 'fecha_asignacion', serializeAs: 'fecha_asignacion' })
  declare fechaAsignacion: DateTime

  @column.dateTime({ columnName: 'fecha_vinculacion', serializeAs: 'fecha_vinculacion' })
  declare fechaVinculacion: DateTime | null

  /**
   * Vigencia de la asignación, **ortogonal a `vinculada`**.
   *
   * Antes `vinculada = false` significaba a la vez "recién asignada" y "ya
   * liberada", y eran indistinguibles: el panel seguía mostrando al mesero con
   * mesa después de quitársela.
   *
   *   activa=true,  vinculada=false → asignada, el mesero no ha llegado
   *   activa=true,  vinculada=true  → el mesero está en la mesa
   *   activa=false                  → liberada
   */
  @column()
  declare activa: boolean

  @column.dateTime({ columnName: 'fecha_liberacion', serializeAs: 'fecha_liberacion' })
  declare fechaLiberacion: DateTime | null

  /**
   * Mesa y participación se precargan en el readback del panel de piso: la
   * fila sola solo tiene enteros, y el capitán necesita ver qué etiqueta de
   * mesa tiene qué mesero.
   */
  @belongsTo(() => Mesa, { foreignKey: 'idMesa', localKey: 'id' })
  declare mesa: BelongsTo<typeof Mesa>

  @belongsTo(() => ParticipacionEvento, { foreignKey: 'idParticipacion', localKey: 'id' })
  declare participacion: BelongsTo<typeof ParticipacionEvento>
}
