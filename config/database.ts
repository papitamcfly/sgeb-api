import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

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
        ssl: { rejectUnauthorized: false },
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
