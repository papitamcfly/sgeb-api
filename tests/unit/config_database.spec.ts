import { test } from '@japa/runner'
import { resolverSslPostgres } from '#config/database'

/**
 * Regresión: `config/database.ts` forzaba `ssl: { rejectUnauthorized: false }`
 * de forma incondicional (commit 32f293a5), lo que rompe el Postgres local
 * de desarrollo ("The server does not support SSL connections"). Este caso
 * cubre la función pura extraída de esa config — ver su propio comentario
 * para por qué no se prueba `dbConfig` completo.
 */
test.group('resolverSslPostgres', () => {
  test('en producción exige SSL (el Postgres del VPS 3 lo requiere)', ({ assert }) => {
    assert.deepEqual(resolverSslPostgres(true), { rejectUnauthorized: false })
  })

  test('fuera de producción no fuerza SSL (Postgres local no lo soporta)', ({ assert }) => {
    assert.isFalse(resolverSslPostgres(false))
  })
})
