import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * SALON — entidad de dominio. Identificador ENTERO, no UUID.
 *
 * La regla del UUID aplica solo a USUARIO, que es la única entidad que cruza
 * hacia el módulo de identidad. Un salón nunca vivirá en otra base de datos.
 */
export default class Salon extends BaseModel {
  static table = 'salon'

  @column({ isPrimary: true, columnName: 'id_salon', serializeAs: 'id_salon' })
  declare id: number

  @column()
  declare nombre: string

  @column()
  declare direccion: string

  /**
   * Coordenadas del recinto. Son el centro de la geocerca de confirmación de
   * llegada (SGEB-4003). Cambiarlas NO reescribe la geocerca de eventos ya
   * publicados: cada evento congela su punto y su radio al crearse, porque de
   * esas asistencias dependen pagos ya calculados.
   */
  @column()
  declare latitud: number

  @column()
  declare longitud: number

  @column({ columnName: 'capacidad_max_mesas', serializeAs: 'capacidad_max_mesas' })
  declare capacidadMaxMesas: number

  @column()
  declare activo: boolean

  @column.dateTime({ autoCreate: true, serializeAs: 'creado_en' })
  declare creadoEn: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true, serializeAs: 'actualizado_en' })
  declare actualizadoEn: DateTime
}
