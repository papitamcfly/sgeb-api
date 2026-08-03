import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Evento from './evento.js'

export default class Mesa extends BaseModel {
  static table = 'mesa'

  @column({ isPrimary: true, columnName: 'id_mesa', serializeAs: 'id_mesa' })
  declare id: number

  @column({ columnName: 'id_evento', serializeAs: 'id_evento' })
  declare idEvento: number

  @column()
  declare etiqueta: string

  /**
   * UUID impreso en el QR, único a nivel global: el comensal escanea sin decir
   * a qué evento pertenece, así que el código por sí solo debe resolver la mesa.
   * Regenerarlo emite un UUID nuevo e invalida el anterior (SGEB-3003 para quien
   * tenga la vista abierta con el código viejo).
   */
  @column({ columnName: 'codigo_qr', serializeAs: 'codigo_qr' })
  declare codigoQr: string

  @column({ columnName: 'nfc_uid', serializeAs: 'nfc_uid' })
  declare nfcUid: string | null

  @column()
  declare estado: 'libre' | 'ocupada'

  @belongsTo(() => Evento, { foreignKey: 'idEvento', localKey: 'id' })
  declare evento: BelongsTo<typeof Evento>
}
