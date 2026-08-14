import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * SESION_SSO — la sesión propia del proveedor de identidad.
 *
 * Tampoco está en el Diccionario de Datos v3, por la misma razón que
 * FLUJO_AUTORIZACION: el modelo de credenciales directas no tenía sesión de
 * proveedor. Es la tabla que hace posible el inicio de sesión único, y debe
 * incorporarse al Diccionario como tabla 12 del módulo de identidad.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.withSchema('auth').createTable('sesion_sso', (table) => {
      table.increments('id_sesion').primary()

      /**
       * Identificador público de la sesión. Viaja en el claim `sid` de los
       * tokens que emite: es lo que permite revocar exactamente esta cadena al
       * cerrar sesión, sin tocar las demás sesiones del usuario.
       */
      table.specificType('sid', 'char(36)').notNullable().unique()

      /** SHA-256 del secreto de la cookie. El valor en claro solo vive en el navegador. */
      table.specificType('cookie_hash', 'char(64)').notNullable().unique()

      table
        .integer('id_usuario')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('CASCADE')

      table
        .enum('metodo_login', ['password', 'password_2fa'], {
          useNative: true,
          enumName: 'metodo_login_sesion',
          schemaName: 'auth',
        })
        .notNullable()

      table.timestamp('expira_en').notNullable()
      table.boolean('revocada').notNullable().defaultTo(false)
      table.timestamp('creado_en').notNullable().defaultTo(this.now())

      table.index(['id_usuario', 'revocada'])
      table.index(['expira_en'])
    })

    /**
     * Guarda al usuario que ya pasó la contraseña pero le falta el segundo
     * factor. Va en el flujo y no en una cookie: así el paso de verificación
     * queda atado a esta solicitud concreta, y un código válido no sirve para
     * completar otro flujo distinto.
     */
    this.schema.withSchema('auth').alterTable('flujo_autorizacion', (table) => {
      table
        .integer('id_usuario_pendiente')
        .unsigned()
        .nullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('CASCADE')
    })
  }

  async down() {
    this.schema.withSchema('auth').alterTable('flujo_autorizacion', (table) => {
      table.dropColumn('id_usuario_pendiente')
    })
    this.schema.withSchema('auth').dropTableIfExists('sesion_sso')
    this.schema.raw('DROP TYPE IF EXISTS auth.metodo_login_sesion')
  }
}
