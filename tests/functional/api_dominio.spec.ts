import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { LlaveFirmaService } from '#modules/identidad/services/llave_firma_service'
import { TokenService } from '#modules/identidad/services/token_service'
import Usuario from '#modules/identidad/models/usuario'
import Salon from '#modules/eventos/models/salon'

/**
 * Recorrido del API de dominio por HTTP real, con tokens firmados de verdad.
 *
 * Es donde aparecen los fallos que las pruebas de servicio no pueden ver: una
 * ruta mal registrada, un middleware en el orden equivocado, un campo con otro
 * nombre en el validador, un rol que autoriza de más.
 */

const UUID_CAP = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const UUID_MESERO = 'aa2a9c14-8b7e-4d61-9a03-2c5e77b1d841'
const UUID_CAP2 = 'cc2a9c14-8b7e-4d61-9a03-2c5e77b1d843'

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

/** Emite un access token real, firmado con la llave activa. */
async function token(usuario: Usuario): Promise<string> {
  const tokens = await app.container.make(TokenService)
  const r = await tokens.emitir({
    usuario,
    rol: usuario.rol.nombre,
    cliente: usuario.rol.nombre === 'mesero' ? 'movil' : 'web',
    metodoLogin: 'password_2fa',
    scope: 'openid perfil sgeb.api',
    sid: 'sid-prueba',
  })
  return r.access_token
}

async function salon(): Promise<Salon> {
  return Salon.create({
    nombre: 'Salon Galeana',
    calle: 'Av Morelos',
    cp: '27000',
    colonia: 'Centro',
    ciudad: 'Torreon',
    estado: 'Coahuila',
    latitud: 25.54389,
    longitud: -103.40632,
    capacidadMaxMesas: 50,
    capacidadPersonas: 400,
    activo: true,
  })
}

function cuerpoEvento(idSalon: number, extra: Record<string, unknown> = {}) {
  const fecha = DateTime.now().plus({ days: 30 }).toISODate()!
  return {
    idSalon,
    uuidCapitan: UUID_CAP,
    titulo: 'XV de Maria',
    tipo: 'social',
    fecha,
    horaPresentacion: '17:00',
    inicio: `${fecha}T19:00:00`,
    cupoMeseros: 10,
    numMesas: 20,
    tarifaPorMesero: 850,
    radioGeocercaM: 150,
    ...extra,
  }
}

test.group('API de eventos', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function contexto() {
    await new LlaveFirmaService().rotar()
    const cap = await crearUsuario(UUID_CAP, 2, 'cap@x.mx')
    const mesero = await crearUsuario(UUID_MESERO, 3, 'mesero@x.mx')
    return {
      cap,
      mesero,
      tCap: await token(cap),
      tMesero: await token(mesero),
      sa: await salon(),
    }
  }

  test('sin token: SGEB-1003 con envelope', async ({ client, assert }) => {
    const r = await client.get('/v1/eventos')
    r.assertStatus(401)
    assert.equal(r.body().result.code, 'SGEB-1003')
    assert.isNull(r.body().data)
  })

  test('el mesero no puede crear eventos: SGEB-1004', async ({ client, assert }) => {
    const { tMesero, sa } = await contexto()
    const r = await client.post('/v1/eventos').bearerToken(tMesero).json(cuerpoEvento(sa.id))

    r.assertStatus(403)
    assert.equal(r.body().result.code, 'SGEB-1004')
  })

  test('el capitán crea un evento y recibe SGEB-0001', async ({ client, assert }) => {
    const { tCap, sa } = await contexto()
    const r = await client.post('/v1/eventos').bearerToken(tCap).json(cuerpoEvento(sa.id))

    r.assertStatus(201)
    assert.equal(r.body().result.code, 'SGEB-0001')
    assert.equal(r.body().data.estado, 'borrador')

    /** El entero de usuario no sale del backend, ni siquiera aquí. */
    assert.notProperty(r.body().data, 'id_capitan')
    assert.notProperty(r.body().data, 'idCapitan')
  })

  test('validación de VineJS: cada regla mapea a su código', async ({ client, assert }) => {
    const { tCap, sa } = await contexto()

    const falta = await client
      .post('/v1/eventos')
      .bearerToken(tCap)
      .json({ ...cuerpoEvento(sa.id), titulo: undefined })
    assert.equal(falta.body().result.code, 'SGEB-2001')

    const corto = await client
      .post('/v1/eventos')
      .bearerToken(tCap)
      .json({ ...cuerpoEvento(sa.id), titulo: 'ab' })
    assert.equal(corto.body().result.code, 'SGEB-2003')

    const enumerado = await client
      .post('/v1/eventos')
      .bearerToken(tCap)
      .json({ ...cuerpoEvento(sa.id), tipo: 'boda' })
    assert.equal(enumerado.body().result.code, 'SGEB-2004')

    /** Fuera del rango de negocio 10–1000 m. */
    const rango = await client
      .post('/v1/eventos')
      .bearerToken(tCap)
      .json({ ...cuerpoEvento(sa.id), radioGeocercaM: 5000 })
    assert.equal(rango.body().result.code, 'SGEB-2012')

    /** El frontend pinta el error bajo cada campo; por eso `data` los conserva. */
    assert.property(falta.body().data, 'errores_campos')
  })

  test('una lista vacía responde SGEB-0002, no SGEB-0000', async ({ client, assert }) => {
    const { tCap } = await contexto()
    const r = await client.get('/v1/eventos').bearerToken(tCap)

    /**
     * Ambos son éxito y ambos son HTTP 200, pero el frontend necesita
     * distinguirlos para pintar "no hay resultados" en vez de una tabla vacía
     * sin explicación.
     */
    r.assertStatus(200)
    assert.equal(r.body().result.code, 'SGEB-0002')
    assert.deepEqual(r.body().data, [])
  })

  test('el capitán solo ve sus propios eventos', async ({ client, assert }) => {
    const { tCap, sa } = await contexto()
    await client.post('/v1/eventos').bearerToken(tCap).json(cuerpoEvento(sa.id))

    const cap2 = await crearUsuario(UUID_CAP2, 2, 'cap2@x.mx')
    const r = await client.get('/v1/eventos').bearerToken(await token(cap2))

    assert.equal(r.body().result.code, 'SGEB-0002')
    assert.lengthOf(r.body().data, 0)
  })

  test('el ciclo completo del evento por HTTP', async ({ client, assert }) => {
    const { tCap, sa } = await contexto()

    const creado = await client.post('/v1/eventos').bearerToken(tCap).json(cuerpoEvento(sa.id))
    const id = creado.body().data.id_evento

    /** Publicar sin mesas se rechaza: sin QR no hay nada que escanear. */
    const sinMesas = await client
      .patch(`/v1/eventos/${id}/estado`)
      .bearerToken(tCap)
      .json({ estado: 'publicado' })
    assert.equal(sinMesas.body().result.code, 'SGEB-4013')

    const mesa = await client
      .post(`/v1/eventos/${id}/mesas`)
      .bearerToken(tCap)
      .json({ etiqueta: 'Mesa 1' })
    mesa.assertStatus(201)
    assert.match(mesa.body().data.codigo_qr, /^[0-9a-f-]{36}$/)

    const pub = await client
      .patch(`/v1/eventos/${id}/estado`)
      .bearerToken(tCap)
      .json({ estado: 'publicado' })
    assert.equal(pub.body().data.estado, 'publicado')

    /** Saltarse un estado responde SGEB-4011. */
    const salto = await client
      .patch(`/v1/eventos/${id}/estado`)
      .bearerToken(tCap)
      .json({ estado: 'finalizado' })
    assert.equal(salto.body().result.code, 'SGEB-4011')
  })

  test('la vista del comensal no requiere token y no filtra datos internos', async ({
    client,
    assert,
  }) => {
    const { tCap, sa } = await contexto()
    const creado = await client.post('/v1/eventos').bearerToken(tCap).json(cuerpoEvento(sa.id))
    const id = creado.body().data.id_evento

    const mesa = await client
      .post(`/v1/eventos/${id}/mesas`)
      .bearerToken(tCap)
      .json({ etiqueta: 'Mesa 1' })
    const qr = mesa.body().data.codigo_qr

    /** En borrador el evento aún no existe para el comensal. */
    const borrador = await client.get(`/v1/publico/mesas/${qr}`)
    assert.equal(borrador.body().result.code, 'SGEB-3003')

    await client.patch(`/v1/eventos/${id}/estado`).bearerToken(tCap).json({ estado: 'publicado' })

    const r = await client.get(`/v1/publico/mesas/${qr}`)
    r.assertStatus(200)
    assert.equal(r.body().data.etiqueta, 'Mesa 1')

    /**
     * Una vista sin autenticar no debe servir de puerta al resto del sistema:
     * nada de datos del mesero ni del salón.
     */
    assert.notProperty(r.body().data, 'id_salon')
    assert.notProperty(r.body().data.evento, 'id_capitan')
    assert.notProperty(r.body().data.evento, 'tarifa_por_mesero')
  })

  test('regenerar el QR invalida el anterior', async ({ client, assert }) => {
    const { tCap, sa } = await contexto()
    const creado = await client.post('/v1/eventos').bearerToken(tCap).json(cuerpoEvento(sa.id))
    const id = creado.body().data.id_evento
    const mesa = await client.post(`/v1/eventos/${id}/mesas`).bearerToken(tCap).json({ etiqueta: 'Mesa 1' })
    const idMesa = mesa.body().data.id_mesa
    const viejo = mesa.body().data.codigo_qr

    await client.patch(`/v1/eventos/${id}/estado`).bearerToken(tCap).json({ estado: 'publicado' })

    const r = await client.post(`/v1/eventos/${id}/mesas/${idMesa}/regenerar-qr`).bearerToken(tCap)
    r.assertStatus(200)
    assert.equal(r.body().data.codigo_qr_anterior, viejo)

    /** Quien tenga la vista abierta con el código viejo recibe SGEB-3003. */
    const conViejo = await client.get(`/v1/publico/mesas/${viejo}`)
    assert.equal(conViejo.body().result.code, 'SGEB-3003')

    const conNuevo = await client.get(`/v1/publico/mesas/${r.body().data.codigo_qr}`)
    conNuevo.assertStatus(200)
  })
})

test.group('API de participaciones', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function eventoPublicado() {
    await new LlaveFirmaService().rotar()
    const cap = await crearUsuario(UUID_CAP, 2, 'cap@x.mx')
    const mesero = await crearUsuario(UUID_MESERO, 3, 'mesero@x.mx')
    const tCap = await token(cap)
    const sa = await salon()

    const { EventoService } = await import('#modules/eventos/services/evento_service')
    const eventos = await app.container.make(EventoService)
    const e = await eventos.crear(
      {
        idSalon: sa.id,
        uuidCapitan: UUID_CAP,
        titulo: 'XV de Maria',
        tipo: 'social',
        fecha: DateTime.now().plus({ days: 30 }).toISODate()!,
        horaPresentacion: '17:00',
        inicio: `${DateTime.now().plus({ days: 30 }).toISODate()}T19:00:00`,
        cupoMeseros: 10,
        numMesas: 20,
        tarifaPorMesero: 850,
        radioGeocercaM: 150,
      },
      UUID_CAP
    )
    const mesa = await eventos.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
    await eventos.cambiarEstado(e.id, 'publicado')

    return { evento: e, mesa, tCap, tMesero: await token(mesero), mesero }
  }

  test('el mesero aparta su lugar; el capitán no usa esa ruta', async ({ client, assert }) => {
    const { evento, tCap, tMesero } = await eventoPublicado()

    /** El sujeto sale del token: la ruta es exclusiva del rol mesero. */
    const conCap = await client.post(`/v1/eventos/${evento.id}/participaciones`).bearerToken(tCap)
    assert.equal(conCap.body().result.code, 'SGEB-1004')

    const r = await client.post(`/v1/eventos/${evento.id}/participaciones`).bearerToken(tMesero)
    r.assertStatus(201)
    assert.equal(r.body().data.estado, 'aparto')

    /** El entero del usuario no viaja al cliente. */
    assert.notProperty(r.body().data, 'id_usuario')
  })

  test('apartar dos veces responde SGEB-4011', async ({ client, assert }) => {
    const { evento, tMesero } = await eventoPublicado()
    await client.post(`/v1/eventos/${evento.id}/participaciones`).bearerToken(tMesero)

    const r = await client.post(`/v1/eventos/${evento.id}/participaciones`).bearerToken(tMesero)
    assert.equal(r.body().result.code, 'SGEB-4011')
  })

  test('recorrido hasta la llegada, y el registro del intento fallido', async ({
    client,
    assert,
  }) => {
    const { evento, tCap, tMesero, mesero } = await eventoPublicado()

    const p = await client.post(`/v1/eventos/${evento.id}/participaciones`).bearerToken(tMesero)
    const idP = p.body().data.id_participacion

    for (const estado of ['seleccionado', 'confirmo_asistencia']) {
      const r = await client
        .patch(`/v1/participaciones/${idP}/estado`)
        .bearerToken(tCap)
        .json({ estado })
      r.assertStatus(200)
    }

    const uuidDisp = createHash('sha256').update('telefono-juan').digest('hex')
    await db.table('auth.dispositivo_confiable').insert({
      id_usuario: mesero.id,
      token_hash: uuidDisp,
      plataforma: 'ios',
      expira_en: DateTime.now().plus({ days: 30 }).toSQL(),
      activo: true,
    })

    const base = {
      metodo: 'face_id',
      biometricoVerificado: true,
      uuidDispositivo: uuidDisp,
      precisionM: 8,
    }

    // ── Lejos del salón: denegada, pero registrada
    const lejos = await client
      .post(`/v1/participaciones/${idP}/confirmacion-llegada`)
      .bearerToken(tMesero)
      .json({ ...base, latitud: 25.58, longitud: -103.44 })

    lejos.assertStatus(422)
    assert.equal(lejos.body().result.code, 'SGEB-4003')

    // ── En el salón: exitosa
    const ok = await client
      .post(`/v1/participaciones/${idP}/confirmacion-llegada`)
      .bearerToken(tMesero)
      .json({ ...base, latitud: 25.5439, longitud: -103.4063 })

    ok.assertStatus(201)
    assert.equal(ok.body().data.resultado, 'exitoso')
    assert.equal(ok.body().data.modelo_verificacion, 'atestacion_local')
    assert.isBelow(ok.body().data.distancia_m, 20)

    /** Los dos intentos quedan: son la evidencia para resolver una disputa. */
    const registros = await db.from('confirmacion_llegada').where('id_participacion', idP)
    assert.lengthOf(registros, 2)
    assert.deepEqual(registros.map((r) => r.resultado).sort(), ['exitoso', 'fallido'])
  })

  test('asignar y vincular una mesa por HTTP', async ({ client, assert }) => {
    const { evento, mesa, tCap, tMesero } = await eventoPublicado()

    const p = await client.post(`/v1/eventos/${evento.id}/participaciones`).bearerToken(tMesero)
    const idP = p.body().data.id_participacion
    await db.from('participacion_evento').where('id_participacion', idP).update({ checklist_ok: true, estado: 'confirmo_llegada' })

    const a = await client
      .post(`/v1/participaciones/${idP}/asignaciones`)
      .bearerToken(tCap)
      .json({ idMesa: mesa.id })
    a.assertStatus(201)
    const idA = a.body().data.id_asignacion

    /** Vincular es del mesero: es él quien está parado frente a la mesa. */
    const conCap = await client
      .patch(`/v1/asignaciones/${idA}/vincular`)
      .bearerToken(tCap)
      .json({ codigoQr: mesa.codigoQr })
    assert.equal(conCap.body().result.code, 'SGEB-1004')

    const v = await client
      .patch(`/v1/asignaciones/${idA}/vincular`)
      .bearerToken(tMesero)
      .json({ codigoQr: mesa.codigoQr })
    v.assertStatus(200)
    assert.isTrue(v.body().data.vinculada)
  })

  test('un token con firma de otra llave se rechaza', async ({ client, assert }) => {
    const { tMesero } = await eventoPublicado()

    /**
     * Se revoca la llave con la que se firmó: desaparece del JWKS y sus tokens
     * dejan de validar de inmediato. Es la diferencia entre "revocada" y
     * "retirada", que sí sigue publicándose.
     */
    await db.from('auth.llave_firma').update({ estado: 'revocada' })

    const r = await client.get('/v1/eventos').bearerToken(tMesero)
    r.assertStatus(401)
    assert.equal(r.body().result.code, 'SGEB-1003')
  })
})
