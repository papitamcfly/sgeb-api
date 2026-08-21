import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

/**
 * Solo en producción: el Postgres del VPS 3 exige SSL, pero el Postgres
 * local de desarrollo (y el que usan las pruebas) no lo soporta — forzarlo
 * ahí rompe la conexión con "The server does not support SSL connections".
 * Mismo criterio que `app.inProduction` en `config/logger.ts`.
 *
 * Extraída como función pura (en vez de inline) porque `dbConfig` se
 * construye una sola vez, al importar este módulo — mucho antes de que una
 * prueba pueda forzar `app.inProduction`, a diferencia de
 * `SesionSsoService`, que lee `app.inDev` en cada llamada. Ver
 * `tests/unit/config_database.spec.ts`.
 */
export function resolverSslPostgres(enProduccion: boolean): { rejectUnauthorized: false } | false {
  return enProduccion ? { rejectUnauthorized: false } : false
}

/**
 * PostgreSQL en el VPS 3, alcanzable únicamente por la red privada WireGuard.
 * DB_HOST es la IP de WireGuard (10.8.0.x), nunca la pública: la base no se
 * expone a Internet (Arquitectura de Infraestructura v0.4, §3.2).
 */
const dbConfig = defineConfig({
  connection: 'postgres',

  connections: {
    postgres: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
        ssl: resolverSslPostgres(app.inProduction),
      },
      /**
       * `auth` aloja las 9 tablas del módulo de identidad; `public` el dominio.
       * La separación de esquemas es lo que permite mover el módulo a otra
       * instancia sin migrar datos: por eso no existe NINGUNA llave foránea que
       * cruce entre ambos.
       */
      searchPath: ['public', 'auth'],
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      pool: { min: 2, max: 10 },
    },
  },
})

export default dbConfig
