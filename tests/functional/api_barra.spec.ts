import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { LlaveFirmaService } from '#modules/identidad/services/llave_firma_service'
import { TokenService } from '#modules/identidad/services/token_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import Usuario from '#modules/identidad/models/usuario'
import Salon from '#modules/eventos/models/salon'

/**
 * El flujo de barra por HTTP real: dar de alta el menú, configurar los pines,
 * levantar una orden y dispensarla.
 */

const UUID_CAP = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const UUID_MESERO = 'aa2a9c14-8b7e-4d61-9a03-2c5e77b1d841'

async function crearUsuario(uuid: string, idRol: number, correo: string): Promise<Usuario> {
  await db.table('usuario').insert({
    uuid_usuario: uuid,
    id_rol: idRol,
    nombre: 'Test',
    apellido_paterno: 'Usuario',
    correo,
    password_hash: 'x'.repeat(60),
  })
  return Usuario.query().where('uuid_usuario', uuid).preload('rol').firstOrFail()
}

async function token(u: Usuario): Promise<string> {
  const tokens = await app.container.make(TokenService)
  const r = await tokens.emitir({
    usuario: u,
    rol: u.rol.nombre,
    cliente: u.rol.nombre === 'mesero' ? 'movil' : 'web',
    metodoLogin: 'password_2fa',
    scope: 'openid perfil sgeb.api',
    sid: 'sid-prueba',
  })
  return r.access_token
}

test.group('API de barra', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

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
        cupoMeseros: 10, numMesas: 20, tarifaPorMesero: 850, radioGeocercaM: 150,
      },
      UUID_CAP
    )
    const mesa = await eventos.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
    await eventos.cambiarEstado(e.id, 'publicado')

    const part = await app.container.make(ParticipacionService)
    const p = await part.apartar(e.id, UUID_MESERO)
    await eventos.cambiarEstado(e.id, 'en_curso')

    return {
      evento: e, mesa, participacion: p,
      tCap: await token(cap), tMesero: await token(mesero),
    }
  }

  test('el mesero no administra el catálogo', async ({ client, assert }) => {
    const { tMesero } = await escenario()
    const r = await client
      .post('/v1/insumos')
      .bearerToken(tMesero)
      .json({ nombre: 'Ron', tipo: 'alcohol', unidad: 'ml', costo: 250 })

    r.assertStatus(403)
    assert.equal(r.body().result.code, 'SGEB-1004')
  })

  test('el mesero SÍ consulta el menú: lo necesita en la mesa', async ({ client, assert }) => {
    const { tMesero } = await escenario()
    const r = await client.get('/v1/bebidas').bearerToken(tMesero)

    r.assertStatus(200)
    assert.equal(r.body().result.code, 'SGEB-0002')
  })

  test('flujo completo de barra: menú, pines, orden y dispensado', async ({ client, assert }) => {
    const { evento, mesa, participacion, tCap, tMesero } = await escenario()

    // ── 1. El capitán da de alta el menú
    const ron = await client
      .post('/v1/insumos')
      .bearerToken(tCap)
      .json({ nombre: 'Ron Blanco', tipo: 'alcohol', unidad: 'ml', costo: 250 })
    ron.assertStatus(201)

    const cola = await client
      .post('/v1/insumos')
      .bearerToken(tCap)
      .json({ nombre: 'Refresco Cola', tipo: 'refresco', unidad: 'ml', costo: 30 })

    const cuba = await client
      .post('/v1/bebidas')
      .bearerToken(tCap)
      .json({ nombre: 'Cuba Libre', alcoholica: true })

    const receta = await client
      .put(`/v1/bebidas/${cuba.body().data.id_bebida}/receta`)
      .bearerToken(tCap)
      .json({
        ingredientes: [
          { idInsumo: ron.body().data.id_insumo, tipoPorcion: 'FIJO_ML', valor: 45, ordenServido: 1 },
          { idInsumo: cola.body().data.id_insumo, tipoPorcion: 'RESTO', valor: 0, ordenServido: 2 },
        ],
      })
    receta.assertStatus(200)

    const vaso = await client
      .post('/v1/envases')
      .bearerToken(tCap)
      .json({ nombre: 'Vaso Normal', volumenMl: 350 })

    // ── 2. Registra el Cubaitor y calibra los pines
    const disp = await client
      .post('/v1/cubaitors')
      .bearerToken(tCap)
      .json({ nombre: 'Barra 1', mac: 'aa:bb:cc:dd:ee:ff', numPins: 8 })
    disp.assertStatus(201)
    /** La MAC se normaliza a mayúsculas: es la llave única del dispositivo. */
    assert.equal(disp.body().data.mac, 'AA:BB:CC:DD:EE:FF')

    for (const [insumo, pin, caudal, vol] of [
      [ron.body().data.id_insumo, 12, 15.5, 1000],
      [cola.body().data.id_insumo, 13, 25, 5000],
    ] as const) {
      const c = await client
        .post(`/v1/eventos/${evento.id}/config-dispensado`)
        .bearerToken(tCap)
        .json({ idCubaitor: disp.body().data.id_cubaitor, idInsumo: insumo, pinGpio: pin, caudalMlSeg: caudal, volumenCargadoMl: vol })
      c.assertStatus(201)
    }

    /** SGEB-4019: dos insumos no comparten pin. */
    const colision = await client
      .post(`/v1/eventos/${evento.id}/config-dispensado`)
      .bearerToken(tCap)
      .json({ idCubaitor: disp.body().data.id_cubaitor, idInsumo: cola.body().data.id_insumo, pinGpio: 12, caudalMlSeg: 20, volumenCargadoMl: 900 })
    assert.equal(colision.body().result.code, 'SGEB-4019')

    // ── 3. El mesero levanta la orden
    const orden = await client
      .post(`/v1/mesas/${mesa.id}/ordenes`)
      .bearerToken(tMesero)
      .json({
        idParticipacion: participacion.id,
        lineas: [{ idBebida: cuba.body().data.id_bebida, idEnvase: vaso.body().data.id_envase, cantidad: 1 }],
      })

    orden.assertStatus(201)
    assert.equal(orden.body().data.estado, 'pendiente')
    assert.equal(orden.body().data.detalles[0].volumen_total_ml, 350)

    // ── 4. La barra dispensa
    const idDetalle = orden.body().data.detalles[0].id_detalle
    const d = await client.post(`/v1/orden-detalles/${idDetalle}/dispensar`).bearerToken(tCap)

    d.assertStatus(201)
    const instr = d.body().data.instrucciones
    assert.lengthOf(instr, 2)
    /** Ron primero: el vaso lleva hielo. */
    assert.equal(instr[0].pin_gpio, 12)
    assert.equal(instr[0].volumen_ml, 45)
    assert.equal(instr[0].segundos, 2.9)

    // ── 5. El Cubaitor reporta
    const rep = await client
      .patch(`/v1/dispensados/${instr[0].id_dispensado}/reporte`)
      .bearerToken(tCap)
      .json({ segundosReal: 2.9 })
    rep.assertStatus(200)
    assert.equal(rep.body().data.estado, 'ok')

    // ── 6. Se entrega
    const entregada = await client
      .patch(`/v1/ordenes/${orden.body().data.id_orden}/estado`)
      .bearerToken(tCap)
      .json({ estado: 'entregada' })
    assert.equal(entregada.body().data.estado, 'entregada')
  })

  test('botella vacía: la orden se pausa y la recarga la reanuda', async ({ client, assert }) => {
    const { evento, mesa, participacion, tCap, tMesero } = await escenario()

    const ron = await client.post('/v1/insumos').bearerToken(tCap).json({ nombre: 'Ron', tipo: 'alcohol', unidad: 'ml', costo: 250 })
    const cuba = await client.post('/v1/bebidas').bearerToken(tCap).json({ nombre: 'Derecho', alcoholica: true })
    await client.put(`/v1/bebidas/${cuba.body().data.id_bebida}/receta`).bearerToken(tCap).json({
      ingredientes: [{ idInsumo: ron.body().data.id_insumo, tipoPorcion: 'FIJO_ML', valor: 45, ordenServido: 1 }],
    })
    const vaso = await client.post('/v1/envases').bearerToken(tCap).json({ nombre: 'Caballito', volumenMl: 60 })
    const disp = await client.post('/v1/cubaitors').bearerToken(tCap).json({ nombre: 'Barra 1', mac: 'aa:bb:cc:dd:ee:01', numPins: 8 })

    /** Solo 30 ml cargados: no alcanzan para los 45 del trago. */
    const cfg = await client
      .post(`/v1/eventos/${evento.id}/config-dispensado`)
      .bearerToken(tCap)
      .json({ idCubaitor: disp.body().data.id_cubaitor, idInsumo: ron.body().data.id_insumo, pinGpio: 12, caudalMlSeg: 15.5, volumenCargadoMl: 30 })

    const orden = await client.post(`/v1/mesas/${mesa.id}/ordenes`).bearerToken(tMesero).json({ idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.body().data.id_bebida, idEnvase: vaso.body().data.id_envase, cantidad: 1 }],
    })
    const idDetalle = orden.body().data.detalles[0].id_detalle

    const fallo = await client.post(`/v1/orden-detalles/${idDetalle}/dispensar`).bearerToken(tCap)
    fallo.assertStatus(409)
    assert.equal(fallo.body().result.code, 'SGEB-4009')

    /**
     * La pausa sobrevive al error. Si no, la orden quedaría en 'pendiente', el
     * mesero reintentaría y el capitán nunca sabría que hay una botella vacía.
     */
    const pausada = await client.get(`/v1/ordenes/${orden.body().data.id_orden}`).bearerToken(tCap)
    assert.equal(pausada.body().data.estado, 'pausada_por_insumo')

    /** Nada se sirvió: la válvula no llegó a abrirse. */
    assert.lengthOf(await db.from('dispensado'), 0)

    // ── El capitán cambia la botella
    const recarga = await client
      .patch(`/v1/eventos/${evento.id}/config-dispensado/${cfg.body().data.id_config}/recarga`)
      .bearerToken(tCap)
      .json({ volumenCargadoMl: 1000 })

    recarga.assertStatus(200)
    assert.equal(recarga.body().data.detalles_reanudados, 1)

    const reanudada = await client.get(`/v1/ordenes/${orden.body().data.id_orden}`).bearerToken(tCap)
    assert.equal(reanudada.body().data.estado, 'pendiente')

    const ok = await client.post(`/v1/orden-detalles/${idDetalle}/dispensar`).bearerToken(tCap)
    ok.assertStatus(201)
  })

  test('el semáforo del Cubaitor responde 200 aunque esté caído', async ({ client, assert }) => {
    const { tCap } = await escenario()
    const disp = await client
      .post('/v1/cubaitors')
      .bearerToken(tCap)
      .json({ nombre: 'Barra 1', mac: 'aa:bb:cc:dd:ee:02', numPins: 8 })

    const r = await client.get(`/v1/cubaitors/${disp.body().data.id_cubaitor}/estado`).bearerToken(tCap)

    /**
     * No es un error de la petición, es información: el evento continúa con
     * dispensado manual (RNF-13). Un 503 haría que el frontend pintara una
     * alerta de fallo cuando lo que hay es una barra trabajando a mano.
     */
    r.assertStatus(200)
    assert.isFalse(r.body().data.en_linea)
  })

  test('marcar un insumo agotado devuelve cuántas órdenes se pausaron', async ({
    client,
    assert,
  }) => {
    const { evento, mesa, participacion, tCap, tMesero } = await escenario()

    const ron = await client.post('/v1/insumos').bearerToken(tCap).json({ nombre: 'Ron', tipo: 'alcohol', unidad: 'ml', costo: 250 })
    const cuba = await client.post('/v1/bebidas').bearerToken(tCap).json({ nombre: 'Derecho', alcoholica: true })
    await client.put(`/v1/bebidas/${cuba.body().data.id_bebida}/receta`).bearerToken(tCap).json({
      ingredientes: [{ idInsumo: ron.body().data.id_insumo, tipoPorcion: 'FIJO_ML', valor: 45, ordenServido: 1 }],
    })
    const vaso = await client.post('/v1/envases').bearerToken(tCap).json({ nombre: 'Caballito', volumenMl: 60 })
    const disp = await client.post('/v1/cubaitors').bearerToken(tCap).json({ nombre: 'Barra 1', mac: 'aa:bb:cc:dd:ee:03', numPins: 8 })
    await client.post(`/v1/eventos/${evento.id}/config-dispensado`).bearerToken(tCap).json({
      idCubaitor: disp.body().data.id_cubaitor, idInsumo: ron.body().data.id_insumo,
      pinGpio: 12, caudalMlSeg: 15.5, volumenCargadoMl: 1000,
    })

    await client.post(`/v1/mesas/${mesa.id}/ordenes`).bearerToken(tMesero).json({ idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.body().data.id_bebida, idEnvase: vaso.body().data.id_envase, cantidad: 1 }],
    })

    const r = await client
      .patch(`/v1/insumos/${ron.body().data.id_insumo}/estado`)
      .bearerToken(tCap)
      .json({ estado: 'agotado' })

    /** El capitán necesita saber el alcance de inmediato, no descubrirlo mesa por mesa. */
    r.assertStatus(200)
    assert.equal(r.body().data.ordenes_pausadas, 1)
  })

  test('SGEB-4016: no se desactiva un insumo que está en una receta activa', async ({
    client,
    assert,
  }) => {
    const { tCap } = await escenario()
    const ron = await client.post('/v1/insumos').bearerToken(tCap).json({ nombre: 'Ron', tipo: 'alcohol', unidad: 'ml', costo: 250 })
    const cuba = await client.post('/v1/bebidas').bearerToken(tCap).json({ nombre: 'Cuba', alcoholica: true })
    await client.put(`/v1/bebidas/${cuba.body().data.id_bebida}/receta`).bearerToken(tCap).json({
      ingredientes: [{ idInsumo: ron.body().data.id_insumo, tipoPorcion: 'FIJO_ML', valor: 45, ordenServido: 1 }],
    })

    const r = await client.delete(`/v1/insumos/${ron.body().data.id_insumo}`).bearerToken(tCap)
    r.assertStatus(409)
    assert.equal(r.body().result.code, 'SGEB-4016')
    /** El envelope ofrece la alternativa, no solo el rechazo. */
    assert.equal(r.body().data.alternativa, 'desactivar')
  })

  test('la MAC debe tener formato de seis octetos', async ({ client, assert }) => {
    const { tCap } = await escenario()
    const r = await client
      .post('/v1/cubaitors')
      .bearerToken(tCap)
      .json({ nombre: 'Barra', mac: 'no-es-una-mac', numPins: 8 })

    assert.equal(r.body().result.code, 'SGEB-2002')
  })

  test('el pin GPIO se valida contra el rango del ESP32', async ({ client, assert }) => {
    const { evento, tCap } = await escenario()
    const disp = await client.post('/v1/cubaitors').bearerToken(tCap).json({ nombre: 'Barra 1', mac: 'aa:bb:cc:dd:ee:04', numPins: 8 })
    const ron = await client.post('/v1/insumos').bearerToken(tCap).json({ nombre: 'Ron', tipo: 'alcohol', unidad: 'ml', costo: 250 })

    const r = await client
      .post(`/v1/eventos/${evento.id}/config-dispensado`)
      .bearerToken(tCap)
      .json({ idCubaitor: disp.body().data.id_cubaitor, idInsumo: ron.body().data.id_insumo, pinGpio: 99, caudalMlSeg: 15, volumenCargadoMl: 1000 })

    assert.equal(r.body().result.code, 'SGEB-2012')
  })
})
