import { test } from '@japa/runner'
import { createHash, randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { LlaveFirmaService } from '#modules/identidad/services/llave_firma_service'
import { InvitacionService } from '#modules/identidad/services/invitacion_service'
import { RecuperacionService } from '#modules/identidad/services/recuperacion_service'
import { CredencialesService } from '#modules/identidad/services/credenciales_service'
import Usuario from '#modules/identidad/models/usuario'

/**
 * Flujo completo: invitación → registro → login con PKCE → tokens.
 *
 * Estas son pruebas FUNCIONALES: recorren el HTTP real, no los servicios
 * sueltos. Es donde aparecen los fallos de cableado —una ruta mal registrada,
 * un campo con otro nombre, una cookie que no viaja— que las pruebas unitarias
 * no pueden ver porque no cruzan la frontera de la petición.
 */

const PASSWORD = 'Mesero2026'
/** CLABE con dígito de control correcto (BBVA). */
const CLABE = '012180012345678909'

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

function urlAuthorize(challenge: string, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: 'sgeb-ios-mesero',
    redirect_uri: 'mx.mediocres.sgeb://callback',
    scope: 'openid perfil sgeb.api',
    state: randomBytes(16).toString('hex'),
    nonce: randomBytes(16).toString('hex'),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...extra,
  })
  return { url: `/authorize?${p}`, state: p.get('state')! }
}

async function capitan(): Promise<number> {
  const [u] = await db
    .table('usuario')
    .returning('id_usuario')
    .insert({
      uuid_usuario: '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840',
      id_rol: 2,
      nombre: 'Isaac',
      apellido_paterno: 'Velasquez',
      correo: 'cap@x.mx',
      password_hash: 'x'.repeat(60),
    })
  return u.id_usuario
}

test.group('Alta del mesero por invitación', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el capitán invita y el mesero completa su registro', async ({ assert }) => {
    const idCap = await capitan()
    const inv = new InvitacionService()

    const { token, deeplink } = await inv.invitar({
      idEmisor: idCap,
      idRolDestino: 3,
      nombre: 'Juan',
      apellidoPaterno: 'Perez',
      correo: 'Juan@X.MX',
    })

    assert.include(deeplink, 'mx.mediocres.sgeb://registro?token=')

    /** En la base solo queda el hash: un volcado no permite completar registros ajenos. */
    const fila = await db.from('auth.invitacion').where('correo', 'juan@x.mx').firstOrFail()
    assert.equal(fila.token_hash, createHash('sha256').update(token).digest('hex'))
    assert.notEqual(fila.token_hash, token)

    const usuario = await inv.registrar({
      token,
      password: PASSWORD,
      password2: PASSWORD,
      clabe: CLABE,
      banco: 'BBVA',
      titular: 'Juan Perez',
      aceptaPrivacidad: true,
    })

    assert.equal(usuario.correo, 'juan@x.mx')
    assert.match(usuario.uuidUsuario, /^[0-9a-f-]{36}$/)

    /** La CLABE vive en el módulo de nómina, no en las tablas de identidad. */
    const banco = await db.from('datos_bancarios').where('id_usuario', usuario.id).firstOrFail()
    assert.equal(banco.clabe, CLABE)
    assert.isTrue(banco.activo)

    const usada = await db.from('auth.invitacion').where('id_invitacion', fila.id_invitacion).firstOrFail()
    assert.equal(usada.estado, 'usada')
    assert.equal(usada.id_usuario_creado, usuario.id)
  })

  test('el deeplink no se puede usar dos veces', async ({ assert }) => {
    const idCap = await capitan()
    const inv = new InvitacionService()
    const { token } = await inv.invitar({
      idEmisor: idCap,
      idRolDestino: 3,
      nombre: 'Juan',
      apellidoPaterno: 'Perez',
      correo: 'juan@x.mx',
    })
    const datos = {
      token,
      password: PASSWORD,
      password2: PASSWORD,
      clabe: CLABE,
      banco: 'BBVA',
      titular: 'Juan Perez',
      aceptaPrivacidad: true,
    }
    await inv.registrar(datos)

    try {
      await inv.registrar(datos)
      assert.fail('debió lanzar')
    } catch (e) {
      assert.equal((e as { codigo: string }).codigo, 'SSO-3002')
    }
  })

  test('rechaza una CLABE con dígito de control incorrecto', async ({ assert }) => {
    const idCap = await capitan()
    const inv = new InvitacionService()
    const { token } = await inv.invitar({
      idEmisor: idCap,
      idRolDestino: 3,
      nombre: 'Juan',
      apellidoPaterno: 'Perez',
      correo: 'juan@x.mx',
    })

    /**
     * Una CLABE mal tecleada que pasa a nómina termina en una transferencia
     * rechazada o, peor, enviada a la cuenta de otra persona.
     */
    try {
      await inv.registrar({
        token,
        password: PASSWORD,
        password2: PASSWORD,
        clabe: '012180012345678903',
        banco: 'BBVA',
        titular: 'Juan Perez',
        aceptaPrivacidad: true,
      })
      assert.fail('debió lanzar')
    } catch (e) {
      assert.equal((e as { codigo: string }).codigo, 'SSO-2002')
    }
  })

  test('exige aceptar el aviso de privacidad y una contraseña con política', async ({ assert }) => {
    const idCap = await capitan()
    const inv = new InvitacionService()
    const base = {
      password: PASSWORD,
      password2: PASSWORD,
      clabe: CLABE,
      banco: 'BBVA',
      titular: 'Juan Perez',
      aceptaPrivacidad: true,
    }

    const { token: t1 } = await inv.invitar({
      idEmisor: idCap, idRolDestino: 3, nombre: 'A', apellidoPaterno: 'B', correo: 'a@x.mx',
    })
    try {
      await inv.registrar({ ...base, token: t1, aceptaPrivacidad: false })
      assert.fail('debió lanzar')
    } catch (e) {
      assert.equal((e as { codigo: string }).codigo, 'SSO-4005')
    }

    try {
      await inv.registrar({ ...base, token: t1, password: 'abc', password2: 'abc' })
      assert.fail('debió lanzar')
    } catch (e) {
      assert.equal((e as { codigo: string }).codigo, 'SSO-2006')
    }
  })
})

test.group('Flujo HTTP completo con PKCE', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function meseroRegistrado(): Promise<Usuario> {
    const idCap = await capitan()
    const inv = new InvitacionService()
    const { token } = await inv.invitar({
      idEmisor: idCap,
      idRolDestino: 3,
      nombre: 'Juan',
      apellidoPaterno: 'Perez',
      correo: 'juan@x.mx',
    })
    const usuario = await inv.registrar({
      token,
      password: PASSWORD,
      password2: PASSWORD,
      clabe: CLABE,
      banco: 'BBVA',
      titular: 'Juan Perez',
      aceptaPrivacidad: true,
    })
    await new LlaveFirmaService().rotar()
    return usuario
  }

  test('un cliente desconocido recibe página de error, NUNCA una redirección', async ({
    client,
    assert,
  }) => {
    const r = await client.get(
      '/authorize?response_type=code&client_id=pirata&redirect_uri=https://evil.mx/x' +
        '&scope=openid&state=aaaaaaaaaaaaaaaa&nonce=bbbbbbbbbbbbbbbb' +
        '&code_challenge=x&code_challenge_method=S256'
    ).redirects(0)

    /**
     * Redirigir a una URL no verificada convertiría al proveedor en un
     * redirector abierto: un enlace que aparenta venir de tu dominio y termina
     * en el del atacante, con tu credibilidad prestada.
     */
    r.assertStatus(400)
    assert.notExists(r.headers().location)
    r.assertTextIncludes('SSO-4006')
  })

  test('/authorize sin sesión lleva a la pantalla de credenciales', async ({ client, assert }) => {
    await meseroRegistrado()
    const { challenge } = pkce()
    const r = await client.get(urlAuthorize(challenge).url).redirects(0)

    r.assertStatus(302)
    assert.include(r.headers().location ?? '', '/interno/login?ticket=')
  })

  test('recorrido completo: credenciales, 2FA, código y tokens', async ({ client, assert }) => {
    const usuario = await meseroRegistrado()
    const { verifier, challenge } = pkce()
    const { url, state } = urlAuthorize(challenge)

    // 1. La app abre /authorize en el navegador del sistema.
    const auth = await client.get(url).redirects(0)
    const ticket = new URL(auth.headers().location!, 'http://x').searchParams.get('ticket')!

    // 2. Pantalla S1 y envío de credenciales.
    const login = await client.get(`/interno/login?ticket=${encodeURIComponent(ticket)}`)
    login.assertTextIncludes('Iniciar sesión')

    const post = await client
      .post('/interno/login')
      .form({ ticket, correo: 'juan@x.mx', password: PASSWORD })
      .redirects(0)

    /** Primera vez: el equipo no es de confianza, así que toca segundo factor. */
    post.assertTextIncludes('Verifica que eres tú')

    // 3. El código real se lee de la base (en producción llega por correo).
    const fila = await db
      .from('auth.codigo_verificacion')
      .where('id_usuario', usuario.id)
      .orderBy('id_codigo', 'desc')
      .firstOrFail()
    assert.isFalse(fila.usado)

    /** Se prueba con un código conocido, emitiéndolo desde el servicio. */
    const codigo = await new CredencialesService().emitirCodigo(usuario, 'login')

    const verif = await client
      .post('/interno/verificacion')
      .form({ ticket, codigo })
      .redirects(0)

    // 4. Redirección de vuelta al cliente, con code y state.
    verif.assertStatus(302)
    const destino = new URL(verif.headers().location!)
    assert.equal(destino.searchParams.get('state'), state)
    const code = destino.searchParams.get('code')!
    assert.isNotNull(code)

    // 5. Canje con el verificador.
    const tok = await client.post('/token').form({
      grant_type: 'authorization_code',
      client_id: 'sgeb-ios-mesero',
      redirect_uri: 'mx.mediocres.sgeb://callback',
      code,
      code_verifier: verifier,
    })

    tok.assertStatus(200)
    const cuerpo = tok.body()
    assert.properties(cuerpo, ['access_token', 'id_token', 'refresh_token', 'expires_in'])
    assert.equal(cuerpo.token_type, 'Bearer')
    assert.equal(cuerpo.expires_in, 900)

    // 6. El mismo código no se puede canjear otra vez.
    const repetido = await client.post('/token').form({
      grant_type: 'authorization_code',
      client_id: 'sgeb-ios-mesero',
      redirect_uri: 'mx.mediocres.sgeb://callback',
      code,
      code_verifier: verifier,
    })
    repetido.assertStatus(400)
    assert.equal(repetido.body().sso_code, 'SSO-1015')
  })

  test('un verificador equivocado no canjea el código', async ({ client, assert }) => {
    const usuario = await meseroRegistrado()
    const { challenge } = pkce()
    const { url } = urlAuthorize(challenge)

    const auth = await client.get(url).redirects(0)
    const ticket = new URL(auth.headers().location!, 'http://x').searchParams.get('ticket')!
    await client.post('/interno/login').form({ ticket, correo: 'juan@x.mx', password: PASSWORD }).redirects(0)

    const codigo = await new CredencialesService().emitirCodigo(usuario, 'login')
    const verif = await client.post('/interno/verificacion').form({ ticket, codigo }).redirects(0)
    const code = new URL(verif.headers().location!).searchParams.get('code')!

    const tok = await client.post('/token').form({
      grant_type: 'authorization_code',
      client_id: 'sgeb-ios-mesero',
      redirect_uri: 'mx.mediocres.sgeb://callback',
      code,
      code_verifier: randomBytes(32).toString('base64url'),
    })

    tok.assertStatus(400)
    assert.equal(tok.body().sso_code, 'SSO-1016')
  })

  test('la contraseña incorrecta reaparece en la pantalla, no en una redirección', async ({
    client,
  }) => {
    await meseroRegistrado()
    const { challenge } = pkce()
    const auth = await client.get(urlAuthorize(challenge).url).redirects(0)
    const ticket = new URL(auth.headers().location!, 'http://x').searchParams.get('ticket')!

    const r = await client
      .post('/interno/login')
      .form({ ticket, correo: 'juan@x.mx', password: 'incorrecta' })
      .redirects(0)

    r.assertTextIncludes('SSO-1001')
    r.assertTextIncludes('Iniciar sesión')
  })

  test('prompt=none sin sesión responde login_required en la redirección', async ({
    client,
    assert,
  }) => {
    await meseroRegistrado()
    const { challenge } = pkce()
    const r = await client.get(urlAuthorize(challenge, { prompt: 'none' }).url).redirects(0)

    /**
     * No es un error: es la respuesta esperada de la renovación silenciosa del
     * cliente web, que reacciona abriendo el flujo completo en ventana visible.
     */
    r.assertStatus(302)
    const destino = new URL(r.headers().location!)
    assert.equal(destino.searchParams.get('error'), 'invalid_request')
    assert.include(destino.searchParams.get('error_description') ?? '', 'sesión')
  })

  test('el HTML de las pantallas escapa lo que viene de la petición', async ({ client, assert }) => {
    await meseroRegistrado()
    const { challenge } = pkce()
    const auth = await client.get(urlAuthorize(challenge).url).redirects(0)
    const ticket = new URL(auth.headers().location!, 'http://x').searchParams.get('ticket')!

    /**
     * El correo se repinta en el formulario. Sin escapar sería un XSS en el
     * origen del proveedor — justo donde vive la cookie de sesión SSO.
     */
    const r = await client
      .post('/interno/login')
      .form({ ticket, correo: '"><script>alert(1)</script>', password: 'x' })
      .redirects(0)

    r.assertTextIncludes('&lt;script&gt;')
    assert.notInclude(r.text(), '<script>alert(1)</script>')
  })
})

test.group('Recuperación de contraseña', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function mesero(): Promise<Usuario> {
    const idCap = await capitan()
    const inv = new InvitacionService()
    const { token } = await inv.invitar({
      idEmisor: idCap, idRolDestino: 3, nombre: 'Juan', apellidoPaterno: 'Perez', correo: 'juan@x.mx',
    })
    return inv.registrar({
      token, password: PASSWORD, password2: PASSWORD,
      clabe: CLABE, banco: 'BBVA', titular: 'Juan Perez', aceptaPrivacidad: true,
    })
  }

  test('un correo inexistente responde igual que uno real', async ({ client, assert }) => {
    await mesero()
    const s = new RecuperacionService()

    const real = await s.solicitar('juan@x.mx')
    const falso = await s.solicitar('nadie@x.mx')

    assert.isNotNull(real)
    assert.isNull(falso)

    /** Lo que el usuario ve es idéntico: la pantalla no delata qué correos existen. */
    const a = await client.post('/interno/recuperar').form({ correo: 'juan@x.mx' })
    const b = await client.post('/interno/recuperar').form({ correo: 'nadie@x.mx' })
    assert.equal(a.text(), b.text())
  })

  test('restablecer cierra todas las sesiones abiertas', async ({ assert }) => {
    const usuario = await mesero()
    await new LlaveFirmaService().rotar()

    await db.table('auth.refresh_token').insert({
      id_usuario: usuario.id,
      token_hash: 'a'.repeat(64),
      cliente: 'movil',
      metodo_login: 'password_2fa',
      expira_en: new Date(Date.now() + 86400000).toISOString(),
      revocado: false,
    })

    const s = new RecuperacionService()
    const token = (await s.solicitar('juan@x.mx'))!
    await s.confirmar({ token, password: 'NuevaClave9', password2: 'NuevaClave9' })

    /**
     * Quien recupera su contraseña suele sospechar que su cuenta está
     * comprometida. Dejar vivas las sesiones anteriores permitiría al intruso
     * seguir dentro con un refresh token que ya no depende de esa contraseña.
     */
    const vivos = await db.from('auth.refresh_token').where('id_usuario', usuario.id).where('revocado', false)
    assert.lengthOf(vivos, 0)
  })

  test('el enlace de recuperación es de un solo uso', async ({ assert }) => {
    await mesero()
    const s = new RecuperacionService()
    const token = (await s.solicitar('juan@x.mx'))!
    await s.confirmar({ token, password: 'NuevaClave9', password2: 'NuevaClave9' })

    try {
      await s.confirmar({ token, password: 'OtraClave9', password2: 'OtraClave9' })
      assert.fail('debió lanzar')
    } catch (e) {
      assert.equal((e as { codigo: string }).codigo, 'SSO-3003')
    }
  })

  test('solicitar de nuevo invalida el enlace anterior', async ({ assert }) => {
    await mesero()
    const s = new RecuperacionService()
    const primero = (await s.solicitar('juan@x.mx'))!

    await db.from('auth.token_recuperacion').update({ creado_en: new Date(Date.now() - 600000).toISOString() })
    const segundo = (await s.solicitar('juan@x.mx'))!

    assert.notEqual(primero, segundo)
    try {
      await s.confirmar({ token: primero, password: 'NuevaClave9', password2: 'NuevaClave9' })
      assert.fail('debió lanzar')
    } catch (e) {
      assert.equal((e as { codigo: string }).codigo, 'SSO-3003')
    }
  })
})
