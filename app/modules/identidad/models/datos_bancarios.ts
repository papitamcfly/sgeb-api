import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * DATOS_BANCARIOS — módulo de nómina, NO de identidad.
 *
 * La CLABE nunca toca las tablas de autenticación (regla transversal del
 * Diccionario v3). El endpoint de registro por invitación orquesta ambos
 * módulos en una sola transacción, pero los datos viven separados.
 */
export default class DatosBancarios extends BaseModel {
  static table = 'datos_bancarios'

  @column({ isPrimary: true, columnName: 'id_datos', serializeAs: 'id_datos' })
  declare id: number

  @column({ columnName: 'id_usuario', serializeAs: null })
  declare idUsuario: number

  /**
   * Se enmascara SIEMPRE al salir. El valor completo no abandona el servidor:
   * ni en respuestas, ni en logs, ni en `technical_message`.
   */
  @column({ serialize: (v: string | null) => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : null) })
  declare clabe: string

  @column()
  declare banco: string

  @column({ columnName: 'titular_cuenta', serializeAs: 'titular_cuenta' })
  declare titularCuenta: string

  @column()
  declare activo: boolean
}
