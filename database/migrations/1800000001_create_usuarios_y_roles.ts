import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tablas 1–3 del Diccionario de Datos: ROL, USUARIO y DATOS_BANCARIOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  DÓNDE VIVE USUARIO, Y POR QUÉ AQUÍ Y NO EN `auth`
 * ────────────────────────────────────────────────────────────────────────────
 * USUARIO es la tabla más referenciada del sistema: EVENTO la apunta dos veces
 * (capitán y creador), PARTICIPACION_EVENTO, REPORTE_MERMA y DATOS_BANCARIOS
 * también. Ponerla en el esquema `auth` obligaría a que cinco tablas de dominio
 * apuntaran hacia afuera, o a renunciar a esas llaves foráneas: exactamente al
 * revés de lo que conviene.
 *
 * Va en `public` porque **es una tabla de dominio que además guarda
 * credenciales**, no al contrario. El esquema `auth` aloja las 8 tablas que solo
 * existen para autenticar (invitaciones, códigos, tokens, bloqueos) y que sí se
 * mudan completas el día de la extracción.
 *
 * Esto significa que las tablas de `auth` sí apuntan a `public.usuario`. Es
 * deliberado y es la única dirección aceptable: al extraer el módulo, esas
 * tablas viajan con una proyección de USUARIO que se convierte en CUENTA, con
 * `uuid_usuario` como llave primaria (Anexo D del Diccionario v3). Del lado del
 * SGEB, USUARIO queda como copia sombra y se le quitan `password_hash` y
 * `biometria_habilitada`. Ninguna tabla de dominio se ve afectada.
 *
 * El `uuid_usuario` es lo que hace posible ese corte: ya es el identificador
 * público hoy, así que la proyección no necesita inventar llaves nuevas.
 */
export default class extends BaseSchema {
  async up() {
    // ================================================================ 1. ROL
    this.schema.createTable('rol', (table) => {
      table.increments('id_rol').primary()
      table
        .enum('nombre', ['admin', 'capitan', 'mesero'], {
          useNative: true,
          enumName: 'rol_nombre',
          schemaName: 'public',
        })
        .notNullable()
        .unique()
      table.string('descripcion', 150).nullable()
      table.boolean('activo').notNullable().defaultTo(true)
    })

    this.defer(async (db) => {
      await db.table('rol').multiInsert([
        { nombre: 'admin', descripcion: 'Administrador del sistema' },
        { nombre: 'capitan', descripcion: 'Capitán de banquetes' },
        { nombre: 'mesero', descripcion: 'Mesero de evento' },
      ])
    })

    // ================================================================ 2. USUARIO
    this.schema.createTable('usuario', (table) => {
      table.increments('id_usuario').primary()

      /**
       * Campo agregado por el Diccionario v3. Es el `sub` del JWT y lo único
       * que sale del backend. Inmutable: cambiarlo invalidaría tokens vivos y
       * rompería la trazabilidad entre los logs del SSO y los de la aplicación.
       */
      table.specificType('uuid_usuario', 'char(36)').notNullable().unique()

      table.integer('id_rol').unsigned().notNullable().references('id_rol').inTable('rol')
      table.string('nombre', 30).notNullable()
      table.string('apellido_paterno', 30).notNullable()
      table.string('apellido_materno', 30).nullable()
      table.string('correo', 100).notNullable().unique()
      table.string('telefono', 16).nullable()

      /** Bcrypt: siempre 60 caracteres. Nunca se acepta un hash del cliente. */
      table.specificType('password_hash', 'char(60)').notNullable()

      table.boolean('biometria_habilitada').notNullable().defaultTo(false)
      table.boolean('activo').notNullable().defaultTo(true)
      table.timestamp('creado_en').notNullable().defaultTo(this.now())
    })

    // ================================================================ 3. DATOS_BANCARIOS
    this.schema.createTable('datos_bancarios', (table) => {
      table.increments('id_datos').primary()
      table
        .integer('id_usuario')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')

      /** 18 dígitos exactos; el dígito de control se valida en el servidor (SGEB-2005). */
      table.specificType('clabe', 'char(18)').notNullable()
      table.string('banco', 30).notNullable()
      table.string('titular_cuenta', 50).notNullable()
      table.boolean('activo').notNullable().defaultTo(true)
    })

    /**
     * "Cada usuario puede tener una cuenta activa a la vez" (Diccionario, tabla 3).
     * Un UNIQUE ordinario sobre (id_usuario, activo) no sirve: bloquearía también
     * la segunda cuenta INACTIVA, y el histórico necesita conservarlas todas
     * porque los PAGO guardan la CLABE como snapshot.
     */
    this.schema.raw(`
      CREATE UNIQUE INDEX datos_bancarios_una_activa_por_usuario
      ON datos_bancarios (id_usuario) WHERE activo = true
    `)
  }

  async down() {
    this.schema.dropTableIfExists('datos_bancarios')
    this.schema.dropTableIfExists('usuario')
    this.schema.dropTableIfExists('rol')
    this.schema.raw('DROP TYPE IF EXISTS rol_nombre')
  }
}
