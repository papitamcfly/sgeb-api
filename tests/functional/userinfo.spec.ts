import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { LlaveFirmaService } from '#modules/identidad/services/llave_firma_service'
import { TokenService } from '#modules/identidad/services/token_service'
import Usuario from '#modules/identidad/models/usuario'

/**
 * /userinfo por HTTP real. Cubre la regresión donde la ruta no tenía
 * middleware y el controlador leía un encabezado `x-sujeto-uuid` que nadie
 * poblaba: cualquier Bearer token, válido o no, terminaba en SSO-1003.
 */

const UUID = '9b6f9b1a-9e3c-4b3e-8a1d-1f8c6a2e4b71'
const CORREO = 'userinfo.spec@x.mx'

async function crearUsuario(): Promise<Usuario> {
  await db.table('usuario').insert({
    uuid_usuario: UUID,
    id_rol: 2,
    nombre: 'Isaac',
    apellido_paterno: 'Velasquez',
    correo: CORREO,
    password_hash: 'x'.repeat(60),
  })
  return Usuario.query().where('uuid_usuario', UUID).preload('rol').firstOrFail()
}

/** Emite un access token real, firmado con la llave activa. */
async function tokenPara(usuario: Usuario): Promise<string> {
  const tokens = await app.container.make(TokenService)
  const r = await tokens.emitir({
    usuario,
    rol: usuario.rol.nombre,
    cliente: 'web',
    metodoLogin: 'password_2fa',
    scope: 'openid perfil sgeb.api',
    sid: 'sid-prueba',
  })
  return r.access_token
}

test.group('GET /userinfo', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('con un bearer token válido devuelve el perfil del sujeto autenticado', async ({
    client,
    assert,
  }) => {
    await new LlaveFirmaService().rotar()
    const usuario = await crearUsuario()
    const token = await tokenPara(usuario)

    const r = await client.get('/userinfo').bearerToken(token)

    r.assertStatus(200)
    assert.equal(r.body().sub, usuario.uuidUsuario)
    assert.equal(r.body().email, usuario.correo)
    assert.equal(r.body().rol, 'capitan')
  })

  test('sin Authorization se rechaza', async ({ client }) => {
    const r = await client.get('/userinfo')
    r.assertStatus(401)
  })

  test('con la firma manipulada se rechaza', async ({ client }) => {
    await new LlaveFirmaService().rotar()
    const usuario = await crearUsuario()
    const token = await tokenPara(usuario)

    const r = await client.get('/userinfo').bearerToken(`${token}manipulado`)
    r.assertStatus(401)
  })

  test('resuelve al usuario a partir del sujeto del JWT, no de un encabezado', async ({
    client,
    assert,
  }) => {
    await new LlaveFirmaService().rotar()
    const usuario = await crearUsuario()
    const token = await tokenPara(usuario)

    /**
     * Antes del fix, un `x-sujeto-uuid` falsificado decidía la respuesta
     * porque el controlador nunca miraba el token. Ahora debe ser ignorado.
     */
    const r = await client
      .get('/userinfo')
      .bearerToken(token)
      .header('x-sujeto-uuid', '00000000-0000-0000-0000-000000000000')

    r.assertStatus(200)
    assert.equal(r.body().sub, usuario.uuidUsuario)
  })
})
