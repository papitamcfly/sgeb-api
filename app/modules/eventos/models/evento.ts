import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Salon from './salon.js'
import Mesa from './mesa.js'

export type EventoEstado = 'borrador' | 'publicado' | 'en_curso' | 'finalizado' | 'cancelado'

/**
 * EVENTO — entidad central. Todo lo demás cuelga de aquí.
 *
 * Nota sobre los usuarios: `idCapitan` e `idUsuarioCreador` son enteros porque
 * son llaves internas de JOIN. **Nunca se serializan**: hacia afuera el evento
 * expone `uuid_capitan`, que el servicio resuelve vía IdentidadService. Es la
 * misma regla del contrato: el entero de usuario no sale del backend.
 */
export default class Evento extends BaseModel {
  static table = 'evento'

  @column({ isPrimary: true, columnName: 'id_evento', serializeAs: 'id_evento' })
  declare id: number

  @column({ columnName: 'id_salon', serializeAs: 'id_salon' })
  declare idSalon: number

  @column({ columnName: 'id_capitan', serializeAs: null })
  declare idCapitan: number

  @column({ columnName: 'id_usuario_creador', serializeAs: null })
  declare idUsuarioCreador: number

  @column()
  declare titulo: string

  @column()
  declare tipo: 'social' | 'empresarial'

  @column({ columnName: 'comanda_url', serializeAs: 'comanda_url' })
  declare comandaUrl: string | null

  @column.date()
  declare fecha: DateTime

  @column({ columnName: 'hora_presentacion', serializeAs: 'hora_presentacion' })
  declare horaPresentacion: string

  @column.dateTime()
  declare inicio: DateTime

  @column.dateTime()
  declare fin: DateTime | null

  @column({ columnName: 'cupo_meseros', serializeAs: 'cupo_meseros' })
  declare cupoMeseros: number

  @column({ columnName: 'num_mesas', serializeAs: 'num_mesas' })
  declare numMesas: number

  @column({
    columnName: 'tarifa_por_mesero',
    serializeAs: 'tarifa_por_mesero',
    consume: (v) => (v === null ? null : Number(v)),
  })
  declare tarifaPorMesero: number

  /**
   * Congelado al crear el evento. Si el salón se recoloca después, los eventos
   * ya publicados conservan el suyo: de esas asistencias dependen pagos ya
   * calculados y reescribirlas los invalidaría retroactivamente.
   */
  @column({ columnName: 'radio_geocerca_m', serializeAs: 'radio_geocerca_m' })
  declare radioGeocercaM: number

  @column()
  declare estado: EventoEstado

  @column.dateTime({ autoCreate: true, columnName: 'creado_en', serializeAs: 'creado_en' })
  declare creadoEn: DateTime

  @belongsTo(() => Salon, { foreignKey: 'idSalon', localKey: 'id' })
  declare salon: BelongsTo<typeof Salon>

  @hasMany(() => Mesa, { foreignKey: 'idEvento', localKey: 'id' })
  declare mesas: HasMany<typeof Mesa>
}
