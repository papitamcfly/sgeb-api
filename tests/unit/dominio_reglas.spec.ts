import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { randomUUID, createHash } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'

import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import { LlegadaService } from '#modules/participaciones/services/llegada_service'
import Salon from '#modules/eventos/models/salon'
import ParticipacionEvento from '#modules/participaciones/models/participacion_evento'
import type { SgebError } from '#shared/errors/sgeb_error'

/** Salón Galeana, Torreón — las coordenadas reales del negocio. */
const SALON = { lat: 25.54389, lng: -103.40632 }

const UUID_CAP = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const UUID_MESERO = 'aa2a9c14-8b7e-4d61-9a03-2c5e77b1d841'

async function codigo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_FALLO'
  } catch (e) {
    return (e as SgebError).codigo ?? 'SIN_CODIGO'
  }
}

async function usuario(uuid: string, idRol: number, correo: string): Promise<number> {
  const [u] = await db.table('usuario').returning('id_usuario').insert({
    uuid_usuario: uuid,
    id_rol: idRol,
    nombre: 'Test',
    apellido_paterno: 'Usuario',
    correo,
    password_hash: 'x'.repeat(60),
  })
  return u.id_usuario
}

async function salon(capacidadMesas = 50): Promise<Salon> {
  return Salon.create({
    nombre: 'Salon Galeana',
    calle: 'Av Morelos',
    cp: '27000',
    colonia: 'Centro',
    ciudad: 'Torreon',
    estado: 'Coahuila',
    latitud: SALON.lat,
    longitud: SALON.lng,
    capacidadMaxMesas: capacidadMesas,
    capacidadPersonas: 400,
    activo: true,
  })
}

function datosEvento(idSalon: number, extra: Record<string, unknown> = {}) {
  const fecha = DateTime.now().plus({ days: 30 }).toISODate()!
  return {
    idSalon,
    uuidCapitan: UUID_CAP,
    titulo: 'XV de Maria',
    tipo: 'social' as const,
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

// ═══════════════════════════════════════════════════════════════════════════
test.group('Reglas del evento', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function servicio() {
    await usuario(UUID_CAP, 2, 'cap@x.mx')
    return app.container.make(EventoService)
  }

  test('crea un evento en borrador', async ({ assert }) => {
    const s = await servicio()
    const sa = await salon()
    const e = await s.crear(datosEvento(sa.id), UUID_CAP)

    assert.equal(e.estado, 'borrador')
    assert.equal(e.tarifaPorMesero, 850)
  })

  test('SGEB-4001: el salón no admite dos eventos vigentes el mismo día', async ({ assert }) => {
    const s = await servicio()
    const sa = await salon()
    const e = await s.crear(datosEvento(sa.id), UUID_CAP)

    /** En borrador todavía no ocupa el salón: sigue siendo un plan, no un compromiso. */
    assert.notEqual(await codigo(() => s.crear(datosEvento(sa.id), UUID_CAP)), 'SGEB-4001')

    await db.table('mesa').insert({ id_evento: e.id, etiqueta: 'M1', codigo_qr: randomUUID() })
    await s.cambiarEstado(e.id, 'publicado')

    assert.equal(await codigo(() => s.crear(datosEvento(sa.id), UUID_CAP)), 'SGEB-4001')
  })

  test('SGEB-4007: num_mesas no puede exceder la capacidad del salón', async ({ assert }) => {
    const s = await servicio()
    const sa = await salon(15)
    assert.equal(
      await codigo(() => s.crear(datosEvento(sa.id, { numMesas: 20 }), UUID_CAP)),
      'SGEB-4007'
    )
  })

  test('SGEB-2007: no se crean eventos con fecha pasada', async ({ assert }) => {
    const s = await servicio()
    const sa = await salon()
    const ayer = DateTime.now().minus({ days: 1 }).toISODate()!
    assert.equal(
      await codigo(() =>
        s.crear(datosEvento(sa.id, { fecha: ayer, inicio: `${ayer}T19:00:00` }), UUID_CAP)
      ),
      'SGEB-2007'
    )
  })

  test('SGEB-2008: inicio debe caer el mismo día que fecha', async ({ assert }) => {
    const s = await servicio()
    const sa = await salon()
    const fecha = DateTime.now().plus({ days: 30 }).toISODate()!
    const otroDia = DateTime.now().plus({ days: 31 }).toISODate()!

    /**
     * Si no coincidieran, el cronograma y la ventana de llegada se calcularían
     * contra días distintos y los meseros recibirían avisos el día equivocado.
     */
    assert.equal(
      await codigo(() => s.crear(datosEvento(sa.id, { fecha, inicio: `${otroDia}T19:00:00` }), UUID_CAP)),
      'SGEB-2008'
    )
  })

  test('SGEB-4023: el capitán debe tener el rol adecuado', async ({ assert }) => {
    const s = await servicio()
    await usuario(UUID_MESERO, 3, 'mesero@x.mx')
    const sa = await salon()

    assert.equal(
      await codigo(() => s.crear(datosEvento(sa.id, { uuidCapitan: UUID_MESERO }), UUID_CAP)),
      'SGEB-4023'
    )
    assert.equal(
      await codigo(() =>
        s.crear(datosEvento(sa.id, { uuidCapitan: '00000000-0000-4000-8000-000000000000' }), UUID_CAP)
      ),
      'SGEB-3002'
    )
  })

  test('SGEB-4011: la máquina de estados no admite saltos', async ({ assert }) => {
    const s = await servicio()
    const sa = await salon()
    const e = await s.crear(datosEvento(sa.id), UUID_CAP)

    assert.equal(await codigo(() => s.cambiarEstado(e.id, 'finalizado')), 'SGEB-4011')

    await db.table('mesa').insert({ id_evento: e.id, etiqueta: 'M1', codigo_qr: randomUUID() })
    await s.cambiarEstado(e.id, 'publicado')
    await s.cambiarEstado(e.id, 'en_curso')

    /** Un evento no termina antes de empezar; se simula que ya comenzó. */
    assert.equal(await codigo(() => s.cambiarEstado(e.id, 'finalizado')), 'SGEB-4013')
    await db
      .from('evento')
      .where('id_evento', e.id)
      .update({ inicio: DateTime.now().minus({ hours: 5 }).toSQL() })

    const fin = await s.cambiarEstado(e.id, 'finalizado')

    /** El servidor sella `fin`: de ese dato dependen la duración y los pagos. */
    assert.isNotNull(fin.fin)

    /** Finalizado es terminal. */
    assert.equal(await codigo(() => s.cambiarEstado(e.id, 'en_curso')), 'SGEB-4011')
  })

  test('publicar exige al menos una mesa', async ({ assert }) => {
    const s = await servicio()
    const sa = await salon()
    const e = await s.crear(datosEvento(sa.id), UUID_CAP)

    /** Sin mesas no hay QR que escanear ni nada que asignar. */
    assert.equal(await codigo(() => s.cambiarEstado(e.id, 'publicado')), 'SGEB-4013')
  })

  test('el radio de geocerca solo se edita en borrador', async ({ assert }) => {
    const s = await servicio()
    const sa = await salon()
    const e = await s.crear(datosEvento(sa.id), UUID_CAP)

    await s.actualizar(e.id, { radioGeocercaM: 200 })

    await db.table('mesa').insert({ id_evento: e.id, etiqueta: 'M1', codigo_qr: randomUUID() })
    await s.cambiarEstado(e.id, 'publicado')

    /** Cambiarlo después invalidaría asistencias ya confirmadas, y de ellas dependen pagos. */
    assert.equal(await codigo(() => s.actualizar(e.id, { radioGeocercaM: 400 })), 'SGEB-4013')
  })

  test('el QR de la mesa lo genera el servidor y se puede regenerar', async ({ assert }) => {
    const s = await servicio()
    const sa = await salon()
    const e = await s.crear(datosEvento(sa.id), UUID_CAP)

    const mesa = await s.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
    assert.match(mesa.codigoQr, /^[0-9a-f-]{36}$/)

    const { codigo_qr, codigo_qr_anterior } = await s.regenerarQr(e.id, mesa.id)
    assert.equal(codigo_qr_anterior, mesa.codigoQr)
    assert.notEqual(codigo_qr, mesa.codigoQr)

    await s.cambiarEstado(e.id, 'publicado')

    /** El código viejo deja de resolver: quien lo tenga abierto recibe SGEB-3003. */
    assert.equal(await codigo(() => s.porCodigoQr(codigo_qr_anterior)), 'SGEB-3003')
    const resuelta = await s.porCodigoQr(codigo_qr)
    assert.equal(resuelta.id, mesa.id)
  })

  test('el QR de un evento no vigente no resuelve', async ({ assert }) => {
    const s = await servicio()
    const sa = await salon()
    const e = await s.crear(datosEvento(sa.id), UUID_CAP)
    const mesa = await s.agregarMesa(e.id, { etiqueta: 'Mesa 1' })

    /** En borrador el evento aún no existe para el comensal. */
    assert.equal(await codigo(() => s.porCodigoQr(mesa.codigoQr)), 'SGEB-3003')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
test.group('Ciclo de vida del mesero', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function escenario(cupo = 10) {
    await usuario(UUID_CAP, 2, 'cap@x.mx')
    await usuario(UUID_MESERO, 3, 'mesero@x.mx')
    const sa = await salon()
    const eventos = await app.container.make(EventoService)
    const e = await eventos.crear(datosEvento(sa.id, { cupoMeseros: cupo }), UUID_CAP)
    await eventos.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
    await eventos.cambiarEstado(e.id, 'publicado')
    return { evento: e, part: await app.container.make(ParticipacionService), eventos }
  }

  test('el mesero aparta su lugar', async ({ assert }) => {
    const { evento, part } = await escenario()
    const p = await part.apartar(evento.id, UUID_MESERO)

    assert.equal(p.estado, 'aparto')
    assert.isNotNull(p.fechaAparto)
  })

  test('SGEB-4002: no se aparta en un evento con el cupo lleno', async ({ assert }) => {
    const { evento, part } = await escenario(1)
    await part.apartar(evento.id, UUID_MESERO)

    const otro = 'bb2a9c14-8b7e-4d61-9a03-2c5e77b1d842'
    await usuario(otro, 3, 'otro@x.mx')

    assert.equal(await codigo(() => part.apartar(evento.id, otro)), 'SGEB-4002')
  })

  test('SGEB-4011: no se aparta dos veces el mismo evento', async ({ assert }) => {
    const { evento, part } = await escenario()
    await part.apartar(evento.id, UUID_MESERO)

    /** Atrapa el doble toque en la app, que consumiría dos lugares del cupo. */
    assert.equal(await codigo(() => part.apartar(evento.id, UUID_MESERO)), 'SGEB-4011')
  })

  test('SGEB-4013: solo se aparta en eventos publicados', async ({ assert }) => {
    await usuario(UUID_CAP, 2, 'cap@x.mx')
    await usuario(UUID_MESERO, 3, 'mesero@x.mx')
    const sa = await salon()
    const eventos = await app.container.make(EventoService)
    const e = await eventos.crear(datosEvento(sa.id), UUID_CAP)
    const part = await app.container.make(ParticipacionService)

    assert.equal(await codigo(() => part.apartar(e.id, UUID_MESERO)), 'SGEB-4013')
  })

  test('SGEB-4005: sin checklist aprobado no hay asignación de mesas', async ({ assert }) => {
    const { evento, part } = await escenario()
    const p = await part.apartar(evento.id, UUID_MESERO)
    for (const s of ['seleccionado', 'confirmo_asistencia', 'confirmo_llegada'] as const) {
      await part.cambiarEstado(p.id, s)
    }

    /** Impide que un mesero atienda una mesa que nunca se montó. */
    assert.equal(await codigo(() => part.cambiarEstado(p.id, 'asignado')), 'SGEB-4005')
  })

  test('SGEB-4006: una mesa, un mesero a la vez', async ({ assert }) => {
    const { evento, part } = await escenario()
    const mesa = await db.from('mesa').where('id_evento', evento.id).firstOrFail()

    const p1 = await part.apartar(evento.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', p1.id).update({ checklist_ok: true })

    const otro = 'bb2a9c14-8b7e-4d61-9a03-2c5e77b1d842'
    await usuario(otro, 3, 'otro@x.mx')
    const p2 = await part.apartar(evento.id, otro)
    await db.from('participacion_evento').where('id_participacion', p2.id).update({ checklist_ok: true })

    const a = await part.asignarMesa(p1.id, mesa.id_mesa)
    await part.vincularMesa(a.id, (await db.from('mesa').where('id_mesa', mesa.id_mesa).firstOrFail()).codigo_qr)

    assert.equal(await codigo(() => part.asignarMesa(p2.id, mesa.id_mesa)), 'SGEB-4006')
  })

  test('vincular exige el QR correcto de esa mesa', async ({ assert }) => {
    const { evento, part, eventos } = await escenario()
    const mesa1 = await db.from('mesa').where('id_evento', evento.id).firstOrFail()
    const mesa2 = await eventos.agregarMesa(evento.id, { etiqueta: 'Mesa 2' })

    const p = await part.apartar(evento.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', p.id).update({ checklist_ok: true })
    const a = await part.asignarMesa(p.id, mesa1.id_mesa)

    /**
     * El código está impreso en la mesa, así que vincular implica haber estado
     * ahí. Aceptar el QR de otra mesa rompería esa evidencia.
     */
    assert.equal(await codigo(() => part.vincularMesa(a.id, mesa2.codigoQr)), 'SGEB-3003')

    const ok = await part.vincularMesa(a.id, mesa1.codigo_qr)
    assert.isTrue(ok.vinculada)

    const estado = await db.from('mesa').where('id_mesa', mesa1.id_mesa).firstOrFail()
    assert.equal(estado.estado, 'ocupada')
  })

  test('SGEB-4020: el mesero no libera su lugar a última hora', async ({ assert }) => {
    const { evento, part } = await escenario()
    const p = await part.apartar(evento.id, UUID_MESERO)

    /** Con margen suficiente sí puede. */
    await part.liberar(p.id, UUID_MESERO)
    assert.isNull(await ParticipacionEvento.find(p.id))

    const p2 = await part.apartar(evento.id, UUID_MESERO)
    await db
      .from('evento')
      .where('id_evento', evento.id)
      .update({ inicio: DateTime.now().plus({ hours: 3 }).toSQL() })

    /** A tres horas del inicio ya no hay margen para buscar reemplazo. */
    assert.equal(await codigo(() => part.liberar(p2.id, UUID_MESERO)), 'SGEB-4020')
  })

  test('SGEB-1004: nadie libera la participación de otro', async ({ assert }) => {
    const { evento, part } = await escenario()
    const p = await part.apartar(evento.id, UUID_MESERO)

    const otro = 'bb2a9c14-8b7e-4d61-9a03-2c5e77b1d842'
    await usuario(otro, 3, 'otro@x.mx')

    assert.equal(await codigo(() => part.liberar(p.id, otro)), 'SGEB-1004')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
test.group('Confirmación de llegada', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function listo() {
    await usuario(UUID_CAP, 2, 'cap@x.mx')
    const idMesero = await usuario(UUID_MESERO, 3, 'mesero@x.mx')
    const sa = await salon()
    const eventos = await app.container.make(EventoService)
    const e = await eventos.crear(datosEvento(sa.id), UUID_CAP)
    await eventos.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
    await eventos.cambiarEstado(e.id, 'publicado')

    const part = await app.container.make(ParticipacionService)
    const p = await part.apartar(e.id, UUID_MESERO)
    await part.cambiarEstado(p.id, 'seleccionado')
    await part.cambiarEstado(p.id, 'confirmo_asistencia')

    const uuidDisp = createHash('sha256').update('dispositivo-del-mesero').digest('hex')
    await db.table('auth.dispositivo_confiable').insert({
      id_usuario: idMesero,
      token_hash: uuidDisp,
      plataforma: 'ios',
      expira_en: DateTime.now().plus({ days: 30 }).toSQL(),
      activo: true,
    })

    return { evento: e, participacion: p, idMesero, uuidDisp, llegada: await app.container.make(LlegadaService) }
  }

  const enElSalon = { latitud: 25.5439, longitud: -103.4063 }
  /** ~4 km del salón: en Torreón, del centro a la periferia. */
  const lejos = { latitud: 25.58, longitud: -103.44 }

  test('dentro de la geocerca, con biometría y dispositivo propio: exitoso', async ({ assert }) => {
    const { participacion, uuidDisp, llegada } = await listo()

    const r = await llegada.confirmar(participacion.id, UUID_MESERO, {
      metodo: 'face_id',
      biometricoVerificado: true,
      uuidDispositivo: uuidDisp,
      ...enElSalon,
      precisionM: 8,
    })

    assert.equal(r.resultado, 'exitoso')
    assert.isTrue(r.dentro_geocerca)
    assert.isBelow(r.distancia_m, 20)
    assert.equal(r.modelo_verificacion, 'atestacion_local')

    const p = await ParticipacionEvento.findOrFail(participacion.id)
    assert.equal(p.estado, 'confirmo_llegada')
    assert.isNotNull(p.fechaLlegada)
  })

  test('SGEB-4003: fuera de la geocerca se deniega y queda registrado', async ({ assert }) => {
    const { participacion, uuidDisp, llegada } = await listo()

    assert.equal(
      await codigo(() =>
        llegada.confirmar(participacion.id, UUID_MESERO, {
          metodo: 'face_id',
          biometricoVerificado: true,
          uuidDispositivo: uuidDisp,
          ...lejos,
          precisionM: 8,
        })
      ),
      'SGEB-4003'
    )

    /**
     * Los intentos fallidos son la evidencia con la que el capitán resuelve una
     * disputa de asistencia, y de la asistencia depende el pago.
     */
    const registros = await db.from('confirmacion_llegada').where('id_participacion', participacion.id)
    assert.lengthOf(registros, 1)
    assert.equal(registros[0].resultado, 'fallido')
    assert.isFalse(registros[0].dentro_geocerca)

    const p = await ParticipacionEvento.findOrFail(participacion.id)
    assert.equal(p.estado, 'confirmo_asistencia')
  })

  test('SGEB-4004: biometría fallida o ausente', async ({ assert }) => {
    const { participacion, uuidDisp, llegada } = await listo()

    assert.equal(
      await codigo(() =>
        llegada.confirmar(participacion.id, UUID_MESERO, {
          metodo: 'face_id',
          biometricoVerificado: false,
          uuidDispositivo: uuidDisp,
          ...enElSalon,
        })
      ),
      'SGEB-4004'
    )

    /** Equipo sin biometría configurada: mismo código, la confirma el capitán. */
    assert.equal(
      await codigo(() =>
        llegada.confirmar(participacion.id, UUID_MESERO, {
          metodo: 'ninguno',
          biometricoVerificado: false,
          uuidDispositivo: uuidDisp,
          ...enElSalon,
        })
      ),
      'SGEB-4004'
    )
  })

  test('SGEB-4024: dispositivo no registrado a nombre del mesero', async ({ assert }) => {
    const { participacion, llegada, idMesero } = await listo()
    await db.from('auth.dispositivo_confiable').where('id_usuario', idMesero).update({ activo: false })

    assert.equal(
      await codigo(() =>
        llegada.confirmar(participacion.id, UUID_MESERO, {
          metodo: 'face_id',
          biometricoVerificado: true,
          uuidDispositivo: 'f'.repeat(64),
          ...enElSalon,
        })
      ),
      'SGEB-4024'
    )
  })

  test('SGEB-4025: el equipo pertenece a otro mesero — señal de colusión', async ({ assert }) => {
    const { participacion, llegada } = await listo()

    const otro = 'bb2a9c14-8b7e-4d61-9a03-2c5e77b1d842'
    const idOtro = await usuario(otro, 3, 'otro@x.mx')
    const dispAjeno = createHash('sha256').update('telefono-del-companero').digest('hex')
    await db.table('auth.dispositivo_confiable').insert({
      id_usuario: idOtro,
      token_hash: dispAjeno,
      plataforma: 'ios',
      expira_en: DateTime.now().plus({ days: 30 }).toSQL(),
      activo: true,
    })

    /**
     * El fraude más probable en la práctica: el compañero que presta su
     * teléfono. Mucho más frecuente que alguien modificando la app.
     */
    assert.equal(
      await codigo(() =>
        llegada.confirmar(participacion.id, UUID_MESERO, {
          metodo: 'face_id',
          biometricoVerificado: true,
          uuidDispositivo: dispAjeno,
          ...enElSalon,
        })
      ),
      'SGEB-4025'
    )
  })

  test('SGEB-4026: GPS impreciso es inconcluyente, NO asistencia denegada', async ({ assert }) => {
    const { participacion, uuidDisp, llegada } = await listo()

    /**
     * Se distingue de SGEB-4003 a propósito: uno afirma que el mesero está
     * fuera, el otro admite que no se pudo determinar. Tratar una medición
     * inconcluyente como denegada produce disputas que el registro no resuelve.
     */
    assert.equal(
      await codigo(() =>
        llegada.confirmar(participacion.id, UUID_MESERO, {
          metodo: 'face_id',
          biometricoVerificado: true,
          uuidDispositivo: uuidDisp,
          ...enElSalon,
          precisionM: 500,
        })
      ),
      'SGEB-4026'
    )
  })

  test('SGEB-1004: nadie confirma la llegada de otro', async ({ assert }) => {
    const { participacion, uuidDisp, llegada } = await listo()
    const otro = 'bb2a9c14-8b7e-4d61-9a03-2c5e77b1d842'
    await usuario(otro, 3, 'otro@x.mx')

    assert.equal(
      await codigo(() =>
        llegada.confirmar(participacion.id, otro, {
          metodo: 'face_id',
          biometricoVerificado: true,
          uuidDispositivo: uuidDisp,
          ...enElSalon,
        })
      ),
      'SGEB-1004'
    )
  })

  test('SGEB-4011: no se confirma llegada sin haber confirmado asistencia', async ({ assert }) => {
    const { evento, uuidDisp, llegada } = await listo()

    const otro = 'bb2a9c14-8b7e-4d61-9a03-2c5e77b1d842'
    await usuario(otro, 3, 'otro@x.mx')
    const part = await app.container.make(ParticipacionService)
    const p2 = await part.apartar(evento.id, otro)

    assert.equal(
      await codigo(() =>
        llegada.confirmar(p2.id, otro, {
          metodo: 'face_id',
          biometricoVerificado: true,
          uuidDispositivo: uuidDisp,
          ...enElSalon,
        })
      ),
      'SGEB-4011'
    )
  })

  test('la distancia la calcula el servidor, no el cliente', async ({ assert }) => {
    const { participacion, uuidDisp, llegada } = await listo()

    const r = await llegada.confirmar(participacion.id, UUID_MESERO, {
      metodo: 'huella',
      biometricoVerificado: true,
      uuidDispositivo: uuidDisp,
      latitud: 25.54489,
      longitud: -103.40632,
      precisionM: 10,
    })

    /**
     * 0.001° de latitud ≈ 111 m. Si la app enviara la distancia ya resuelta,
     * bastaría con mandar "estoy a 3 metros" para saltarse la geocerca.
     */
    assert.closeTo(r.distancia_m, 111, 5)
  })
})
