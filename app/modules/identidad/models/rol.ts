import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * ROL — catálogo fijo del sistema.
 *
 * No se crea, edita ni elimina desde el API (ver GET /roles en el OpenAPI):
 * cambiar un rol implica migrar permisos, no una operación de CRUD.
 */
export default class Rol extends BaseModel {
  static table = 'auth.rol'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nombre: 'admin' | 'capitan' | 'mesero'

  @column()
  declare descripcion: string | null
}
