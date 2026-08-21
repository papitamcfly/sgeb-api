import { indexEntities } from '@adonisjs/core'
import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  experimental: {},

  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
  ],

  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/core/providers/hash_provider'),
    {
      file: () => import('@adonisjs/core/providers/repl_provider'),
      environment: ['repl', 'test'],
    },
    () => import('@adonisjs/core/providers/vinejs_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonisjs/cors/cors_provider'),

    /** Enlaza IdentidadService. Punto de conmutación de la extracción del SSO. */
    () => import('#providers/identidad_provider'),

    /** Monta socket.io sobre el servidor HTTP. Ver §10 del Entorno Tecnológico. */
    () => import('#providers/tiempo_real_provider'),

    () => import('@adonisjs/mail/mail_provider'),

    /** Elige transporte de correo y push según CORREO_MODO y PUSH_MODO. */
    () => import('#providers/mensajeria_provider'),

    /** Inicia la conexión persistente con el broker MQTT para las válvulas. */
    () => import('#providers/mqtt_provider'),
  ],

  preloads: [() => import('#start/routes'), () => import('#start/kernel')],

  tests: {
    suites: [
      { files: ['tests/unit/**/*.spec.{ts,js}'], name: 'unit', timeout: 2000 },
      { files: ['tests/functional/**/*.spec.{ts,js}'], name: 'functional', timeout: 30000 },
    ],
    forceExit: false,
  },

  metaFiles: [],

  /**
   * v7 exige al menos `indexEntities()`. Se deja SIN `transformers`: la API de
   * Transformers envuelve las respuestas en `data` por su cuenta, y el SGEB ya
   * tiene su propio envelope result/data. Habilitarla produciría doble envoltura.
   */
  hooks: {
    init: [indexEntities()],
  },
})
