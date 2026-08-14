import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * MOVIMIENTO_BITACORA — no está en el Diccionario de Datos.
 *
 * El OpenAPI define `GET /admin/bitacora` y el esquema `MovimientoBitacora`,
 * pero el Diccionario no incluye la tabla. Es el mismo caso que las tres del
 * módulo de identidad: el contrato la contempla y el modelo de datos no.
 *
 * **Pendiente documental:** incorporarla como tabla 30 del Diccionario.
 *
 * Qué se registra: los cambios que alguien podría necesitar auditar después —
 * altas y bajas de cuenta, cambios de rol, ediciones de CLABE, cancelaciones de
 * evento, aprobaciones de pago. NO cada lectura ni cada operación de servicio:
 * una bitácora que registra todo se vuelve ilegible y nadie la consulta.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('movimiento_bitacora', (table) => {
      table.increments('id_bitacora').primary()

      table.string('tipo_entidad', 40).notNullable()
      table.integer('id_entidad').unsigned().nullable()
      table
        .enum('accion', ['crear', 'actualizar', 'desactivar', 'activar', 'eliminar', 'aprobar', 'cancelar'], {
          useNative: true,
          enumName: 'bitacora_accion',
          schemaName: 'public',
        })
        .notNullable()

      /**
       * UUID y no entero: es lo único que permite cruzar un movimiento con los
       * registros del proveedor de identidad. Nulo cuando el movimiento lo hizo
       * un proceso automático (una tarea programada, el Cubaitor).
       */
      table.specificType('uuid_usuario_responsable', 'char(36)').nullable()

      table.string('detalle', 500).nullable()
      table.string('ip', 45).nullable()
      table.timestamp('timestamp').notNullable().defaultTo(this.now())

      table.index(['tipo_entidad', 'id_entidad'])
      table.index(['timestamp'])
      table.index(['uuid_usuario_responsable'])
    })
  }

  async down() {
    this.schema.dropTableIfExists('movimiento_bitacora')
    this.schema.raw('DROP TYPE IF EXISTS bitacora_accion')
  }
}
