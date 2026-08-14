import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tablas 10–17: los cuatro checklists y el menú completo.
 *
 * El Diccionario las numera 10 (ITEM), 11 (INSTANCIA), 12 (CHECKLIST) y
 * 13 (RESPUESTA), pero la dependencia real va CHECKLIST → ITEM → INSTANCIA →
 * RESPUESTA. Aquí se crean en orden de dependencia.
 */
export default class extends BaseSchema {
  async up() {
    // ================================================================ 12. CHECKLIST
    this.schema.createTable('checklist', (table) => {
      table.increments('id_checklist').primary()
      table.string('nombre', 40).notNullable()
      table
        .enum('tipo', ['montaje', 'servicio', 'cierre'], {
          useNative: true,
          enumName: 'checklist_tipo',
          schemaName: 'public',
        })
        .notNullable()
      table.boolean('activo').notNullable().defaultTo(true)
    })

    // ================================================================ 10. CHECKLIST_ITEM
    this.schema.createTable('checklist_item', (table) => {
      table.increments('id_item').primary()
      table
        .integer('id_checklist')
        .unsigned()
        .notNullable()
        .references('id_checklist')
        .inTable('checklist')
        .onDelete('CASCADE')

      table.string('descripcion', 80).notNullable()
      table.smallint('cantidad_esperada').notNullable()
      table.smallint('orden').notNullable()
      table.boolean('activo').notNullable().defaultTo(true)

      table.index(['id_checklist', 'orden'])
    })

    // ================================================================ 11. CHECKLIST_INSTANCIA
    this.schema.createTable('checklist_instancia', (table) => {
      table.increments('id_instancia').primary()
      table
        .integer('id_participacion')
        .unsigned()
        .notNullable()
        .references('id_participacion')
        .inTable('participacion_evento')
        .onDelete('CASCADE')
      table
        .integer('id_checklist')
        .unsigned()
        .notNullable()
        .references('id_checklist')
        .inTable('checklist')

      table.boolean('completado').notNullable().defaultTo(false)
      table.timestamp('fecha').notNullable().defaultTo(this.now())

      /**
       * Una instancia por checklist y participación. Sin esto, refrescar la
       * pantalla de montaje genera instancias duplicadas y el capitán ve el
       * mismo checklist tres veces, sin saber cuál aprobar.
       */
      table.unique(['id_participacion', 'id_checklist'])
    })

    // ================================================================ 13. CHECKLIST_RESPUESTA
    this.schema.createTable('checklist_respuesta', (table) => {
      table.increments('id_respuesta').primary()
      table
        .integer('id_instancia')
        .unsigned()
        .notNullable()
        .references('id_instancia')
        .inTable('checklist_instancia')
        .onDelete('CASCADE')
      table
        .integer('id_item')
        .unsigned()
        .notNullable()
        .references('id_item')
        .inTable('checklist_item')

      table.smallint('cantidad').notNullable().defaultTo(0)
      table.boolean('hecho').notNullable().defaultTo(false)

      /** Una respuesta por ítem dentro de la instancia. */
      table.unique(['id_instancia', 'id_item'])
    })

    // ================================================================ 14. INSUMO
    this.schema.createTable('insumo', (table) => {
      table.increments('id_insumo').primary()
      table.string('nombre', 30).notNullable()
      table
        .enum('tipo', ['alcohol', 'refresco', 'jugo', 'agua', 'otro'], {
          useNative: true,
          enumName: 'insumo_tipo',
          schemaName: 'public',
        })
        .notNullable()
      table.string('unidad', 10).notNullable().defaultTo('ml')
      table.decimal('costo', 7, 2).notNullable().defaultTo(0)

      /**
       * `estado` es operativo (se acabó la botella) y `activo` es de catálogo
       * (ya no lo compramos). Son cosas distintas: un insumo agotado hoy vuelve
       * mañana; uno inactivo desaparece del catálogo pero sigue apareciendo en
       * las recetas históricas.
       */
      table
        .enum('estado', ['disponible', 'bajo', 'agotado', 'inactivo'], {
          useNative: true,
          enumName: 'insumo_estado',
          schemaName: 'public',
        })
        .notNullable()
        .defaultTo('disponible')
      table.boolean('activo').notNullable().defaultTo(true)
    })

    // ================================================================ 15. BEBIDA
    this.schema.createTable('bebida', (table) => {
      table.increments('id_bebida').primary()
      table.string('nombre', 30).notNullable()
      table.string('descripcion', 70).nullable()
      table.boolean('alcoholica').notNullable().defaultTo(false)
      table.boolean('activo').notNullable().defaultTo(true)
    })

    // ================================================================ 16. RECETA_INGREDIENTE
    this.schema.createTable('receta_ingrediente', (table) => {
      table.increments('id_receta_ing').primary()
      table
        .integer('id_bebida')
        .unsigned()
        .notNullable()
        .references('id_bebida')
        .inTable('bebida')
        .onDelete('CASCADE')
      table.integer('id_insumo').unsigned().notNullable().references('id_insumo').inTable('insumo')

      /**
       * PROPORCION → fracción 0.00–1.00 del volumen del envase.
       * FIJO_ML    → mililitros exactos, sin importar el envase.
       * RESTO      → lo que sobre tras aplicar los anteriores; `valor` se ignora.
       * El enumerado va en MAYÚSCULAS por convención del Diccionario.
       */
      table
        .enum('tipo_porcion', ['PROPORCION', 'FIJO_ML', 'RESTO'], {
          useNative: true,
          enumName: 'receta_tipo_porcion',
          schemaName: 'public',
        })
        .notNullable()

      table.decimal('valor', 5, 2).notNullable().defaultTo(0)
      table.smallint('orden_servido').notNullable()

      /** Un insumo no se repite dentro de la misma receta. */
      table.unique(['id_bebida', 'id_insumo'])
      table.index(['id_bebida', 'orden_servido'])
    })

    this.schema.raw(`
      ALTER TABLE receta_ingrediente
      ADD CONSTRAINT receta_proporcion_en_rango
      CHECK (tipo_porcion <> 'PROPORCION' OR (valor >= 0 AND valor <= 1))
    `)

    // ================================================================ 17. ENVASE
    this.schema.createTable('envase', (table) => {
      table.increments('id_envase').primary()
      table.string('nombre', 50).notNullable()
      table.integer('volumen_ml').unsigned().notNullable()
      table.boolean('activo').notNullable().defaultTo(true)
    })
  }

  async down() {
    for (const t of [
      'envase',
      'receta_ingrediente',
      'bebida',
      'insumo',
      'checklist_respuesta',
      'checklist_instancia',
      'checklist_item',
      'checklist',
    ]) {
      this.schema.dropTableIfExists(t)
    }
    for (const t of [
      'checklist_tipo',
      'insumo_tipo',
      'insumo_estado',
      'receta_tipo_porcion',
    ]) {
      this.schema.raw(`DROP TYPE IF EXISTS ${t}`)
    }
  }
}
