import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Pago extends BaseModel {
  static table = 'pago'

  @column({ isPrimary: true, columnName: 'id_pago', serializeAs: 'id_pago' })
  declare id: number

  @column({ columnName: 'id_participacion', serializeAs: 'id_participacion' })
  declare idParticipacion: number

  @column({ consume: (v) => (v === null ? null : Number(v)) })
  declare monto: number

  /**
   * Snapshot de la CLABE al calcular el pago, enmascarado al salir (`0120…8903`).
   * Es la razón por la que DATOS_BANCARIOS nunca se borra físicamente: si el
   * mesero cambia de cuenta después, este registro debe seguir diciendo a dónde
   * se transfirió realmente el dinero.
   */
  @column({
    columnName: 'clabe_destino',
    serializeAs: 'clabe_destino',
    serialize: (v: string | null) => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : null),
  })
  declare clabeDestino: string

  @column()
  declare estado: 'pendiente' | 'pagado' | 'fallido' | 'cancelado'

  @column()
  declare referencia: string | null

  @column.dateTime({ columnName: 'fecha_pago', serializeAs: 'fecha_pago' })
  declare fechaPago: DateTime | null
}
