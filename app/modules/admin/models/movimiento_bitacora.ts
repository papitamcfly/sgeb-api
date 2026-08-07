import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class MovimientoBitacora extends BaseModel {
  static table = 'movimiento_bitacora'

  @column({ isPrimary: true, columnName: 'id_bitacora', serializeAs: 'id_bitacora' })
  declare id: number

  @column({ columnName: 'tipo_entidad', serializeAs: 'tipo_entidad' })
  declare tipoEntidad: string

  @column({ columnName: 'id_entidad', serializeAs: 'id_entidad' })
  declare idEntidad: number | null

  @column()
  declare accion:
    | 'crear'
    | 'actualizar'
    | 'desactivar'
    | 'activar'
    | 'eliminar'
    | 'aprobar'
    | 'cancelar'

  /** UUID: es lo unico que permite cruzar el movimiento con los logs del SSO. */
  @column({ columnName: 'uuid_usuario_responsable', serializeAs: 'uuid_usuario_responsable' })
  declare uuidUsuarioResponsable: string | null

  @column()
  declare detalle: string | null

  /** No se serializa: es dato de auditoria interna, no del panel. */
  @column({ serializeAs: null })
  declare ip: string | null

  @column.dateTime({ autoCreate: true })
  declare timestamp: DateTime
}
