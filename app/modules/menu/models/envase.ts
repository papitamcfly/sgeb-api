import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Envase extends BaseModel {
  static table = 'envase'

  @column({ isPrimary: true, columnName: 'id_envase', serializeAs: 'id_envase' })
  declare id: number

  @column()
  declare nombre: string

  /**
   * Cambiarlo NO recalcula órdenes ya levantadas: el volumen viaja congelado en
   * ORDEN_DETALLE.volumen_total_ml, o se alteraría el consumo histórico de
   * insumos de eventos ya cerrados.
   */
  @column({ columnName: 'volumen_ml', serializeAs: 'volumen_ml' })
  declare volumenMl: number

  @column()
  declare activo: boolean
}
