import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Rol from './rol.js'

/**
 * USUARIO — tabla del módulo de identidad.
 *
 * Vive en el esquema `auth`, sin llaves foráneas hacia ninguna tabla de dominio
 * y sin que ninguna tabla de dominio la referencie. Ese aislamiento es lo que
 * permite mover el módulo a otra base de datos sin migración.
 *
 * **Solo IdentidadService importa este modelo.** Si aparece en un servicio de
 * eventos, de órdenes o de pagos, la extracción del SSO deja de ser posible.
 */
export default class Usuario extends BaseModel {
  static table = 'auth.usuario'

  /**
   * Identificador interno. Llave de todos los JOIN del módulo.
   *
   * `serializeAs: null` lo saca de cualquier salida JSON: es la garantía a
   * nivel de modelo de que el entero no se escapa por un `expand`, una relación
   * anidada o un serializador que alguien escriba distraído.
   */
  @column({ isPrimary: true, serializeAs: null })
  declare id: number

  /** Identificador público. Coincide con el claim `sub` del JWT. Inmutable. */
  @column({ serializeAs: 'uuid_usuario' })
  declare uuidUsuario: string

  @column({ serializeAs: null })
  declare idRol: number

  @column()
  declare nombre: string

  @column({ serializeAs: 'apellido_paterno' })
  declare apellidoPaterno: string

  @column({ serializeAs: 'apellido_materno' })
  declare apellidoMaterno: string | null

  @column()
  declare correo: string

  /** Nunca sale del servidor, en ninguna circunstancia. */
  @column({ serializeAs: null })
  declare passwordHash: string

  @column()
  declare telefono: string | null

  @column()
  declare activo: boolean

  @column.dateTime({ autoCreate: true, serializeAs: 'creado_en' })
  declare creadoEn: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true, serializeAs: 'actualizado_en' })
  declare actualizadoEn: DateTime

  @belongsTo(() => Rol, { foreignKey: 'idRol' })
  declare rol: BelongsTo<typeof Rol>
}
