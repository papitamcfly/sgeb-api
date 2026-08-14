import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Rol from './rol.js'

/**
 * USUARIO — tabla del módulo de identidad.
 *
 * Vive en `public` porque es la tabla más referenciada del dominio (evento,
 * participación, merma, datos bancarios). Las tablas del esquema `auth` apuntan
 * hacia ella, nunca al revés: esa dirección es la que permite desprender el
 * módulo de identidad sin dejar referencias colgando (Anexo D, Diccionario v3).
 *
 * **Solo IdentidadService importa este modelo.** Si aparece en un servicio de
 * eventos, de órdenes o de pagos, la extracción del SSO deja de ser posible:
 * el dominio debe conocer a los usuarios por UUID a través de la interfaz.
 */
export default class Usuario extends BaseModel {
  static table = 'usuario'

  /**
   * Identificador interno. Llave de todos los JOIN del módulo.
   *
   * `serializeAs: null` lo saca de cualquier salida JSON: es la garantía a
   * nivel de modelo de que el entero no se escapa por un `expand`, una relación
   * anidada o un serializador que alguien escriba distraído.
   */
  @column({ isPrimary: true, columnName: 'id_usuario', serializeAs: null })
  declare id: number

  /** Identificador público. Coincide con el claim `sub` del JWT. Inmutable. */
  @column({ columnName: 'uuid_usuario', serializeAs: 'uuid_usuario' })
  declare uuidUsuario: string

  @column({ columnName: 'id_rol', serializeAs: null })
  declare idRol: number

  @column()
  declare nombre: string

  @column({ columnName: 'apellido_paterno', serializeAs: 'apellido_paterno' })
  declare apellidoPaterno: string

  @column({ columnName: 'apellido_materno', serializeAs: 'apellido_materno' })
  declare apellidoMaterno: string | null

  @column()
  declare correo: string

  /** Nunca sale del servidor, en ninguna circunstancia. */
  @column({ columnName: 'password_hash', serializeAs: null })
  declare passwordHash: string

  @column()
  declare telefono: string | null

  @column({ columnName: 'biometria_habilitada', serializeAs: null })
  declare biometriaHabilitada: boolean

  @column()
  declare activo: boolean

  @column.dateTime({ autoCreate: true, columnName: 'creado_en', serializeAs: 'creado_en' })
  declare creadoEn: DateTime


  @belongsTo(() => Rol, { foreignKey: 'idRol', localKey: 'id' })
  declare rol: BelongsTo<typeof Rol>
}
