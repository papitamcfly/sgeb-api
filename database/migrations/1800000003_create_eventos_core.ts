import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tablas 4–9: SALON, EVENTO, MESA, PARTICIPACION_EVENTO,
 * CONFIRMACION_LLEGADA y ASIGNACION_MESA.
 *
 * Es el núcleo operativo: alrededor de EVENTO gira todo lo demás.
 */
export default class extends BaseSchema {
  async up() {
    // ================================================================ 4. SALON
    this.schema.createTable('salon', (table) => {
      table.increments('id_salon').primary()

      /**
       * El Diccionario declara VARCHAR(30) en el tipo pero permite hasta 80 en
       * las reglas de validación. Se adopta 80: truncar en la base produciría
       * un error 500 sobre un valor que la aplicación ya dio por bueno, que es
       * la peor combinación posible. Ver "Discrepancias" en el README.
       */
      table.string('nombre', 80).notNullable()

      table.string('calle', 50).notNullable()
      table.specificType('cp', 'char(5)').notNullable()
      table.string('colonia', 40).notNullable()
      table.string('ciudad', 50).notNullable()
      table.string('estado', 25).notNullable()

      /**
       * Centro de la geocerca de confirmación de llegada (SGEB-4003).
       * 8 decimales ≈ 1 mm de precisión, muy por encima de lo que da un GPS de
       * teléfono; el margen sobra a propósito para que el redondeo nunca sea la
       * causa de una asistencia rechazada.
       */
      table.decimal('latitud', 10, 8).notNullable()
      table.decimal('longitud', 11, 8).notNullable()

      table.smallint('capacidad_max_mesas').notNullable()
      table.integer('capacidad_personas').unsigned().notNullable()
      table.boolean('activo').notNullable().defaultTo(true)
    })

    // ================================================================ 5. EVENTO
    this.schema.createTable('evento', (table) => {
      table.increments('id_evento').primary()
      table.integer('id_salon').unsigned().notNullable().references('id_salon').inTable('salon')
      table
        .integer('id_capitan')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')
      table
        .integer('id_usuario_creador')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')

      /** Tipo declarado VARCHAR(40); validación permite 120. Se adopta 120. */
      table.string('titulo', 120).notNullable()

      table
        .enum('tipo', ['social', 'empresarial'], {
          useNative: true,
          enumName: 'evento_tipo',
          schemaName: 'public',
        })
        .notNullable()

      table.string('comanda_url', 2048).nullable()
      table.date('fecha').notNullable()
      table.time('hora_presentacion').notNullable()
      table.timestamp('inicio').notNullable()
      table.timestamp('fin').nullable()

      table.integer('cupo_meseros').unsigned().notNullable()
      table.smallint('num_mesas').notNullable()
      table.decimal('tarifa_por_mesero', 6, 2).notNullable()

      /**
       * Radio congelado al crear el evento. Si el salón se recoloca después, los
       * eventos ya publicados conservan el suyo: de esas asistencias dependen
       * pagos ya calculados y reescribirlas los invalidaría retroactivamente.
       */
      table.integer('radio_geocerca_m').unsigned().notNullable()

      table
        .enum('estado', ['borrador', 'publicado', 'en_curso', 'finalizado', 'cancelado'], {
          useNative: true,
          enumName: 'evento_estado',
          schemaName: 'public',
        })
        .notNullable()
        .defaultTo('borrador')

      table.timestamp('creado_en').notNullable().defaultTo(this.now())

      /** Consulta caliente del dashboard: "eventos del capitán por rango de fechas". */
      table.index(['id_capitan', 'fecha'])
      table.index(['estado', 'fecha'])
      table.index(['id_salon', 'fecha'])
    })

    this.schema.raw(`
      ALTER TABLE evento
      ADD CONSTRAINT evento_fin_posterior_a_inicio CHECK (fin IS NULL OR fin > inicio)
    `)
    this.schema.raw(`
      ALTER TABLE evento
      ADD CONSTRAINT evento_cupo_valido CHECK (cupo_meseros BETWEEN 1 AND 500)
    `)
    this.schema.raw(`
      ALTER TABLE evento
      ADD CONSTRAINT evento_geocerca_valida CHECK (radio_geocerca_m BETWEEN 10 AND 1000)
    `)

    // ================================================================ 6. MESA
    this.schema.createTable('mesa', (table) => {
      table.increments('id_mesa').primary()
      table
        .integer('id_evento')
        .unsigned()
        .notNullable()
        .references('id_evento')
        .inTable('evento')
        .onDelete('CASCADE')

      table.string('etiqueta', 20).notNullable()

      /**
       * UUID impreso en el QR. UNIQUE **global**, no por evento: el comensal
       * escanea sin decir a qué evento pertenece, así que el código por sí solo
       * debe resolver la mesa. Regenerarlo emite un UUID nuevo e invalida el
       * anterior (SGEB-3003 para quien tenga la vista abierta).
       */
      table.specificType('codigo_qr', 'char(36)').notNullable().unique()

      table.string('nfc_uid', 50).nullable()
      table
        .enum('estado', ['libre', 'ocupada'], {
          useNative: true,
          enumName: 'mesa_estado',
          schemaName: 'public',
        })
        .notNullable()
        .defaultTo('libre')

      /** Etiqueta única dentro del evento (SGEB-2013). Entre eventos puede repetirse. */
      table.unique(['id_evento', 'etiqueta'])
    })

    // ================================================================ 7. PARTICIPACION_EVENTO
    this.schema.createTable('participacion_evento', (table) => {
      table.increments('id_participacion').primary()
      table
        .integer('id_evento')
        .unsigned()
        .notNullable()
        .references('id_evento')
        .inTable('evento')
        .onDelete('CASCADE')
      table
        .integer('id_usuario')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')

      table
        .enum('puesto', ['mesero', 'barra'], {
          useNative: true,
          enumName: 'participacion_puesto',
          schemaName: 'public',
        })
        .notNullable()
        .defaultTo('mesero')

      /** Máquina de estados; las transiciones inválidas son SGEB-4011. */
      table
        .enum(
          'estado',
          [
            'aparto',
            'seleccionado',
            'confirmo_asistencia',
            'confirmo_llegada',
            'asignado',
            'vinculo',
            'salida',
          ],
          { useNative: true, enumName: 'participacion_estado', schemaName: 'public' }
        )
        .notNullable()
        .defaultTo('aparto')

      table.timestamp('fecha_aparto').nullable()
      table.timestamp('fecha_seleccion').nullable()
      table.timestamp('fecha_confirma_asistencia').nullable()
      table.timestamp('fecha_llegada').nullable()
      table.timestamp('fecha_salida').nullable()
      table.boolean('checklist_ok').notNullable().defaultTo(false)

      /**
       * Un mesero no puede apartar dos veces el mismo evento. Sin esto, un doble
       * toque en la app consume dos lugares del cupo y el capitán ve fantasmas
       * en su plantilla.
       */
      table.unique(['id_evento', 'id_usuario'])
      table.index(['id_evento', 'estado'])
    })

    // ================================================================ 8. CONFIRMACION_LLEGADA
    this.schema.createTable('confirmacion_llegada', (table) => {
      table.increments('id_confirmacion').primary()
      table
        .integer('id_participacion')
        .unsigned()
        .notNullable()
        .references('id_participacion')
        .inTable('participacion_evento')
        .onDelete('CASCADE')

      table
        .enum('metodo', ['huella', 'face_id', 'ninguno'], {
          useNative: true,
          enumName: 'llegada_metodo',
          schemaName: 'public',
        })
        .notNullable()

      table.boolean('biometrico_verificado').notNullable()

      table.decimal('latitud', 10, 8).notNullable()

      /**
       * ⚠ CORRECCIÓN AL DICCIONARIO. La tabla 8 declara DECIMAL(10,8) para la
       * longitud, que solo admite dos dígitos enteros: el máximo almacenable es
       * 99.99999999. Torreón está en −103.4, así que **toda confirmación de
       * llegada fallaría con overflow numérico** en la sede del propio negocio.
       * Se usa DECIMAL(11,8), igual que en SALON (tabla 4), que sí lo declara
       * bien. Ver "Discrepancias" en el README.
       */
      table.decimal('longitud', 11, 8).notNullable()

      table.decimal('distancia_m', 8, 2).notNullable()
      table.boolean('dentro_geocerca').notNullable()
      table
        .enum('resultado', ['exitoso', 'fallido'], {
          useNative: true,
          enumName: 'llegada_resultado',
          schemaName: 'public',
        })
        .notNullable()
      table.timestamp('timestamp').notNullable().defaultTo(this.now())

      /**
       * Los intentos fallidos NO se borran: son la evidencia con la que el
       * capitán resuelve una disputa de asistencia, y de la asistencia depende
       * el pago.
       */
      table.index(['id_participacion', 'timestamp'])
    })

    // ================================================================ 9. ASIGNACION_MESA
    this.schema.createTable('asignacion_mesa', (table) => {
      table.increments('id_asignacion').primary()
      table
        .integer('id_participacion')
        .unsigned()
        .notNullable()
        .references('id_participacion')
        .inTable('participacion_evento')
        .onDelete('CASCADE')
      table
        .integer('id_mesa')
        .unsigned()
        .notNullable()
        .references('id_mesa')
        .inTable('mesa')
        .onDelete('CASCADE')

      table.boolean('vinculada').notNullable().defaultTo(false)
      table.timestamp('fecha_asignacion').notNullable().defaultTo(this.now())
      table.timestamp('fecha_vinculacion').nullable()

      table.index(['id_participacion'])
    })

    /**
     * Una mesa, un mesero a la vez (SGEB-4006). Índice parcial sobre las
     * asignaciones vigentes: al liberar una mesa se marca `vinculada = false` y
     * se cierra la fila, de modo que el histórico de quién atendió qué mesa
     * sobrevive y la mesa queda libre para reasignarse.
     */
    this.schema.raw(`
      CREATE UNIQUE INDEX asignacion_mesa_una_vigente_por_mesa
      ON asignacion_mesa (id_mesa) WHERE fecha_vinculacion IS NOT NULL OR vinculada = true
    `)
  }

  async down() {
    for (const t of [
      'asignacion_mesa',
      'confirmacion_llegada',
      'participacion_evento',
      'mesa',
      'evento',
      'salon',
    ]) {
      this.schema.dropTableIfExists(t)
    }
    for (const t of [
      'evento_tipo',
      'evento_estado',
      'mesa_estado',
      'participacion_puesto',
      'participacion_estado',
      'llegada_metodo',
      'llegada_resultado',
    ]) {
      this.schema.raw(`DROP TYPE IF EXISTS ${t}`)
    }
  }
}
