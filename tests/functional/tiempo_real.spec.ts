import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { io as clienteIo, type Socket } from 'socket.io-client'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import server from '@adonisjs/core/services/server'
import testUtils from '@adonisjs/core/services/test_utils'
import { LlaveFirmaService } from '#modules/identidad/services/llave_firma_service'
import { TokenService } from '#modules/identidad/services/token_service'
import { TiempoRealService } from '#shared/services/tiempo_real_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import Usuario from '#modules/identidad/models/usuario'
import Salon from '#modules/eventos/models/salon'
import env from '#start/env'

/**
 * El canal de tiempo real contra un servidor real y sockets reales.
 *
 * Es la única forma de verificar lo que importa: que un token inválido no entre,
 * que un mesero no pueda espiar la sala de otro evento, y que un cambio de
 * estado llegue de verdad al cliente.
 */

const UUID_CAP = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const UUID_MESERO = 'aa2a9c14-8b7e-4d61-9a03-2c5e77b1d841'
const UUID_AJENO = 'bb2a9c14-8b7e-4d61-9a03-2c5e77b1d842'

async function crearUsuario(uuid: string, idRol: number, correo: string): Promise<Usuario> {
  await db.table('usuario').insert({
    uuid_usuario: uuid, id_rol: idRol, nombre: 'Test', apellido_paterno: 'U',
    correo, password_hash: 'x'.repeat(60),
  })
  return Usuario.query().where('uuid_usuario', uuid).preload('rol').firstOrFail()
}

async function token(u: Usuario): Promise<string> {
  const tokens = await app.container.make(TokenService)
  const r = await tokens.emitir({
    usuario: u, rol: u.rol.nombre,
    cliente: u.rol.nombre === 'mesero' ? 'movil' : 'web',
    metodoLogin: 'password_2fa', scope: 'openid perfil sgeb.api', sid: 'sid-prueba',
  })
  return r.access_token
}

/** Conecta un cliente y espera al handshake o al rechazo. */
function conectar(url: string, jwt: string | null): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = clienteIo(url, {
      auth: jwt ? { token: jwt } : {},
      transports: ['websocket'],
      reconnection: false,
      timeout: 4000,
    })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e) => { s.close(); reject(e) })
  })
}

/**
 * Espera un evento concreto, con tope de tiempo para no colgar la suite.
 *
 * Acepta un predicado porque los eventos se emiten DESPUÉS de que la
 * transacción confirma, y por tanto de forma asíncrona: un cambio anterior
 * puede llegar justo cuando el listener se registra. Filtrar por contenido es
 * más fiable que confiar en el orden de llegada, y refleja lo que tendrá que
 * hacer el cliente real.
 */
function esperar<T>(
  s: Socket,
  nombre: string,
  predicado: (c: T) => boolean = () => true,
  ms = 4000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Sin '${nombre}' en ${ms} ms`)), ms)
    const handler = (carga: T) => {
      if (!predicado(carga)) return
      clearTimeout(t)
      s.off(nombre, handler)
      resolve(carga)
    }
    s.on(nombre, handler)
  })
}

function unirse(s: Socket, idEvento: number): Promise<{ ok: boolean; code?: string }> {
  return new Promise((resolve) => s.emit('unirse:evento', idEvento, resolve))
}

test.group('Canal de tiempo real', (group) => {
  let url: string
  const abiertos: Socket[] = []

  /**
   * El servidor HTTP ya lo levanta `configureSuite` en tests/bootstrap.ts para
   * toda la suite funcional; arrancarlo aquí de nuevo da EADDRINUSE. Solo hay
   * que montar el canal sobre el servidor que ya existe.
   */
  group.setup(async () => {
    const tiempoReal = await app.container.make(TiempoRealService)
    const nodeServer = server.getNodeServer()
    if (nodeServer) tiempoReal.montar(nodeServer)
    url = `http://${env.get('HOST')}:${env.get('PORT')}`
  })

  group.each.setup(() => testUtils.db().withGlobalTransaction())

  group.each.teardown(() => {
    abiertos.splice(0).forEach((s) => s.close())
  })

  function seguir(s: Socket): Socket {
    abiertos.push(s)
    return s
  }

  async function escenario() {
    await new LlaveFirmaService().rotar()
    const cap = await crearUsuario(UUID_CAP, 2, 'cap@x.mx')
    const mesero = await crearUsuario(UUID_MESERO, 3, 'mesero@x.mx')

    const sa = await Salon.create({
      nombre: 'Salon Galeana', calle: 'Av Morelos', cp: '27000', colonia: 'Centro',
      ciudad: 'Torreon', estado: 'Coahuila', latitud: 25.54389, longitud: -103.40632,
      capacidadMaxMesas: 50, capacidadPersonas: 400, activo: true,
    })

    const eventos = await app.container.make(EventoService)
    const fecha = DateTime.now().plus({ days: 1 }).toISODate()!
    const e = await eventos.crear(
      {
        idSalon: sa.id, uuidCapitan: UUID_CAP, titulo: 'XV', tipo: 'social',
        fecha, horaPresentacion: '17:00', inicio: `${fecha}T19:00:00`,
        cupoMeseros: 3, numMesas: 20, tarifaPorMesero: 850, radioGeocercaM: 150,
      },
      UUID_CAP
    )
    const mesa = await eventos.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
    await eventos.cambiarEstado(e.id, 'publicado')

    return {
      evento: e, mesa, cap, mesero,
      tCap: await token(cap), tMesero: await token(mesero),
      part: await app.container.make(ParticipacionService),
    }
  }

  // ══════════════════════════════════════════════════════ autenticación

  test('un socket sin token se rechaza en el handshake', async ({ assert }) => {
    await escenario()
    try {
      seguir(await conectar(url, null))
      assert.fail('debió rechazarse')
    } catch (e) {
      /** El mensaje es genérico a propósito: el detalle va al log del servidor. */
      assert.equal((e as Error).message, 'SGEB-1003')
    }
  })

  test('un token con firma inválida se rechaza', async ({ assert }) => {
    await escenario()
    try {
      seguir(await conectar(url, 'no.es.un.jwt'))
      assert.fail('debió rechazarse')
    } catch (e) {
      assert.equal((e as Error).message, 'SGEB-1003')
    }
  })

  test('un token válido conecta', async ({ assert }) => {
    const { tCap } = await escenario()
    const s = seguir(await conectar(url, tCap))
    assert.isTrue(s.connected)
  })

  // ══════════════════════════════════════════════════════ salas

  test('el capitán entra a la sala de SU evento', async ({ assert }) => {
    const { evento, tCap } = await escenario()
    const s = seguir(await conectar(url, tCap))

    const r = await unirse(s, evento.id)
    assert.isTrue(r.ok)
  })

  test('un capitán ajeno NO entra a la sala de otro evento', async ({ assert }) => {
    const { evento } = await escenario()
    const otro = await crearUsuario(UUID_AJENO, 2, 'otro@x.mx')
    const s = seguir(await conectar(url, await token(otro)))

    /**
     * Sin esta comprobación, cualquiera con un token válido vería la operación
     * completa de un salón donde no trabaja: mesas, meseros, órdenes y alertas.
     */
    const r = await unirse(s, evento.id)
    assert.isFalse(r.ok)
    assert.equal(r.code, 'SGEB-1004')
  })

  test('un mesero sin participación NO entra; con participación sí', async ({ assert }) => {
    const { evento, tMesero, part } = await escenario()
    const s = seguir(await conectar(url, tMesero))

    const antes = await unirse(s, evento.id)
    assert.isFalse(antes.ok)

    await part.apartar(evento.id, UUID_MESERO)

    const despues = await unirse(s, evento.id)
    assert.isTrue(despues.ok)
  })

  // ══════════════════════════════════════════════════════ emisión

  test('apartar un lugar anuncia el cupo a la sala', async ({ assert }) => {
    const { evento, tCap, part } = await escenario()
    const s = seguir(await conectar(url, tCap))
    await unirse(s, evento.id)

    const espera = esperar<{ cupoMeseros: number; ocupados: number; disponibles: number }>(
      s,
      'cupo:actualizado'
    )
    await part.apartar(evento.id, UUID_MESERO)
    const carga = await espera

    /**
     * Es lo que evita que diez meseros peleen por dos lugares y ocho se enteren
     * hasta recibir SGEB-4002.
     */
    assert.equal(carga.cupoMeseros, 3)
    assert.equal(carga.ocupados, 1)
    assert.equal(carga.disponibles, 2)
  })

  test('el cambio de estado del mesero llega al panel del capitán', async ({ assert }) => {
    const { evento, tCap, part } = await escenario()
    const s = seguir(await conectar(url, tCap))
    await unirse(s, evento.id)

    const p = await part.apartar(evento.id, UUID_MESERO)
    const espera = esperar<{ idParticipacion: number; estado: string }>(
      s,
      'participacion:cambio',
      (c) => c.estado === 'seleccionado'
    )
    await part.cambiarEstado(p.id, 'seleccionado')
    const carga = await espera

    assert.equal(carga.idParticipacion, p.id)
    assert.equal(carga.estado, 'seleccionado')
  })

  test('vincular una mesa anuncia el cambio de piso', async ({ assert }) => {
    const { evento, mesa, tCap, part } = await escenario()
    const s = seguir(await conectar(url, tCap))
    await unirse(s, evento.id)

    const p = await part.apartar(evento.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', p.id).update({ checklist_ok: true, estado: 'confirmo_llegada' })

    /**
     * Asignar TAMBIÉN anuncia. Antes no emitía nada, así que el panel de otro
     * capitán no se enteraba de la asignación hasta recargar; lo reportó el
     * equipo de frontend reproduciéndolo con dos pestañas.
     */
    const esperaAsignar = esperar<{ idMesa: number; estado: string; vinculada: boolean }>(s, 'mesa:cambio')
    const a = await part.asignarMesa(p.id, mesa.id)
    const alAsignar = await esperaAsignar

    assert.equal(alAsignar.idMesa, mesa.id)
    assert.isFalse(alAsignar.vinculada)
    /** Sigue `libre`: nadie ha llegado físicamente a la mesa todavía. */
    assert.equal(alAsignar.estado, 'libre')

    const espera = esperar<{ idMesa: number; estado: string; vinculada: boolean }>(s, 'mesa:cambio')
    await part.vincularMesa(a.id, mesa.codigoQr, UUID_MESERO)
    const carga = await espera

    assert.equal(carga.idMesa, mesa.id)
    assert.equal(carga.estado, 'ocupada')
    assert.isTrue(carga.vinculada)
  })

  test('los eventos NO se filtran a otra sala', async ({ assert }) => {
    const { evento, tCap, part } = await escenario()

    /** Un segundo evento del mismo capitán, con su propia sala. */
    const eventos = await app.container.make(EventoService)
    const sa = await Salon.query().firstOrFail()
    const fecha = DateTime.now().plus({ days: 5 }).toISODate()!
    const otro = await eventos.crear(
      {
        idSalon: sa.id, uuidCapitan: UUID_CAP, titulo: 'Boda', tipo: 'social',
        fecha, horaPresentacion: '16:00', inicio: `${fecha}T18:00:00`,
        cupoMeseros: 5, numMesas: 10, tarifaPorMesero: 900, radioGeocercaM: 150,
      },
      UUID_CAP
    )

    const s = seguir(await conectar(url, tCap))
    await unirse(s, otro.id)

    let recibido = false
    s.on('cupo:actualizado', () => { recibido = true })

    /** El cambio ocurre en el PRIMER evento; este socket está en la sala del segundo. */
    await part.apartar(evento.id, UUID_MESERO)
    await new Promise((r) => setTimeout(r, 600))

    assert.isFalse(recibido)
  })

  test('toda carga lleva emitido_en, inyectado por el puente', async ({ assert }) => {
    const { evento, tCap, part } = await escenario()
    const s = seguir(await conectar(url, tCap))
    await unirse(s, evento.id)

    const espera = esperar<{ emitido_en: string }>(s, 'cupo:actualizado')
    await part.apartar(evento.id, UUID_MESERO)
    const carga = await espera

    /**
     * Lo pone el puente y no cada servicio: así ningún emisor puede olvidarlo y
     * todas las cargas usan el mismo reloj.
     */
    assert.isString(carga.emitido_en)
    assert.isFalse(Number.isNaN(Date.parse(carga.emitido_en)))
    /** Reloj del servidor: la marca no puede venir del futuro. */
    assert.isAtMost(Date.parse(carga.emitido_en), Date.now() + 1000)
  })

  test('salir de la sala deja de recibir', async ({ assert }) => {
    const { evento, tCap, part } = await escenario()
    const s = seguir(await conectar(url, tCap))
    await unirse(s, evento.id)

    s.emit('salir:evento', evento.id)
    await new Promise((r) => setTimeout(r, 300))

    let recibido = false
    s.on('cupo:actualizado', () => { recibido = true })
    await part.apartar(evento.id, UUID_MESERO)
    await new Promise((r) => setTimeout(r, 600))

    assert.isFalse(recibido)
  })

  test('el canal solo empuja: no acepta comandos de negocio', async ({ assert }) => {
    const { evento, tCap } = await escenario()
    const s = seguir(await conectar(url, tCap))
    await unirse(s, evento.id)

    /**
     * Apartar, dispensar o aprobar se hacen por REST, que ya tiene validación,
     * autorización y envelope. Duplicar esa lógica sobre sockets significaría
     * mantener dos caminos con dos conjuntos de reglas.
     */
    s.emit('apartar:lugar', { idEvento: evento.id })
    await new Promise((r) => setTimeout(r, 400))

    const filas = await db.from('participacion_evento').where('id_evento', evento.id)
    assert.lengthOf(filas, 0)
    assert.isTrue(s.connected)
  })
})
