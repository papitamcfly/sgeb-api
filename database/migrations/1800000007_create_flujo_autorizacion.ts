import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tablas del flujo de autorización — NO están en el Diccionario de Datos v3.
 *
 * El Diccionario documentó el modelo de credenciales directas (ROPC), donde el
 * login devolvía tokens de inmediato. Al adoptar el flujo de código de
 * autorización (Entorno Tecnológico v0.4 §8.4) aparecen dos estados
 * intermedios que antes no existían y que hay que persistir:
 *
 *   FLUJO_AUTORIZACION  ata las pantallas del proveedor (S1→S3) a la solicitud
 *                       /authorize que las originó. Sin él, la pantalla de
 *                       credenciales no sabe a qué cliente ni a qué URL
 *                       devolver al usuario.
 *
 *   CODIGO_AUTORIZACION el código de un solo uso que el cliente canjea por
 *                       tokens, junto con el desafío PKCE contra el que se
 *                       verifica.
 *
 * **Pendiente documental:** ambas deben incorporarse al Diccionario de Datos
 * como tablas 10 y 11 del módulo de identidad.
 *
 * Las dos son efímeras: 10 minutos el flujo, 60 segundos el código. Conviene
 * una tarea programada que purgue las filas vencidas, o la tabla crece sin
 * límite con basura que ya no sirve para nada.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.withSchema('auth').createTable('flujo_autorizacion', (table) => {
      table.increments('id_flujo').primary()

      /** SHA-256 del ticket. El valor en claro solo vive en la pantalla. */
      table.specificType('ticket_hash', 'char(64)').notNullable().unique()

      table.string('client_id', 40).notNullable()
      table.string('redirect_uri', 500).notNullable()
      table.string('scope', 200).notNullable()

      /** Se devuelven sin modificar al cliente; él verifica que coincidan. */
      table.string('state', 128).notNullable()
      table.string('nonce', 128).notNullable()

      /** Base64url del SHA-256 del code_verifier. Siempre S256. */
      table.string('code_challenge', 128).notNullable()

      table.boolean('consumido').notNullable().defaultTo(false)
      table.timestamp('expira_en').notNullable()
      table.timestamp('creado_en').notNullable().defaultTo(this.now())

      table.index(['expira_en'])
    })

    this.schema.withSchema('auth').createTable('codigo_autorizacion', (table) => {
      table.increments('id_codigo_autorizacion').primary()

      table.specificType('codigo_hash', 'char(64)').notNullable().unique()
      table
        .integer('id_usuario')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('CASCADE')

      table.string('client_id', 40).notNullable()
      table.string('redirect_uri', 500).notNullable()
      table.string('scope', 200).notNullable()
      table.string('nonce', 128).notNullable()
      table.string('code_challenge', 128).notNullable()

      /**
       * Un código es de un solo uso. `usado` no se borra al consumirse: hay que
       * poder DETECTAR el segundo intento, que es señal de intercepción y
       * dispara la revocación de los tokens que emitió el primero (SSO-1015).
       * Borrar la fila haría que el segundo canje se viera igual que un código
       * inventado, y se perdería la señal.
       */
      table.boolean('usado').notNullable().defaultTo(false)
      table.timestamp('usado_en').nullable()
      table.timestamp('expira_en').notNullable()
      table.timestamp('creado_en').notNullable().defaultTo(this.now())

      table.index(['expira_en'])
      table.index(['id_usuario'])
    })
  }

  async down() {
    this.schema.withSchema('auth').dropTableIfExists('codigo_autorizacion')
    this.schema.withSchema('auth').dropTableIfExists('flujo_autorizacion')
  }
}
