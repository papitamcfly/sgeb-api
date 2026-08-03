import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class MermaDetalle extends BaseModel {
  static table = 'merma_detalle'

  @column({ isPrimary: true, columnName: 'id_merma_det', serializeAs: 'id_merma_det' })
  declare id: number

  @column({ columnName: 'id_reporte', serializeAs: 'id_reporte' })
  declare idReporte: number

  @column()
  declare tipo: 'vaso_roto' | 'plato_roto' | 'copa_rota' | 'comida_desperdiciada' | 'otro'

  @column()
  declare descripcion: string | null

  @column()
  declare cantidad: number

  /** NULL cuando el capitán no puede estimarlo; el dashboard lo cuenta como 0. */
  @column({
    columnName: 'costo_estimado',
    serializeAs: 'costo_estimado',
    consume: (v) => (v === null ? null : Number(v)),
  })
  declare costoEstimado: number | null
}
