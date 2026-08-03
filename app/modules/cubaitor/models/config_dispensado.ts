import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * CONFIG_DISPENSADO — qué insumo está cargado en qué pin, para un evento.
 *
 * Es la tabla que traduce "sirve una cuba" en "abre el GPIO 12 durante 3.2 s".
 */
export default class ConfigDispensado extends BaseModel {
  static table = 'config_dispensado'

  @column({ isPrimary: true, columnName: 'id_config', serializeAs: 'id_config' })
  declare id: number

  @column({ columnName: 'id_evento', serializeAs: 'id_evento' })
  declare idEvento: number

  @column({ columnName: 'id_cubaitor', serializeAs: 'id_cubaitor' })
  declare idCubaitor: number

  @column({ columnName: 'id_insumo', serializeAs: 'id_insumo' })
  declare idInsumo: number

  @column({ columnName: 'pin_gpio', serializeAs: 'pin_gpio' })
  declare pinGpio: number

  /** Resultado de calibración. Debe ser > 0 o la división del tiempo revienta. */
  @column({
    columnName: 'caudal_ml_seg',
    serializeAs: 'caudal_ml_seg',
    consume: (v) => (v === null ? null : Number(v)),
  })
  declare caudalMlSeg: number

  @column({ columnName: 'volumen_cargado_ml', serializeAs: 'volumen_cargado_ml' })
  declare volumenCargadoMl: number

  /**
   * Se descuenta con cada dispensado. Es el umbral matemático de botella vacía:
   * cuando lo solicitado excede lo disponible, la orden se pausa ANTES de abrir
   * la válvula (SGEB-4009), en lugar de servir medio vaso.
   */
  @column({ columnName: 'volumen_disponible_ml', serializeAs: 'volumen_disponible_ml' })
  declare volumenDisponibleMl: number

  @column.dateTime({ columnName: 'ultima_calibracion', serializeAs: 'ultima_calibracion' })
  declare ultimaCalibracion: DateTime | null

  @column()
  declare activo: boolean
}
