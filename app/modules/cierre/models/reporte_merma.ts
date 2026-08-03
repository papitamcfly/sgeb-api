import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import MermaDetalle from './merma_detalle.js'

export default class ReporteMerma extends BaseModel {
  static table = 'reporte_merma'

  @column({ isPrimary: true, columnName: 'id_reporte', serializeAs: 'id_reporte' })
  declare id: number

  @column({ columnName: 'id_evento', serializeAs: 'id_evento' })
  declare idEvento: number

  /** Entero interno; hacia afuera se expone el UUID del capitán. */
  @column({ columnName: 'id_generado_por', serializeAs: null })
  declare idGeneradoPor: number

  @column()
  declare observaciones: string | null

  @column.dateTime({ autoCreate: true })
  declare fecha: DateTime

  @hasMany(() => MermaDetalle, { foreignKey: 'idReporte', localKey: 'id' })
  declare detalles: HasMany<typeof MermaDetalle>
}
