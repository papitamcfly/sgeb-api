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
  declare calle: string

  @column()
  declare cp: string

  @column()
  declare colonia: string

  @column()
  declare ciudad: string

  @column()
  declare estado: string

  /**
   * Centro de la geocerca de confirmación de llegada (SGEB-4003). Cambiarlas NO
   * reescribe la geocerca de eventos ya publicados: cada evento congela su
   * punto y su radio al crearse, porque de esas asistencias dependen pagos.
   *
   * `consume` fuerza a número: el driver de PostgreSQL entrega los DECIMAL como
   * cadena para no perder precisión, y sin esto una comparación de distancia
   * terminaría haciendo aritmética con strings.
   */
  @column({ consume: (v) => (v === null ? null : Number(v)) })
  declare latitud: number

  @column({ consume: (v) => (v === null ? null : Number(v)) })
  declare longitud: number

  @column({ columnName: 'capacidad_max_mesas', serializeAs: 'capacidad_max_mesas' })
  declare capacidadMaxMesas: number

  @column({ columnName: 'capacidad_personas', serializeAs: 'capacidad_personas' })
  declare capacidadPersonas: number

  @column()
  declare activo: boolean
}
