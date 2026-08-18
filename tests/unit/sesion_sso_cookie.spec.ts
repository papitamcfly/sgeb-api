import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import type { CookieOptions } from '@adonisjs/core/types/http'
import type { HttpContext } from '@adonisjs/core/http'
import { SesionSsoService } from '#modules/identidad/services/sesion_sso_service'
import Usuario from '#modules/identidad/models/usuario'

const UUID = 'a1c3d5e7-9b8a-47f0-8c6d-2e4f6a8b0c1d'

/**
 * `bin/test.ts` fija `NODE_ENV=test` antes de arrancar la app, así que
 * `app.inDev` es `false` durante toda la corrida: no hay forma de simular
 * desarrollo cambiando `process.env`. Se sobreescribe el getter directamente
 * en la instancia y se restaura al terminar cada prueba.
 */
function forzarInDev(valor: boolean): () => void {
  const appMutable = app as unknown as Record<string, unknown>
  Object.defineProperty(appMutable, 'inDev', { value: valor, configurable: true })
  return () => {
    delete appMutable.inDev
  }
}

/** Ctx mínimo: solo lo que `SesionSsoService` toca (`response.cookie`, `request.cookie`). */
function ctxDeCookies() {
  const cookies = new Map<string, { valor: string; opciones?: Partial<CookieOptions> }>()
  const ctx = {
    response: {
      cookie(nombre: string, valor: string, opciones?: Partial<CookieOptions>) {
        cookies.set(nombre, { valor, opciones })
      },
    },
    request: {
      cookie(nombre: string, porDefecto: string) {
        return cookies.get(nombre)?.valor ?? porDefecto
      },
    },
  } as unknown as HttpContext
  return { ctx, cookies }
}

test.group('Cookie sso_session', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function sembrarUsuario(): Promise<Usuario> {
    await db.table('usuario').insert({
      uuid_usuario: UUID,
      id_rol: 2,
      nombre: 'Isaac',
      apellido_paterno: 'Velasquez',
      correo: 'sso-cookie-test@x.mx',
      password_hash: 'a'.repeat(60),
    })
    return Usuario.query().where('uuid_usuario', UUID).firstOrFail()
  }

  test('en producción la cookie lleva Secure', async ({ assert }) => {
    const usuario = await sembrarUsuario()
    const { ctx, cookies } = ctxDeCookies()

    await new SesionSsoService().crear(ctx, {
      idUsuario: usuario.id,
      uuidUsuario: usuario.uuidUsuario,
      metodoLogin: 'password',
    })

    const opciones = cookies.get('sso_session')?.opciones
    assert.isTrue(opciones?.secure)
  })

  test('en desarrollo la cookie NO lleva Secure, para sobrevivir a HTTP', async ({ assert }) => {
    const restaurar = forzarInDev(true)
    try {
      const usuario = await sembrarUsuario()
      const { ctx, cookies } = ctxDeCookies()

      await new SesionSsoService().crear(ctx, {
        idUsuario: usuario.id,
        uuidUsuario: usuario.uuidUsuario,
        metodoLogin: 'password',
      })

      /**
       * Este es exactamente el bug del F5 local: con `Secure` fijo, el
       * navegador descarta la cookie sobre `http://sgeb.local.test:3333` y
       * `/authorize?...&prompt=none` nunca la recibe de vuelta.
       */
      const opciones = cookies.get('sso_session')?.opciones
      assert.isFalse(opciones?.secure)
    } finally {
      restaurar()
    }
  })

  test('httpOnly, sameSite, path y maxAge no cambian entre entornos', async ({ assert }) => {
    const usuario = await sembrarUsuario()

    const enProduccion = ctxDeCookies()
    await new SesionSsoService().crear(enProduccion.ctx, {
      idUsuario: usuario.id,
      uuidUsuario: usuario.uuidUsuario,
      metodoLogin: 'password',
    })
    const opcionesProduccion = enProduccion.cookies.get('sso_session')?.opciones

    const restaurar = forzarInDev(true)
    let opcionesDesarrollo: Partial<CookieOptions> | undefined
    try {
      const enDesarrollo = ctxDeCookies()
      await new SesionSsoService().crear(enDesarrollo.ctx, {
        idUsuario: usuario.id,
        uuidUsuario: usuario.uuidUsuario,
        metodoLogin: 'password',
      })
      opcionesDesarrollo = enDesarrollo.cookies.get('sso_session')?.opciones
    } finally {
      restaurar()
    }

    for (const opciones of [opcionesProduccion, opcionesDesarrollo]) {
      assert.isTrue(opciones?.httpOnly)
      assert.equal(opciones?.sameSite, 'lax')
      assert.equal(opciones?.path, '/')
      assert.equal(opciones?.maxAge, 12 * 60 * 60)
    }
  })

  test('la sesión creada se reconoce al presentar la misma cookie después', async ({ assert }) => {
    const usuario = await sembrarUsuario()
    const { ctx } = ctxDeCookies()
    const servicio = new SesionSsoService()

    const sid = await servicio.crear(ctx, {
      idUsuario: usuario.id,
      uuidUsuario: usuario.uuidUsuario,
      metodoLogin: 'password_2fa',
    })

    /**
     * Simula el F5: la misma cookie del navegador viaja en la siguiente
     * petición a `/authorize?...&prompt=none`.
     */
    const sesion = await servicio.vigente(ctx)

    assert.isNotNull(sesion)
    assert.equal(sesion?.sid, sid)
    assert.equal(sesion?.idUsuario, usuario.id)
    assert.equal(sesion?.uuidUsuario, usuario.uuidUsuario)
    assert.equal(sesion?.metodoLogin, 'password_2fa')
  })

  test('sin cookie no hay sesión: primer login, no un error', async ({ assert }) => {
    const { ctx } = ctxDeCookies()
    const sesion = await new SesionSsoService().vigente(ctx)
    assert.isNull(sesion)
  })
})
