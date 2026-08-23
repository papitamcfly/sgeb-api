import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tablas 18–22: CUBAITOR, CONFIG_DISPENSADO, ORDEN, ORDEN_DETALLE y DISPENSADO.
 *
 * El camino completo de una bebida: el mesero levanta la ORDEN, cada renglón es
 * un ORDEN_DETALLE, y cada apertura de electroválvula deja un DISPENSADO que
 * permite auditar cuánto líquido salió de verdad contra cuánto se pidió.
 */
export default class extends BaseSchema {
  async up() {
    // ================================================================ 18. CUBAITOR
    this.schema.createTable('cubaitor', (table) => {
      table.increments('id_cubaitor').primary()
      table.string('nombre', 40).notNullable()

      /**
       * Identidad física del ESP32 y llave con la que se anuncia en el broker
       * MQTT. Inmutable: cambiarla equivale a otro dispositivo.
       */
      table.string('mac', 40).notNullable().unique()

      table.string('host_ip', 15).nullable()
      table.smallint('num_pins').notNullable()
      table
        .enum('estado', ['activo', 'inactivo', 'mantenimiento'], {
          useNative: true,
          enumName: 'cubaitor_estado',
          schemaName: 'public',
        })
        .notNullable()
        .defaultTo('activo')

      /**
       * Heartbeat. Si rebasa el umbral, el dashboard marca el dispositivo fuera
       * de línea (SGEB-5003) y se habilita el dispensado manual: el evento NO
       * se bloquea porque la barra automática deje de responder (RNF-13).
       */
      table.timestamp('ultima_conexion').nullable()
    })

    // ================================================================ 19. CONFIG_DISPENSADO
    this.schema.createTable('config_dispensado', (table) => {
      table.increments('id_config').primary()
      table
        .integer('id_evento')
        .unsigned()
        .notNullable()
        .references('id_evento')
        .inTable('evento')
        .onDelete('CASCADE')
      table
        .integer('id_cubaitor')
        .unsigned()
        .notNullable()
        .references('id_cubaitor')
        .inTable('cubaitor')
      table.integer('id_insumo').unsigned().notNullable().references('id_insumo').inTable('insumo')

      table.smallint('pin_gpio').notNullable()

      /** Resultado de calibración; debe ser > 0 o la división del tiempo revienta. */
      table.decimal('caudal_ml_seg', 5, 2).notNullable()

      table.integer('volumen_cargado_ml').unsigned().notNullable()

      /**
       * Se descuenta con cada dispensado. Es el umbral matemático de botella
       * vacía: cuando lo solicitado excede lo disponible, la orden se pausa
       * ANTES de abrir la válvula (SGEB-4009), en lugar de servir medio vaso.
       */
      table.integer('volumen_disponible_ml').unsigned().notNullable()

      table.timestamp('ultima_calibracion').nullable()
      table.boolean('activo').notNullable().defaultTo(true)

      table.index(['id_evento', 'activo'])
    })

    this.schema.raw(`
      ALTER TABLE config_dispensado
      ADD CONSTRAINT config_pin_gpio_valido CHECK (pin_gpio BETWEEN 0 AND 39)
    `)
    this.schema.raw(`
      ALTER TABLE config_dispensado
      ADD CONSTRAINT config_caudal_positivo CHECK (caudal_ml_seg > 0)
    `)
    this.schema.raw(`
      ALTER TABLE config_dispensado
      ADD CONSTRAINT config_disponible_no_excede_cargado
      CHECK (volumen_disponible_ml <= volumen_cargado_ml)
    `)

    /**
     * Un pin, un insumo (SGEB-4019). Dos insumos peleando el mismo GPIO
     * significa que una de las dos bebidas sale con el líquido equivocado, y no
     * hay forma de detectarlo salvo probándola.
     */
    this.schema.raw(`
      CREATE UNIQUE INDEX config_dispensado_pin_unico_por_evento
      ON config_dispensado (id_evento, id_cubaitor, pin_gpio) WHERE activo = true
    `)

    // ================================================================ 20. ORDEN
    this.schema.createTable('orden', (table) => {
      table.increments('id_orden').primary()
      table.integer('id_mesa').unsigned().notNullable().references('id_mesa').inTable('mesa')
      table
        .integer('id_participacion')
        .unsigned()
        .notNullable()
        .references('id_participacion')
        .inTable('participacion_evento')

      table
        .enum(
          'estado',
          [
            'pendiente',
            'en_preparacion',
            'dispensando',
            'entregada',
            'cancelada',
            'pausada_por_insumo',
          ],
          { useNative: true, enumName: 'orden_estado', schemaName: 'public' }
        )
        .notNullable()
        .defaultTo('pendiente')

      table.timestamp('creada_en').notNullable().defaultTo(this.now())
      table.timestamp('entregada_en').nullable()

      /** Tablero de barra: "órdenes activas de este evento por estado". */
      table.index(['id_mesa', 'estado'])
      table.index(['id_participacion', 'estado'])
    })

    // ================================================================ 21. ORDEN_DETALLE
    this.schema.createTable('orden_detalle', (table) => {
      table.increments('id_detalle').primary()
      table
        .integer('id_orden')
        .unsigned()
        .notNullable()
        .references('id_orden')
        .inTable('orden')
        .onDelete('CASCADE')
      table.integer('id_bebida').unsigned().notNullable().references('id_bebida').inTable('bebida')
      table.integer('id_envase').unsigned().notNullable().references('id_envase').inTable('envase')

      table.smallint('cantidad').notNullable()

      /**
       * Congelado al levantar la orden (volumen_envase × cantidad). Si después
       * alguien corrige el volumen del envase en el catálogo, esta orden
       * conserva el que se usó: de lo contrario cambiaría el consumo histórico
       * de insumos de eventos ya cerrados.
       */
      table.integer('volumen_total_ml').unsigned().notNullable()

      table
        .enum('estado', ['pendiente', 'dispensada', 'entregada', 'pausada_por_insumo'], {
          useNative: true,
          enumName: 'detalle_estado',
          schemaName: 'public',
        })
        .notNullable()
        .defaultTo('pendiente')

      table.index(['id_orden', 'estado'])
    })

    this.schema.raw(`
      ALTER TABLE orden_detalle
      ADD CONSTRAINT detalle_cantidad_valida CHECK (cantidad BETWEEN 1 AND 50)
    `)

    // ================================================================ 22. DISPENSADO
    this.schema.createTable('dispensado', (table) => {
      table.increments('id_dispensado').primary()
      table
        .integer('id_detalle')
        .unsigned()
        .notNullable()
        .references('id_detalle')
        .inTable('orden_detalle')
        .onDelete('CASCADE')
      table
        .integer('id_config')
        .unsigned()
        .notNullable()
        .references('id_config')
        .inTable('config_dispensado')

      table.integer('volumen_solicitado_ml').unsigned().notNullable()

      /** Teórico: volumen / caudal. Lo calcula el servidor, nunca el dispositivo. */
      table.decimal('segundos_calculado', 4, 2).notNullable()

      /**
       * Reportado por el Cubaitor al cerrar la válvula. NULL mientras no llegue;
       * si no llega dentro del tiempo esperado, la válvula se fuerza a cierre
       * por seguridad y el registro queda en estado error (SGEB-5006).
       */
      table.decimal('segundos_real', 4, 2).nullable()
      table.integer('volumen_real_estimado_ml').unsigned().nullable()

      table
        .enum('estado', ['ok', 'parcial', 'error', 'pausado_por_insumo'], {
          useNative: true,
          enumName: 'dispensado_estado',
          schemaName: 'public',
        })
        .notNullable()
      table.timestamp('timestamp').notNullable().defaultTo(this.now())

      /** Auditoría de insumo: "cuánto salió de este pin durante el evento". */
      table.index(['id_config', 'timestamp'])
      table.index(['id_detalle'])
    })
  }

  async down() {
    for (const t of [
      'dispensado',
      'orden_detalle',
      'orden',
      'config_dispensado',
      'cubaitor',
    ]) {
      this.schema.dropTableIfExists(t)
    }
    for (const t of [
      'cubaitor_estado',
      'orden_estado',
      'detalle_estado',
      'dispensado_estado',
    ]) {
      this.schema.raw(`DROP TYPE IF EXISTS ${t}`)
    }
  }
}
