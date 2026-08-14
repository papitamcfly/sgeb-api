import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * PETICION_IP — contador del límite por IP.
 *
 * El bloqueo por cuenta ya existía, pero no detiene el ataque distribuido:
 * probar tres contraseñas contra mil correos nunca dispara un bloqueo por
 * cuenta. Esta tabla cierra ese hueco por el otro eje.
 *
 * Vive en `auth` porque solo la usan los endpoints del proveedor.
 *
 * **Pendiente documental:** incorporarla como tabla 13 del módulo de identidad.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.withSchema('auth').createTable('peticion_ip', (table) => {
      table.increments('id_peticion').primary()

      /** 45 caracteres para admitir IPv6. */
      table.string('ip', 45).notNullable()

      /** `login`, `verificacion`, `recuperacion`, `registro`, `token`, `publico`. */
      table.string('accion', 30).notNullable()

      table.timestamp('creado_en').notNullable().defaultTo(this.now())

      /**
       * Índice compuesto en el orden de la consulta: filtra por IP y acción, y
       * acota por fecha. Sin él, cada petición sensible haría un recorrido
       * completo de una tabla que crece con el tráfico.
       */
      table.index(['ip', 'accion', 'creado_en'], 'peticion_ip_ventana')
      /** Para la purga, que filtra solo por fecha. */
      table.index(['creado_en'], 'peticion_ip_purga')
    })
  }

  async down() {
    this.schema.withSchema('auth').dropTableIfExists('peticion_ip')
  }
}
