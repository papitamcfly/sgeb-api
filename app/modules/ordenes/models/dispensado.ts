import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * DISPENSADO — una fila por apertura de electroválvula.
 *
 * Permite auditar cuánto líquido salió de verdad contra cuánto se pidió: la
 * diferencia entre `segundos_calculado` y `segundos_real` es lo que delata una
 * calibración desviada antes de que se note en el inventario.
 */
export default class Dispensado extends BaseModel {
  static table = 'dispensado'

  @column({ isPrimary: true, columnName: 'id_dispensado', serializeAs: 'id_dispensado' })
  declare id: number

  @column({ columnName: 'id_detalle', serializeAs: 'id_detalle' })
  declare idDetalle: number

  @column({ columnName: 'id_config', serializeAs: 'id_config' })
  declare idConfig: number

  @column({ columnName: 'volumen_solicitado_ml', serializeAs: 'volumen_solicitado_ml' })
  declare volumenSolicitadoMl: number

  /** Teórico: volumen / caudal. Lo calcula el servidor, nunca el dispositivo. */
  @column({
    columnName: 'segundos_calculado',
    serializeAs: 'segundos_calculado',
    consume: (v) => (v === null ? null : Number(v)),
  })
  declare segundosCalculado: number

  /**
   * Reportado por el Cubaitor al cerrar la válvula. NULL mientras no llegue; si
   * no llega dentro del tiempo esperado, la válvula se fuerza a cierre por
   * seguridad y el registro queda en estado error (SGEB-5006).
   */
  @column({
    columnName: 'segundos_real',
    serializeAs: 'segundos_real',
    consume: (v) => (v === null ? null : Number(v)),
  })
  declare segundosReal: number | null

  @column({ columnName: 'volumen_real_estimado_ml', serializeAs: 'volumen_real_estimado_ml' })
  declare volumenRealEstimadoMl: number | null

  @column()
  declare estado: 'ok' | 'parcial' | 'error' | 'pausado_por_insumo'

  @column.dateTime({ autoCreate: true })
  declare timestamp: DateTime
}
