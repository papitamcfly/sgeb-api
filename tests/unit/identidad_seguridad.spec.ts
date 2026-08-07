import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { createHash, randomBytes } from 'node:crypto'
import { jwtVerify, createLocalJWKSet } from 'jose'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'

import { LlaveFirmaService } from '#modules/identidad/services/llave_firma_service'
import { TokenService } from '#modules/identidad/services/token_service'
import { AutorizacionService } from '#modules/identidad/services/autorizacion_service'
import { CredencialesService } from '#modules/identidad/services/credenciales_service'
import Usuario from '#modules/identidad/models/usuario'
import RefreshToken from '#modules/identidad/models/refresh_token'
import LlaveFirma from '#modules/identidad/models/llave_firma'
import type { SsoError } from '#modules/identidad/errores_sso'

const UUID = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const PASSWORD = 'Contrasena1'

async function sembrarUsuario(activo = true): Promise<Usuario> {
  await db.table('usuario').insert({
    uuid_usuario: UUID,
    id_rol: 2,
    nombre: 'Isaac',
    apellido_paterno: 'Velasquez',
    correo: 'cap@x.mx',
    password_hash: await hash.make(PASSWORD),
    activo,
  })
  return Usuario.query().where('uuid_usuario', UUID).preload('rol').firstOrFail()
}

/** Captura el código SSO de una operación que debe fallar. */
async function codigoDeFallo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_FALLO'
  } catch (e) {
    return (e as SsoError).codigo ?? 'SIN_CODIGO'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
test.group('Llaves de firma', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('la llave privada se guarda cifrada, nunca en claro', async ({ assert }) => {
    const llave = await new LlaveFirmaService().rotar('RS256')
    const fila = await LlaveFirma.findOrFail(llave.id)

    /**
     * Si un volcado de la base entregara la llave privada en PEM, cualquiera
     * podría firmar tokens para cualquier usuario y cualquier rol.
     */
    assert.notInclude(fila.llavePrivadaCifrada, 'BEGIN PRIVATE KEY')
    assert.notInclude(fila.llavePrivadaCifrada, 'BEGIN RSA')
    assert.match(fila.llavePrivadaCifrada, /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/)

    // Y aun así se puede usar para firmar.
    const activa = await new LlaveFirmaService().activa()
    assert.include(activa.privadaPem, 'BEGIN PRIVATE KEY')
  })

  test('el modelo nunca serializa la llave privada', async ({ assert }) => {
    const llave = await new LlaveFirmaService().rotar()
    const json = llave.serialize()
    assert.notProperty(json, 'llavePrivadaCifrada')
    assert.notProperty(json, 'llave_privada_cifrada')
    assert.property(json, 'kid')
  })

  test('rotar retira la anterior y deja una sola activa', async ({ assert }) => {
    const servicio = new LlaveFirmaService()
    const primera = await servicio.rotar()
    const segunda = await servicio.rotar()

    const activas = await LlaveFirma.query().where('estado', 'activa')
    assert.lengthOf(activas, 1)
    assert.equal(activas[0].kid, segunda.kid)

    const vieja = await LlaveFirma.findOrFail(primera.id)
    assert.equal(vieja.estado, 'retirada')
    assert.isNotNull(vieja.retiradaEn)
  })

  test('el JWKS publica activas y retiradas, para no invalidar sesiones vivas', async ({
    assert,
  }) => {
    const servicio = new LlaveFirmaService()
    const primera = await servicio.rotar()
    const segunda = await servicio.rotar()

    const { keys } = await servicio.jwks()
    const kids = keys.map((k) => k.kid)

    /**
     * "Retirada" = ya no firma, pero sus tokens siguen validando hasta expirar.
     * Sacarla del documento cerraría todas las sesiones abiertas de golpe.
     */
    assert.includeMembers(kids, [primera.kid, segunda.kid])
    assert.notProperty(keys[0], 'd') // 'd' es el componente privado de una JWK
  })

  test('el JWKS oculta las llaves revocadas', async ({ assert }) => {
    const servicio = new LlaveFirmaService()
    const comprometida = await servicio.rotar()
    await servicio.rotar()

    await LlaveFirma.query().where('kid', comprometida.kid).update({ estado: 'revocada' })

    const { keys } = await servicio.jwks()
    /** Revocada = se comprometió; sus tokens deben dejar de validar de inmediato. */
    assert.notInclude(keys.map((k) => k.kid), comprometida.kid)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
test.group('Emisión y rotación de tokens', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function escenario() {
    const usuario = await sembrarUsuario()
    await new LlaveFirmaService().rotar()
    const tokens = new TokenService()
    const emitido = await tokens.emitir({
      usuario,
      rol: 'capitan',
      cliente: 'movil',
      metodoLogin: 'password_2fa',
      scope: 'openid perfil sgeb.api',
      sid: 'sid-1',
    })
    return { usuario, tokens, emitido }
  }

  test('el access token valida contra el JWKS público y trae los claims esperados', async ({
    assert,
  }) => {
    const { emitido } = await escenario()
    const jwks = createLocalJWKSet(
      (await new LlaveFirmaService().jwks()) as Parameters<typeof createLocalJWKSet>[0]
    )

    const { payload, protectedHeader } = await jwtVerify(emitido.access_token, jwks, {
      issuer: 'https://auth.sgeb.mediocres.mx',
      audience: 'sgeb-api',
    })

    assert.equal(payload.sub, UUID)
    assert.equal(payload.rol, 'capitan')
    assert.deepEqual(payload.amr, ['pwd', 'mfa'])
    assert.isString(protectedHeader.kid)
    assert.oneOf(protectedHeader.alg, ['RS256', 'ES256'])
  })

  test('el access token NO transporta datos personales', async ({ assert }) => {
    const { emitido } = await escenario()
    const [, cuerpoB64] = emitido.access_token.split('.')
    const payload = JSON.parse(Buffer.from(cuerpoB64, 'base64url').toString())

    /**
     * Un JWT está firmado, no cifrado: cualquiera que lo intercepte lee su
     * contenido. Por eso el correo y el nombre van solo en el id_token, que
     * consume el cliente, no la API.
     */
    assert.notProperty(payload, 'email')
    assert.notProperty(payload, 'name')
    assert.notProperty(payload, 'clabe')
    assert.property(payload, 'sub')
  })

  test('el refresh token se guarda hasheado, no en claro', async ({ assert }) => {
    const { emitido } = await escenario()
    const esperado = createHash('sha256').update(emitido.refresh_token).digest('hex')

    const fila = await RefreshToken.query().where('token_hash', esperado).first()
    assert.isNotNull(fila)

    const enClaro = await RefreshToken.query().where('token_hash', emitido.refresh_token).first()
    assert.isNull(enClaro)
  })

  test('la rotación revoca el anterior y encadena el nuevo', async ({ assert }) => {
    const { tokens, emitido } = await escenario()
    const nuevo = await tokens.rotar({ refreshToken: emitido.refresh_token, cliente: 'movil' })

    assert.notEqual(nuevo.refresh_token, emitido.refresh_token)

    const viejo = await RefreshToken.query()
      .where('token_hash', createHash('sha256').update(emitido.refresh_token).digest('hex'))
      .firstOrFail()
    assert.isTrue(viejo.revocado)

    const actual = await RefreshToken.query()
      .where('token_hash', createHash('sha256').update(nuevo.refresh_token).digest('hex'))
      .firstOrFail()
    assert.equal(actual.idPadre, viejo.id)
  })

  test('REÚSO: presentar un token ya rotado revoca la cadena completa', async ({ assert }) => {
    const { tokens, emitido, usuario } = await escenario()
    const segundo = await tokens.rotar({ refreshToken: emitido.refresh_token, cliente: 'movil' })

    /**
     * Solo hay dos explicaciones para esto y ninguna es buena: alguien robó el
     * token, o el legítimo reenvió porque perdió la respuesta. No se pueden
     * distinguir, así que se asume el peor caso.
     */
    const codigo = await codigoDeFallo(() =>
      tokens.rotar({ refreshToken: emitido.refresh_token, cliente: 'movil' })
    )
    assert.equal(codigo, 'SSO-1007')

    // El token nuevo, que estaba sano, también queda revocado.
    const vivos = await RefreshToken.query()
      .where('id_usuario', usuario.id)
      .where('revocado', false)
    assert.lengthOf(vivos, 0)

    const codigo2 = await codigoDeFallo(() =>
      tokens.rotar({ refreshToken: segundo.refresh_token, cliente: 'movil' })
    )
    assert.equal(codigo2, 'SSO-1007')
  })

  test('una cuenta desactivada no puede renovar y pierde sus tokens', async ({ assert }) => {
    const { tokens, emitido, usuario } = await escenario()
    await db.from('usuario').where('id_usuario', usuario.id).update({ activo: false })

    const codigo = await codigoDeFallo(() =>
      tokens.rotar({ refreshToken: emitido.refresh_token, cliente: 'movil' })
    )
    assert.equal(codigo, 'SSO-1005')

    const vivos = await RefreshToken.query().where('id_usuario', usuario.id).where('revocado', false)
    assert.lengthOf(vivos, 0)
  })

  test('un refresh token expirado se rechaza', async ({ assert }) => {
    const { tokens, emitido } = await escenario()
    await db
      .from('auth.refresh_token')
      .update({ expira_en: DateTime.now().minus({ days: 1 }).toSQL() })

    assert.equal(
      await codigoDeFallo(() => tokens.rotar({ refreshToken: emitido.refresh_token, cliente: 'movil' })),
      'SSO-1006'
    )
  })

  test('revocar cierra solo esta aplicación', async ({ assert }) => {
    const { tokens, emitido } = await escenario()
    await tokens.revocar(emitido.refresh_token)

    assert.equal(
      await codigoDeFallo(() => tokens.rotar({ refreshToken: emitido.refresh_token, cliente: 'movil' })),
      'SSO-1007' // revocado → se interpreta como reúso
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
test.group('PKCE y código de autorización', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  function pkce() {
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    return { verifier, challenge }
  }

  async function flujoHastaCodigo(servicio: AutorizacionService, challenge: string) {
    const usuario = await sembrarUsuario()
    const solicitud = servicio.validarParametros({
      clientId: 'sgeb-ios-mesero',
      redirectUri: 'mx.mediocres.sgeb://callback',
      scope: 'openid perfil sgeb.api',
      state: randomBytes(16).toString('hex'),
      nonce: randomBytes(16).toString('hex'),
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    })
    const ticket = await servicio.crearFlujo(solicitud)
    const { code } = await servicio.emitirCodigo(ticket, usuario.id)
    return { usuario, code }
  }

  test('un client_id desconocido se rechaza SIN redirigir', async ({ assert }) => {
    const s = new AutorizacionService()
    assert.equal(
      await codigoDeFallo(async () => s.validarCliente('app-pirata', 'https://x.mx/cb')),
      'SSO-4006'
    )
  })

  test('una redirect_uri no registrada se rechaza SIN redirigir', async ({ assert }) => {
    const s = new AutorizacionService()
    /**
     * Redirigir a una URL no verificada convertiría al proveedor en un
     * redirector abierto: el atacante armaría un enlace que aparenta venir de
     * tu dominio y termina en el suyo.
     */
    assert.equal(
      await codigoDeFallo(async () =>
        s.validarCliente('sgeb-ios-mesero', 'https://evil.example/robo')
      ),
      'SSO-4007'
    )
  })

  test('la coincidencia de redirect_uri es exacta, sin prefijos', async ({ assert }) => {
    const s = new AutorizacionService()
    assert.equal(
      await codigoDeFallo(async () =>
        s.validarCliente('sgeb-ios-mesero', 'mx.mediocres.sgeb://callback/../evil')
      ),
      'SSO-4007'
    )
  })

  test('el método plain de PKCE está prohibido', async ({ assert }) => {
    const s = new AutorizacionService()
    const { challenge } = pkce()
    /** `plain` envía el verificador tal cual y anula el propósito de PKCE. */
    assert.equal(
      await codigoDeFallo(async () =>
        s.validarParametros({
          clientId: 'sgeb-ios-mesero',
          redirectUri: 'mx.mediocres.sgeb://callback',
          scope: 'openid',
          state: randomBytes(16).toString('hex'),
          nonce: 'n'.repeat(16),
          codeChallenge: challenge,
          codeChallengeMethod: 'plain' as never,
        })
      ),
      'SSO-2004'
    )
  })

  test('un state corto se rechaza: debe ser impredecible', async ({ assert }) => {
    const s = new AutorizacionService()
    const { challenge } = pkce()
    assert.equal(
      await codigoDeFallo(async () =>
        s.validarParametros({
          clientId: 'sgeb-ios-mesero',
          redirectUri: 'mx.mediocres.sgeb://callback',
          scope: 'openid',
          state: '123',
          nonce: 'n'.repeat(16),
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
        })
      ),
      'SSO-2003'
    )
  })

  test('el canje con el verificador correcto funciona', async ({ assert }) => {
    const s = new AutorizacionService()
    const { verifier, challenge } = pkce()
    const { code, usuario } = await flujoHastaCodigo(s, challenge)

    const fila = await s.canjearCodigo({
      code,
      clientId: 'sgeb-ios-mesero',
      redirectUri: 'mx.mediocres.sgeb://callback',
      codeVerifier: verifier,
    })
    assert.equal(fila.id_usuario, usuario.id)
  })

  test('PKCE: un verificador equivocado no canjea el código robado', async ({ assert }) => {
    const s = new AutorizacionService()
    const { challenge } = pkce()
    const { code } = await flujoHastaCodigo(s, challenge)

    /**
     * Este es el ataque que PKCE existe para frenar: el atacante interceptó el
     * código, pero sin el verificador no puede canjearlo.
     */
    assert.equal(
      await codigoDeFallo(() =>
        s.canjearCodigo({
          code,
          clientId: 'sgeb-ios-mesero',
          redirectUri: 'mx.mediocres.sgeb://callback',
          codeVerifier: randomBytes(32).toString('base64url'),
        })
      ),
      'SSO-1016'
    )
  })

  test('el código es de un solo uso y el segundo canje revoca los tokens emitidos', async ({
    assert,
  }) => {
    const s = new AutorizacionService()
    const { verifier, challenge } = pkce()
    const { code, usuario } = await flujoHastaCodigo(s, challenge)

    await s.canjearCodigo({
      code,
      clientId: 'sgeb-ios-mesero',
      redirectUri: 'mx.mediocres.sgeb://callback',
      codeVerifier: verifier,
    })

    await new LlaveFirmaService().rotar()
    await new TokenService().emitir({
      usuario,
      rol: 'capitan',
      cliente: 'movil',
      metodoLogin: 'password_2fa',
      scope: 'openid',
      sid: 'sid-x',
    })

    assert.equal(
      await codigoDeFallo(() =>
        s.canjearCodigo({
          code,
          clientId: 'sgeb-ios-mesero',
          redirectUri: 'mx.mediocres.sgeb://callback',
          codeVerifier: verifier,
        })
      ),
      'SSO-1015'
    )

    /** Un segundo canje solo ocurre si alguien interceptó: se revoca lo emitido. */
    const vivos = await RefreshToken.query().where('id_usuario', usuario.id).where('revocado', false)
    assert.lengthOf(vivos, 0)
  })

  test('el canje exige la misma redirect_uri con la que se emitió', async ({ assert }) => {
    const s = new AutorizacionService()
    const { verifier, challenge } = pkce()
    const { code } = await flujoHastaCodigo(s, challenge)

    assert.equal(
      await codigoDeFallo(() =>
        s.canjearCodigo({
          code,
          clientId: 'sgeb-ios-mesero',
          redirectUri: 'mx.mediocres.sgeb://otra',
          codeVerifier: verifier,
        })
      ),
      'SSO-1015'
    )
  })

  test('un ticket de flujo no se puede consumir dos veces', async ({ assert }) => {
    const s = new AutorizacionService()
    const usuario = await sembrarUsuario()
    const { challenge } = pkce()
    const solicitud = s.validarParametros({
      clientId: 'sgeb-web-panel',
      redirectUri: 'https://sgeb.mediocres.mx/callback',
      scope: 'openid perfil',
      state: randomBytes(16).toString('hex'),
      nonce: randomBytes(16).toString('hex'),
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    })
    const ticket = await s.crearFlujo(solicitud)
    await s.emitirCodigo(ticket, usuario.id)

    assert.equal(await codigoDeFallo(() => s.emitirCodigo(ticket, usuario.id)), 'SSO-1017')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
test.group('Credenciales y bloqueo', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('credenciales correctas piden segundo factor', async ({ assert }) => {
    await sembrarUsuario()
    const r = await (await app.container.make(CredencialesService)).autenticar({
      correo: 'cap@x.mx',
      password: PASSWORD,
      cliente: 'web',
    })
    assert.equal(r.estado, 'verificacion_requerida')
  })

  test('contraseña incorrecta y correo inexistente dan el MISMO código', async ({ assert }) => {
    await sembrarUsuario()
    const s = await app.container.make(CredencialesService)

    /**
     * Distinguirlos convertiría el login en un enumerador de cuentas: probando
     * correos, el atacante sabría cuáles existen antes de atacar contraseñas.
     */
    const a = await codigoDeFallo(() =>
      s.autenticar({ correo: 'cap@x.mx', password: 'mala', cliente: 'web' })
    )
    const b = await codigoDeFallo(() =>
      s.autenticar({ correo: 'nadie@x.mx', password: 'mala', cliente: 'web' })
    )
    assert.equal(a, 'SSO-1001')
    assert.equal(b, 'SSO-1001')
  })

  test('una cuenta desactivada no entra aunque la contraseña sea correcta', async ({ assert }) => {
    await sembrarUsuario(false)
    const s = await app.container.make(CredencialesService)
    assert.equal(
      await codigoDeFallo(() =>
        s.autenticar({ correo: 'cap@x.mx', password: PASSWORD, cliente: 'web' })
      ),
      'SSO-1005'
    )
  })

  test('cinco fallos bloquean la cuenta temporalmente', async ({ assert }) => {
    await sembrarUsuario()
    const s = await app.container.make(CredencialesService)

    for (let i = 0; i < 5; i++) {
      await codigoDeFallo(() =>
        s.autenticar({ correo: 'cap@x.mx', password: 'mala', cliente: 'web' })
      )
    }

    /** Ya bloqueada: ni siquiera la contraseña correcta entra. */
    assert.equal(
      await codigoDeFallo(() =>
        s.autenticar({ correo: 'cap@x.mx', password: PASSWORD, cliente: 'web' })
      ),
      'SSO-1008'
    )
  })

  test('el código de verificación se guarda hasheado y funciona una sola vez', async ({
    assert,
  }) => {
    const usuario = await sembrarUsuario()
    const s = await app.container.make(CredencialesService)
    const codigo = await s.emitirCodigo(usuario, 'login')

    assert.match(codigo, /^\d{6}$/)

    const fila = await db.from('auth.codigo_verificacion').where('id_usuario', usuario.id).first()
    assert.notEqual(fila.codigo_hash, codigo)
    assert.match(fila.codigo_hash, /^\$bcrypt\$/)

    const ok = await s.verificarCodigo({ idUsuario: usuario.id, codigo, proposito: 'login' })
    assert.equal(ok.id, usuario.id)

    assert.equal(
      await codigoDeFallo(() =>
        s.verificarCodigo({ idUsuario: usuario.id, codigo, proposito: 'login' })
      ),
      'SSO-1010'
    )
  })

  test('un código incorrecto cuenta el intento; a los cinco se invalida', async ({ assert }) => {
    const usuario = await sembrarUsuario()
    const s = await app.container.make(CredencialesService)
    await s.emitirCodigo(usuario, 'login')

    for (let i = 0; i < 5; i++) {
      assert.equal(
        await codigoDeFallo(() =>
          s.verificarCodigo({ idUsuario: usuario.id, codigo: '000000', proposito: 'login' })
        ),
        'SSO-1009'
      )
    }

    assert.equal(
      await codigoDeFallo(() =>
        s.verificarCodigo({ idUsuario: usuario.id, codigo: '000000', proposito: 'login' })
      ),
      'SSO-1010'
    )
  })

  test('emitir un código nuevo invalida el anterior', async ({ assert }) => {
    const usuario = await sembrarUsuario()
    const s = await app.container.make(CredencialesService)
    const viejo = await s.emitirCodigo(usuario, 'login')
    await s.emitirCodigo(usuario, 'login')

    /** Si el viejo siguiera sirviendo, cada reenvío ampliaría la ventana de ataque. */
    assert.equal(
      await codigoDeFallo(() =>
        s.verificarCodigo({ idUsuario: usuario.id, codigo: viejo, proposito: 'login' })
      ),
      'SSO-1009'
    )
  })

  test('el reenvío exige esperar 60 segundos', async ({ assert }) => {
    const usuario = await sembrarUsuario()
    const s = await app.container.make(CredencialesService)
    await s.emitirCodigo(usuario, 'login')

    assert.equal(await codigoDeFallo(() => s.reenviarCodigo(usuario.id, 'login')), 'SSO-1011')
  })

  test('un dispositivo confiable vigente omite el segundo factor', async ({ assert }) => {
    const usuario = await sembrarUsuario()
    const s = await app.container.make(CredencialesService)
    const token = await s.confiarDispositivo({ idUsuario: usuario.id, plataforma: 'ios' })

    const r = await s.autenticar({
      correo: 'cap@x.mx',
      password: PASSWORD,
      cliente: 'movil',
      tokenDispositivo: token,
    })
    assert.equal(r.estado, 'autenticado')
  })

  test('un dispositivo caducado NO es error: solo pierde el atajo', async ({ assert }) => {
    const usuario = await sembrarUsuario()
    const s = await app.container.make(CredencialesService)
    const token = await s.confiarDispositivo({ idUsuario: usuario.id, plataforma: 'ios' })
    await db
      .from('auth.dispositivo_confiable')
      .update({ expira_en: DateTime.now().minus({ days: 1 }).toSQL() })

    const r = await s.autenticar({
      correo: 'cap@x.mx',
      password: PASSWORD,
      cliente: 'movil',
      tokenDispositivo: token,
    })
    assert.equal(r.estado, 'verificacion_requerida')
  })

  test('el token de dispositivo se guarda hasheado', async ({ assert }) => {
    const usuario = await sembrarUsuario()
    const token = await (await app.container.make(CredencialesService)).confiarDispositivo({
      idUsuario: usuario.id,
      plataforma: 'web',
    })
    const fila = await db.from('auth.dispositivo_confiable').where('id_usuario', usuario.id).first()
    assert.equal(fila.token_hash, createHash('sha256').update(token).digest('hex'))
    assert.notEqual(fila.token_hash, token)
  })
})
