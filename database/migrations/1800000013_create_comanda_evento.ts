import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * COMANDA_EVENTO — el documento que dice qué se sirve y cuándo.
 *
 * El Diccionario resuelve esto con un solo campo, `EVENTO.comanda_url`, que
 * asume que alguien pega un enlace externo a mano. Se conserva ese campo —apunta
 * a la comanda vigente— pero se agrega esta tabla por dos razones:
 *
 * 1. **La comanda es reemplazable y hay que conservar la anterior.** Si el
 *    capitán sube la equivocada a media fiesta, se puede volver. Un solo campo
 *    de texto no permite eso.
 * 2. **Hacen falta metadatos.** El tipo MIME decide si la app la abre como PDF
 *    o como imagen; el tamaño y el nombre original sirven para diagnosticar
 *    cuando alguien reporta que "no se ve".
 *
 * **Pendiente documental:** incorporarla al Diccionario como tabla 32 y anotar
 * que `EVENTO.comanda_url` pasa a guardar la clave del objeto en S3, no una URL
 * pública. El archivo NO se sirve por URL adivinable: una comanda expuesta
 * dejaría ver la operación de cualquier evento.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('comanda_evento', (table) => {
      table.increments('id_comanda').primary()

      table
        .integer('id_evento')
        .unsigned()
        .notNullable()
        .references('id_evento')
        .inTable('evento')
        .onDelete('CASCADE')

      /**
       * Clave del objeto en el bucket, no una URL. Las URL firmadas caducan, así
       * que guardarlas sería guardar algo que deja de servir; la clave es
       * estable y la URL se genera al pedirla.
       */
      table.string('clave_objeto', 500).notNullable()

      /** Lo que el capitán vio en su teléfono. Sirve para que reconozca cuál subió. */
      table.string('nombre_original', 255).notNullable()

      /** Decide si la app la abre como PDF o como imagen. */
      table.string('tipo_mime', 100).notNullable()
      table.integer('tamano_bytes').unsigned().notNullable()

      /** Entero interno; hacia afuera se expone el UUID del capitán. */
      table
        .integer('id_subido_por')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')

      /**
       * Solo una vigente por evento. Al reemplazarla, la anterior queda inactiva
       * pero NO se borra: es la que permite volver atrás si el capitán subió la
       * equivocada.
       */
      table.boolean('activo').notNullable().defaultTo(true)

      table.timestamp('creado_en').notNullable().defaultTo(this.now())

      table.index(['id_evento', 'activo'])
    })

    /**
     * Índice parcial: garantiza a nivel de base que no haya dos comandas
     * vigentes en el mismo evento. Un UNIQUE ordinario sobre (id_evento, activo)
     * bloquearía también la segunda inactiva, y el histórico las necesita todas.
     */
    this.schema.raw(`
      CREATE UNIQUE INDEX comanda_una_vigente_por_evento
      ON comanda_evento (id_evento) WHERE activo = true
    `)
  }

  async down() {
    this.schema.dropTableIfExists('comanda_evento')
  }
}
