import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Dispensado from '#modules/ordenes/models/dispensado'

/**
 * Enumerado DISTINTO al de la orden, y no debe confundirse: un detalle puede
 * estar `dispensada` mientras la orden sigue `en_preparacion` porque otro
 * renglón no ha salido.
 */
export type DetalleEstado = 'pendiente' | 'dispensada' | 'entregada' | 'pausada_por_insumo'

export default class OrdenDetalle extends BaseModel {
  static table = 'orden_detalle'

  @column({ isPrimary: true, columnName: 'id_detalle', serializeAs: 'id_detalle' })
  declare id: number

  @column({ columnName: 'id_orden', serializeAs: 'id_orden' })
  declare idOrden: number

  @column({ columnName: 'id_bebida', serializeAs: 'id_bebida' })
  declare idBebida: number

  @column({ columnName: 'id_envase', serializeAs: 'id_envase' })
  declare idEnvase: number

  @column()
  declare cantidad: number

  /** Congelado al levantar la orden: volumen_envase × cantidad. */
  @column({ columnName: 'volumen_total_ml', serializeAs: 'volumen_total_ml' })
  declare volumenTotalMl: number

  @column()
  declare estado: DetalleEstado

  /**
   * Aperturas de válvula de este renglón. Se precargan al listar órdenes para
   * que el tablero se rehidrate con **una sola consulta**: tras recargar la
   * página el frontend necesita saber qué dispensados esperan confirmación, y
   * pedirlos uno a uno serían N+1 peticiones en la pantalla que más se refresca.
   */
  @hasMany(() => Dispensado, { foreignKey: 'idDetalle', localKey: 'id' })
  declare dispensados: HasMany<typeof Dispensado>
}
