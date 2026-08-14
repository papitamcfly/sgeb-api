import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { IdentidadLocal } from '#modules/identidad/identidad_service'
import type { SgebError } from '#shared/errors/sgeb_error'

const UUID_CAPITAN = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000'

test.group('IdentidadService', (group) => {
  /**
   * Cada prueba corre dentro de una transacción que se revierte al terminar.
   * Sin esto, el orden de ejecución empieza a importar y las pruebas se
   * contaminan entre sí, que es la forma más rápida de perderles la confianza.
   */
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function sembrarCapitan() {
    await db.table('usuario').insert({
      uuid_usuario: UUID_CAPITAN,
      id_rol: 2, // capitan
      nombre: 'Isaac',
      apellido_paterno: 'Velasquez',
      apellido_materno: 'Ruiz',
      correo: 'isaac@mediocres.mx',
      password_hash: 'a'.repeat(60),
    })
  }

  test('resuelve el UUID público al identificador interno', async ({ assert }) => {
    await sembrarCapitan()
    const u = await new IdentidadLocal().resolverPorUuid(UUID_CAPITAN)

    assert.equal(u.uuid, UUID_CAPITAN)
    assert.equal(u.rol, 'capitan')
    assert.isTrue(u.activo)
    assert.isNumber(u.id)
  })

  test('el perfil público NO expone el identificador entero', async ({ assert }) => {
    await sembrarCapitan()
    const perfil = await new IdentidadLocal().perfil(UUID_CAPITAN)

    assert.equal(perfil.nombre_completo, 'Isaac Velasquez Ruiz')
    assert.equal(perfil.uuid_usuario, UUID_CAPITAN)
    // La regla del contrato: id_usuario nunca sale del backend.
    assert.notProperty(perfil, 'id')
    assert.notProperty(perfil, 'id_usuario')
  })

  test('serializar el modelo completo tampoco filtra el entero ni el hash', async ({ assert }) => {
    await sembrarCapitan()
    const { default: Usuario } = await import('#modules/identidad/models/usuario')
    const u = await Usuario.query().where('uuid_usuario', UUID_CAPITAN).firstOrFail()

    const json = u.serialize()
    assert.notProperty(json, 'id')
    assert.notProperty(json, 'id_usuario')
    assert.notProperty(json, 'passwordHash')
    assert.notProperty(json, 'password_hash')
    assert.property(json, 'uuid_usuario')
  })

  test('un UUID sin cuenta se trata como sesión inválida, no como recurso faltante', async ({
    assert,
  }) => {
    /**
     * SGEB-1003 y no SGEB-3001: un token bien firmado cuyo sujeto no existe
     * significa que la cuenta se borró con el token todavía vivo. Responder
     * "no encontrado" además confirmaría al portador que su UUID era válido.
     */
    try {
      await new IdentidadLocal().resolverPorUuid(UUID_INEXISTENTE)
      assert.fail('debió lanzar SgebError')
    } catch (e) {
      assert.equal((e as SgebError).codigo, 'SGEB-1003')
    }
  })

  test('exigirRol acepta al usuario con el rol requerido', async ({ assert }) => {
    await sembrarCapitan()
    const u = await new IdentidadLocal().exigirRol(UUID_CAPITAN, ['capitan', 'admin'])
    assert.equal(u.rol, 'capitan')
  })

  test('exigirRol distingue "no existe" (3002) de "no califica" (4023)', async ({ assert }) => {
    await sembrarCapitan()

    // Existe pero con otro rol → regla de negocio.
    try {
      await new IdentidadLocal().exigirRol(UUID_CAPITAN, ['mesero'])
      assert.fail('debió lanzar')
    } catch (e) {
      assert.equal((e as SgebError).codigo, 'SGEB-4023')
    }

    // No existe → integridad referencial, igual que cualquier otra FK rota.
    try {
      await new IdentidadLocal().exigirRol(UUID_INEXISTENTE, ['capitan'])
      assert.fail('debió lanzar')
    } catch (e) {
      assert.equal((e as SgebError).codigo, 'SGEB-3002')
    }
  })

  test('exigirRol rechaza una cuenta desactivada aunque el rol coincida', async ({ assert }) => {
    await sembrarCapitan()
    await db.from('usuario').where('uuid_usuario', UUID_CAPITAN).update({ activo: false })

    try {
      await new IdentidadLocal().exigirRol(UUID_CAPITAN, ['capitan'])
      assert.fail('debió lanzar')
    } catch (e) {
      assert.equal((e as SgebError).codigo, 'SGEB-4023')
    }
  })

  test('perfiles resuelve varios UUIDs en una sola consulta', async ({ assert }) => {
    await sembrarCapitan()
    const mapa = await new IdentidadLocal().perfiles([UUID_CAPITAN, UUID_INEXISTENTE])

    assert.equal(mapa.size, 1)
    assert.equal(mapa.get(UUID_CAPITAN)?.rol, 'capitan')
    assert.isUndefined(mapa.get(UUID_INEXISTENTE))
  })

  test('perfiles con lista vacía no consulta la base', async ({ assert }) => {
    const mapa = await new IdentidadLocal().perfiles([])
    assert.equal(mapa.size, 0)
  })
})
