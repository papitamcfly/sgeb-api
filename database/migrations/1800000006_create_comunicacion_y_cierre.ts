import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tablas 23–29: CRONOGRAMA_EVENTO, SOLICITUD_SERVICIO, NOTIFICACION,
 * CALIFICACION, PAGO, REPORTE_MERMA y MERMA_DETALLE.
 *
 * Cierran el ciclo del evento: comunicación durante el servicio, calidad
 * percibida por el comensal y liquidación al terminar.
 */
export default class extends BaseSchema {
  async up() {
    // ================================================================ 23. CRONOGRAMA_EVENTO
    this.schema.createTable('cronograma_evento', (table) => {
      table.increments('id_cronograma').primary()
      table
        .integer('id_evento')
        .unsigned()
        .notNullable()
        .references('id_evento')
        .inTable('evento')
        .onDelete('CASCADE')

      table
        .enum('tipo_tiempo', ['ENTRADA', 'FUERTE', 'POSTRE', 'OTRO'], {
          useNative: true,
          enumName: 'cronograma_tipo',
          schemaName: 'public',
        })
        .notNullable()

      table.time('hora_objetivo').notNullable()
      table.string('descripcion', 100).nullable()

      /**
       * Bandera de idempotencia del disparo. Sin ella, un reinicio del proceso
       * que recorre el cronograma vuelve a notificar hitos ya enviados, y los
       * meseros reciben "sirvan el postre" tres veces.
       */
      table.boolean('disparado').notNullable().defaultTo(false)
      table.timestamp('fecha_disparo').nullable()

      table.index(['id_evento', 'disparado'])
    })

    // ================================================================ 24. SOLICITUD_SERVICIO
    this.schema.createTable('solicitud_servicio', (table) => {
      table.increments('id_solicitud').primary()
      table.integer('id_mesa').unsigned().notNullable().references('id_mesa').inTable('mesa')

      /** NULL mientras nadie la toma. Al atenderla se registra quién (SGEB-4021). */
      table
        .integer('id_participacion')
        .unsigned()
        .nullable()
        .references('id_participacion')
        .inTable('participacion_evento')
        .onDelete('SET NULL')

      table
        .enum('tipo', ['atencion', 'cuenta', 'otro'], {
          useNative: true,
          enumName: 'solicitud_tipo',
          schemaName: 'public',
        })
        .notNullable()
      table
        .enum('estado', ['pendiente', 'atendida'], {
          useNative: true,
          enumName: 'solicitud_estado',
          schemaName: 'public',
        })
        .notNullable()
        .defaultTo('pendiente')

      table.timestamp('creada_en').notNullable().defaultTo(this.now())
      table.timestamp('atendida_en').nullable()

      /** Bandeja de piso y anti-spam del QR (SGEB-4014). */
      table.index(['id_mesa', 'estado'])
    })

    // ================================================================ 25. NOTIFICACION
    this.schema.createTable('notificacion', (table) => {
      table.increments('id_notificacion').primary()
      table
        .integer('id_evento')
        .unsigned()
        .notNullable()
        .references('id_evento')
        .inTable('evento')
        .onDelete('CASCADE')

      /** NULL = notificación general a todo el evento. */
      table
        .integer('id_participacion')
        .unsigned()
        .nullable()
        .references('id_participacion')
        .inTable('participacion_evento')
        .onDelete('SET NULL')
      table
        .integer('id_cronograma')
        .unsigned()
        .nullable()
        .references('id_cronograma')
        .inTable('cronograma_evento')
        .onDelete('SET NULL')
      table
        .integer('id_solicitud')
        .unsigned()
        .nullable()
        .references('id_solicitud')
        .inTable('solicitud_servicio')
        .onDelete('SET NULL')

      table
        .enum(
          'tipo',
          ['TIEMPO_COMIDA', 'SOLICITUD_SERVICIO', 'GENERAL', 'ALERTA_BOTELLA_VACIA'],
          { useNative: true, enumName: 'notificacion_tipo', schemaName: 'public' }
        )
        .notNullable()
      table
        .enum('canal', ['push', 'wearable'], {
          useNative: true,
          enumName: 'notificacion_canal',
          schemaName: 'public',
        })
        .notNullable()

      table.string('mensaje', 100).notNullable()
      table.boolean('leida').notNullable().defaultTo(false)
      table.timestamp('enviada_en').notNullable().defaultTo(this.now())

      table.index(['id_participacion', 'leida'])
    })

    // ================================================================ 26. CALIFICACION
    this.schema.createTable('calificacion', (table) => {
      table.increments('id_calificacion').primary()
      table.integer('id_mesa').unsigned().notNullable().references('id_mesa').inTable('mesa')
      table
        .integer('id_participacion')
        .unsigned()
        .notNullable()
        .references('id_participacion')
        .inTable('participacion_evento')

      /**
       * UUID temporal que se emite al escanear el QR. UNIQUE porque es lo único
       * que garantiza una sola calificación por comensal (SGEB-4010): el
       * comensal es anónimo, no hay cuenta contra la cual deduplicar. Sin este
       * índice, un mesero podría refrescar la vista y auto-calificarse en bucle.
       */
      table.specificType('token_comensal', 'char(36)').notNullable().unique()

      table.smallint('puntuacion').notNullable()
      table.string('comentario', 255).nullable()
      table.timestamp('creada_en').notNullable().defaultTo(this.now())

      table.index(['id_participacion'])
    })

    this.schema.raw(`
      ALTER TABLE calificacion
      ADD CONSTRAINT calificacion_puntuacion_en_rango CHECK (puntuacion BETWEEN 1 AND 5)
    `)

    // ================================================================ 27. PAGO
    this.schema.createTable('pago', (table) => {
      table.increments('id_pago').primary()
      table
        .integer('id_participacion')
        .unsigned()
        .notNullable()
        .references('id_participacion')
        .inTable('participacion_evento')

      table.decimal('monto', 7, 2).notNullable()

      /**
       * Snapshot de la CLABE al calcular el pago. Es la razón por la que
       * DATOS_BANCARIOS nunca se borra físicamente: si el mesero cambia de
       * cuenta después, este registro debe seguir diciendo a dónde se transfirió
       * realmente el dinero.
       */
      table.specificType('clabe_destino', 'char(18)').notNullable()

      table
        .enum('estado', ['pendiente', 'pagado', 'fallido', 'cancelado'], {
          useNative: true,
          enumName: 'pago_estado',
          schemaName: 'public',
        })
        .notNullable()
        .defaultTo('pendiente')

      table.string('referencia', 40).nullable()
      table.timestamp('fecha_pago').nullable()

      /** Un pago por participación: el recálculo actualiza, no duplica. */
      table.unique(['id_participacion'])
      table.index(['estado'])
    })

    // ================================================================ 28. REPORTE_MERMA
    this.schema.createTable('reporte_merma', (table) => {
      table.increments('id_reporte').primary()
      table
        .integer('id_evento')
        .unsigned()
        .notNullable()
        .references('id_evento')
        .inTable('evento')
        .onDelete('CASCADE')
      table
        .integer('id_generado_por')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')

      table.string('observaciones', 255).nullable()
      table.timestamp('fecha').notNullable().defaultTo(this.now())

      table.index(['id_evento'])
    })

    // ================================================================ 29. MERMA_DETALLE
    this.schema.createTable('merma_detalle', (table) => {
      table.increments('id_merma_det').primary()
      table
        .integer('id_reporte')
        .unsigned()
        .notNullable()
        .references('id_reporte')
        .inTable('reporte_merma')
        .onDelete('CASCADE')

      table
        .enum(
          'tipo',
          ['vaso_roto', 'plato_roto', 'copa_rota', 'comida_desperdiciada', 'otro'],
          { useNative: true, enumName: 'merma_tipo', schemaName: 'public' }
        )
        .notNullable()

      table.string('descripcion', 150).nullable()
      table.integer('cantidad').unsigned().notNullable()

      /** NULL cuando el capitán no puede estimarlo; el dashboard lo cuenta como 0. */
      table.decimal('costo_estimado', 8, 2).nullable()

      table.index(['id_reporte'])
    })
  }

  async down() {
    for (const t of [
      'merma_detalle',
      'reporte_merma',
      'pago',
      'calificacion',
      'notificacion',
      'solicitud_servicio',
      'cronograma_evento',
    ]) {
      this.schema.dropTableIfExists(t)
    }
    for (const t of [
      'cronograma_tipo',
      'solicitud_tipo',
      'solicitud_estado',
      'notificacion_tipo',
      'notificacion_canal',
      'pago_estado',
      'merma_tipo',
    ]) {
      this.schema.raw(`DROP TYPE IF EXISTS ${t}`)
    }
  }
}
