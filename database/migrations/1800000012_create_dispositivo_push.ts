import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * DISPOSITIVO_PUSH — tokens de Firebase Cloud Messaging.
 *
 * No está en el Diccionario. Es infraestructura de entrega, no dominio: el
 * SGEB no necesita saber a qué teléfonos manda para funcionar.
 *
 * Va en `public` y **no en `auth`**, aunque se parezca a DISPOSITIVO_CONFIABLE.
 * Son cosas distintas: aquel autentica —permite saltar el segundo factor— y
 * este solo dice a dónde entregar un aviso. Meterlo en `auth` ataría el envío
 * de notificaciones a la ruta de extracción del proveedor sin ninguna razón.
 *
 * **Pendiente documental:** incorporarla al Diccionario como tabla 31.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('dispositivo_push', (table) => {
      table.increments('id_dispositivo_push').primary()

      table
        .integer('id_usuario')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('CASCADE')

      /**
       * El token de FCM. UNIQUE porque la app lo reenvía en cada arranque —FCM
       * puede rotarlo— y sin esto se acumularía una fila por sesión, mandando
       * la misma notificación varias veces al mismo teléfono.
       *
       * Hasta 4096 caracteres: los tokens de FCM no tienen longitud fija y han
       * crecido entre versiones del SDK.
       */
      table.string('token', 4096).notNullable().unique()

      table
        .enum('plataforma', ['ios', 'android', 'web'], {
          useNative: true,
          enumName: 'plataforma_push',
          schemaName: 'public',
        })
        .notNullable()

      /**
       * Se pone en false cuando FCM reporta el token como muerto —la app se
       * desinstaló, o el sistema lo rotó—. No se borra: saber cuántos
       * dispositivos perdió un usuario ayuda a diagnosticar por qué no recibe
       * avisos.
       */
      table.boolean('activo').notNullable().defaultTo(true)

      table.timestamp('creado_en').notNullable().defaultTo(this.now())
      table.timestamp('actualizado_en').notNullable().defaultTo(this.now())

      table.index(['id_usuario', 'activo'])
    })
  }

  async down() {
    this.schema.dropTableIfExists('dispositivo_push')
    this.schema.raw('DROP TYPE IF EXISTS plataforma_push')
  }
}
