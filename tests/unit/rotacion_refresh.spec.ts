import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { TokenService } from '#modules/identidad/services/token_service'
import Usuario from '#modules/identidad/models/usuario'
import { randomUUID } from 'node:crypto'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ROTACIÓN DEL REFRESH TOKEN — SIN TRANSACCIÓN GLOBAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Este grupo NO usa `withGlobalTransaction`, y es deliberado.**
 *
 * El resto de la suite envuelve cada prueba en una transacción global: todo
 * corre sobre una sola conexión y se revierte al terminar. Es rápido y aísla
 * bien, pero **oculta por completo los conflictos de candados entre
 * conexiones**, porque nunca hay dos.
 *
 * Ese aislamiento escondió un bloqueo real en producción: `rotar()` mantenía un
 * `FOR UPDATE` sobre la fila del refresh mientras `emitir()` insertaba el token
 * nuevo en otra conexión. Como `id_padre` es una llave foránea a la misma
 * tabla, el INSERT necesitaba un `FOR KEY SHARE` sobre la fila bloqueada y se
 * quedaba esperando a una transacción que, para la base, estaba simplemente
 * inactiva. Ni siquiera se detecta como interbloqueo: la petición se cuelga
 * hasta que un temporizador de red la corta.
 *
 * La lección: **una prueba que corre en una sola conexión no puede encontrar un
 * problema que solo existe entre dos.**
 */
test.group('rotar sin transacción global', (group) => {
  group.each.teardown(async () => {
    await db.rawQuery('TRUNCATE auth.refresh_token, auth.llave_firma RESTART IDENTITY CASCADE')
    await db.from('usuario').where('correo', 'rot@x.mx').delete()
  })

  test('rotar encadena el token nuevo sin bloquearse', async ({ assert }) => {
    await db.table('usuario').insert({
      uuid_usuario: randomUUID(), id_rol: 2, nombre: 'Rot', apellido_paterno: 'X',
      correo: 'rot@x.mx', password_hash: 'x'.repeat(60),
    })
    const u = await Usuario.query().where('correo', 'rot@x.mx').preload('rol').firstOrFail()

    const { LlaveFirmaService } = await import('#modules/identidad/services/llave_firma_service')
    await new LlaveFirmaService().rotar()
    const s = new TokenService()
    const t1 = await s.emitir({
      usuario: u, rol: 'capitan', cliente: 'web',
      metodoLogin: 'password_2fa', scope: 'openid perfil', sid: randomUUID(),
    })

    /**
     * La carrera contra el temporizador es la prueba en sí: sin la corrección,
     * `rotar()` no devuelve nunca y gana el `setTimeout`.
     */
    const carrera = await Promise.race([
      s.rotar({ refreshToken: t1.refresh_token, cliente: 'web' }).then(() => 'ok'),
      new Promise((r) => setTimeout(() => r('COLGADO'), 8000)),
    ])

    assert.equal(carrera, 'ok', 'rotar() se colgó: revisar el paso de la transacción a emitir()')

    /** El encadenamiento debe quedar registrado: es lo que permite revocar la cadena. */
    const filas = await db.from('auth.refresh_token').orderBy('id_refresh')
    assert.lengthOf(filas, 2)
    assert.isTrue(filas[0].revocado, 'el token rotado debe quedar revocado')
    assert.equal(filas[1].id_padre, filas[0].id_refresh)
    assert.isFalse(filas[1].revocado)
  }).timeout(20000)
})
