import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Las 9 tablas propias del módulo de identidad (Diccionario de Datos v3).
 *
 * Nota de alcance: CREDENCIAL_BIOMETRICA **no se crea**. La decisión v0.4 retiró
 * la biometría como método de autenticación; la única biometría del sistema es
 * la confirmación de llegada del mesero, que usa atestación local y no requiere
 * llaves por usuario. Quedan 8 tablas.
 *
 * Dirección de la dependencia: estas tablas apuntan a `public.usuario`, nunca al
 * revés. Ninguna tabla de dominio referencia a `auth.*`. Por eso el módulo se
 * puede desprender completo: al extraerlo viaja con una proyección de USUARIO
 * que se convierte en CUENTA (Anexo D del Diccionario v3), y del lado del SGEB
 * no queda ninguna referencia colgando.
 *
 * Regla transversal de seguridad del diccionario: ningún token, código ni
 * contraseña se almacena en claro.
 *   · Tokens de un solo uso o larga duración → SHA-256 (64 hex)
 *   · Código 2FA y contraseña               → Bcrypt (60 chars)
 * El valor en claro viaja al cliente una sola vez y no se persiste ni se loguea.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw('CREATE SCHEMA IF NOT EXISTS auth')

    // ================================================================ INVITACION
    this.schema.withSchema('auth').createTable('invitacion', (table) => {
      table.increments('id_invitacion').primary()
      table
        .integer('id_emisor')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')
      table
        .integer('id_rol_destino')
        .unsigned()
        .notNullable()
        .references('id_rol')
        .inTable('rol')

      table.string('nombre', 30).notNullable()
      table.string('apellido_paterno', 30).notNullable()
      table.string('apellido_materno', 30).nullable()
      table.string('correo', 100).notNullable()

      table.specificType('token_hash', 'char(64)').notNullable().unique()
      table
        .enum('estado', ['pendiente', 'usada', 'expirada', 'revocada'], {
          useNative: true,
          enumName: 'estado_invitacion',
          schemaName: 'auth',
        })
        .notNullable()
        .defaultTo('pendiente')

      table.timestamp('expira_en').notNullable()

      /** Se llena al consumirse. Deja rastro de qué invitación creó qué cuenta. */
      table
        .integer('id_usuario_creado')
        .unsigned()
        .nullable()
        .references('id_usuario')
        .inTable('usuario')
      table.timestamp('usada_en').nullable()
      table.timestamp('creado_en').notNullable().defaultTo(this.now())

      table.index(['correo', 'estado'])
    })

    /**
     * Un solo correo con invitación pendiente a la vez. Sin esto, dos capitanes
     * pueden invitar a la misma persona y se generan dos cuentas para el mismo
     * mesero, que después aparece duplicado en las listas de asignación.
     */
    this.schema.raw(`
      CREATE UNIQUE INDEX invitacion_una_pendiente_por_correo
      ON auth.invitacion (correo) WHERE estado = 'pendiente'
    `)

    // ================================================================ CODIGO_VERIFICACION
    this.schema.withSchema('auth').createTable('codigo_verificacion', (table) => {
      table.increments('id_codigo').primary()
      table
        .integer('id_usuario')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('CASCADE')

      /** Bcrypt del código de 6 dígitos. Nunca en claro, ni en logs. */
      table.specificType('codigo_hash', 'char(60)').notNullable()

      table
        .enum('proposito', ['login', 'registro'], {
          useNative: true,
          enumName: 'proposito_codigo',
          schemaName: 'auth',
        })
        .notNullable()
      table
        .enum('canal', ['correo'], {
          useNative: true,
          enumName: 'canal_codigo',
          schemaName: 'auth',
        })
        .notNullable()
        .defaultTo('correo')

      /** Tope 5: al llegar, el código se invalida (SSO-1010). */
      table.smallint('intentos_fallidos').notNullable().defaultTo(0)
      /** Tope 3, con espera mínima de 60 s entre reenvíos (SSO-1011). */
      table.smallint('reenvios').notNullable().defaultTo(0)

      table.boolean('usado').notNullable().defaultTo(false)
      table.timestamp('expira_en').notNullable()
      table.timestamp('creado_en').notNullable().defaultTo(this.now())

      table.index(['id_usuario', 'proposito', 'usado'])
    })

    // ================================================================ DISPOSITIVO_CONFIABLE
    this.schema.withSchema('auth').createTable('dispositivo_confiable', (table) => {
      table.increments('id_dispositivo').primary()
      table
        .integer('id_usuario')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('CASCADE')

      table.specificType('token_hash', 'char(64)').notNullable().unique()
      table.string('nombre_dispositivo', 60).nullable()
      table
        .enum('plataforma', ['web', 'ios', 'android'], {
          useNative: true,
          enumName: 'plataforma_dispositivo',
          schemaName: 'auth',
        })
        .notNullable()
      table.string('user_agent', 255).nullable()

      /** creado_en + 30 días, calculado por el servidor. */
      table.timestamp('expira_en').notNullable()
      table.boolean('activo').notNullable().defaultTo(true)
      table.timestamp('creado_en').notNullable().defaultTo(this.now())
      table.timestamp('ultimo_uso').nullable()

      table.index(['id_usuario', 'activo'])
    })

    // ================================================================ LLAVE_FIRMA
    this.schema.withSchema('auth').createTable('llave_firma', (table) => {
      table.specificType('id_llave', 'smallserial').primary()

      /** Viaja en el header del JWT. Es lo que permite rotar sin invalidar sesiones. */
      table.specificType('kid', 'char(36)').notNullable().unique()

      table
        .enum('algoritmo', ['RS256', 'ES256'], {
          useNative: true,
          enumName: 'algoritmo_firma',
          schemaName: 'auth',
        })
        .notNullable()

      table.string('llave_publica', 2000).notNullable()

      /**
       * Cifrada con AES-256-GCM. La llave maestra vive FUERA de la base de datos
       * (variable de entorno del VPS 2): si ambas estuvieran en el mismo lugar,
       * un volcado de la base bastaría para firmar tokens arbitrarios.
       */
      table.string('llave_privada_cifrada', 4000).notNullable()

      table
        .enum('estado', ['activa', 'retirada', 'revocada'], {
          useNative: true,
          enumName: 'estado_llave',
          schemaName: 'auth',
        })
        .notNullable()
        .defaultTo('activa')

      table.timestamp('creado_en').notNullable().defaultTo(this.now())
      table.timestamp('retirada_en').nullable()
    })

    /**
     * Una sola llave activa a la vez, garantizado por la base. Dos activas
     * significan que la rotación quedó a medias y los tokens se firman de forma
     * no determinista: un cliente valida y otro no, según a qué llave le tocó.
     */
    this.schema.raw(`
      CREATE UNIQUE INDEX llave_firma_una_activa
      ON auth.llave_firma ((estado)) WHERE estado = 'activa'
    `)

    // ================================================================ REFRESH_TOKEN
    this.schema.withSchema('auth').createTable('refresh_token', (table) => {
      table.increments('id_refresh').primary()
      table
        .integer('id_usuario')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('CASCADE')
      table
        .integer('id_dispositivo')
        .unsigned()
        .nullable()
        .references('id_dispositivo')
        .inTable('auth.dispositivo_confiable')
        .onDelete('SET NULL')

      table.specificType('token_hash', 'char(64)').notNullable().unique()

      /**
       * Encadenamiento de la rotación. Presentar un token que ya rotó significa
       * que alguien más lo tenía: se revoca la cadena completa (SSO-1007). Sin
       * `id_padre` no hay forma de saber qué revocar.
       */
      table
        .integer('id_padre')
        .unsigned()
        .nullable()
        .references('id_refresh')
        .inTable('auth.refresh_token')
        .onDelete('SET NULL')

      table
        .enum('cliente', ['web', 'movil'], {
          useNative: true,
          enumName: 'cliente_refresh',
          schemaName: 'auth',
        })
        .notNullable()

      /**
       * `biometria` se retiró del enumerado en la v2.1: no existe login
       * biométrico. Quedan los dos métodos reales.
       */
      table
        .enum('metodo_login', ['password', 'password_2fa'], {
          useNative: true,
          enumName: 'metodo_login',
          schemaName: 'auth',
        })
        .notNullable()

      table.string('ip', 45).nullable()
      table.string('user_agent', 255).nullable()
      table.timestamp('expira_en').notNullable()
      table.boolean('revocado').notNullable().defaultTo(false)
      table.timestamp('creado_en').notNullable().defaultTo(this.now())
      table.timestamp('ultimo_uso').nullable()

      table.index(['id_usuario', 'revocado'])
    })

    // ================================================================ TOKEN_RECUPERACION
    this.schema.withSchema('auth').createTable('token_recuperacion', (table) => {
      table.increments('id_token').primary()
      table
        .integer('id_usuario')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('CASCADE')

      table.specificType('token_hash', 'char(64)').notNullable().unique()
      table.boolean('usado').notNullable().defaultTo(false)
      table.timestamp('expira_en').notNullable()
      table.string('ip_solicitud', 45).nullable()
      table.timestamp('usado_en').nullable()
      table.timestamp('creado_en').notNullable().defaultTo(this.now())

      table.index(['id_usuario', 'usado'])
    })

    // ================================================================ INTENTO_LOGIN
    this.schema.withSchema('auth').createTable('intento_login', (table) => {
      table.increments('id_intento').primary()

      /** NULL cuando el correo no corresponde a ninguna cuenta. */
      table
        .integer('id_usuario')
        .unsigned()
        .nullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('SET NULL')

      /**
       * Se guarda el correo aunque no exista la cuenta: es lo que permite
       * detectar a alguien probando direcciones al azar, que no dejaría rastro
       * si solo se registraran los intentos contra cuentas reales.
       */
      table.string('correo_capturado', 100).notNullable()

      table
        .enum('metodo', ['password', 'codigo_2fa'], {
          useNative: true,
          enumName: 'metodo_intento',
          schemaName: 'auth',
        })
        .notNullable()
      table.boolean('exitoso').notNullable()
      table
        .enum(
          'motivo_fallo',
          [
            'credenciales_invalidas',
            'cuenta_desactivada',
            'bloqueo_temporal',
            'codigo_invalido',
            'codigo_expirado',
            'invitacion_expirada',
            'token_expirado',
          ],
          { useNative: true, enumName: 'motivo_fallo_intento', schemaName: 'auth' }
        )
        .nullable()

      table.string('codigo_error', 20).nullable()
      table.string('ip', 45).nullable()
      table.string('user_agent', 255).nullable()
      table.timestamp('timestamp').notNullable().defaultTo(this.now())

      /** Consulta caliente: "¿cuántos fallos de este correo en los últimos 10 min?" */
      table.index(['correo_capturado', 'timestamp'])
    })

    // ================================================================ BLOQUEO_CUENTA
    this.schema.withSchema('auth').createTable('bloqueo_cuenta', (table) => {
      table.increments('id_bloqueo').primary()
      table
        .integer('id_usuario')
        .unsigned()
        .notNullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('CASCADE')

      table
        .enum('motivo', ['intentos_excedidos', 'manual'], {
          useNative: true,
          enumName: 'motivo_bloqueo',
          schemaName: 'auth',
        })
        .notNullable()

      table.smallint('intentos_acumulados').nullable()
      table.timestamp('inicio').notNullable().defaultTo(this.now())
      /** NULL = indefinido; solo válido para bloqueos manuales. */
      table.timestamp('fin').nullable()
      table
        .integer('levantado_por')
        .unsigned()
        .nullable()
        .references('id_usuario')
        .inTable('usuario')
        .onDelete('SET NULL')
      table.boolean('activo').notNullable().defaultTo(true)

      table.index(['id_usuario', 'activo'])
    })
  }

  async down() {
    const tablas = [
      'bloqueo_cuenta',
      'intento_login',
      'token_recuperacion',
      'refresh_token',
      'llave_firma',
      'dispositivo_confiable',
      'codigo_verificacion',
      'invitacion',
    ]
    for (const t of tablas) {
      this.schema.withSchema('auth').dropTableIfExists(t)
    }

    const tipos = [
      'estado_invitacion',
      'proposito_codigo',
      'canal_codigo',
      'plataforma_dispositivo',
      'algoritmo_firma',
      'estado_llave',
      'cliente_refresh',
      'metodo_login',
      'metodo_intento',
      'motivo_fallo_intento',
      'motivo_bloqueo',
    ]
    for (const t of tipos) {
      this.schema.raw(`DROP TYPE IF EXISTS auth.${t}`)
    }
  }
}
