import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import OrdenDetalle from './orden_detalle.js'

/**
 * Enumerado alineado al Diccionario de Datos (tabla 20).
 * `entregada` es el estado terminal exitoso; `servida` NO existe.
 */
export type OrdenEstado =
  | 'pendiente'
  | 'en_preparacion'
  | 'dispensando'
  | 'entregada'
  | 'cancelada'
  | 'pausada_por_insumo'

export default class Orden extends BaseModel {
  static table = 'orden'

  @column({ isPrimary: true, columnName: 'id_orden', serializeAs: 'id_orden' })
  declare id: number

  @column({ columnName: 'id_mesa', serializeAs: 'id_mesa' })
  declare idMesa: number

  @column({ columnName: 'id_participacion', serializeAs: 'id_participacion' })
  declare idParticipacion: number

  @column()
  declare estado: OrdenEstado

  @column.dateTime({ autoCreate: true, columnName: 'creada_en', serializeAs: 'creada_en' })
  declare creadaEn: DateTime

  @column.dateTime({ columnName: 'entregada_en', serializeAs: 'entregada_en' })
  declare entregadaEn: DateTime | null

  @hasMany(() => OrdenDetalle, { foreignKey: 'idOrden', localKey: 'id' })
  declare detalles: HasMany<typeof OrdenDetalle>
}
