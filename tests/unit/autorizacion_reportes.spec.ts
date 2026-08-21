import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { DashboardService } from '#modules/dashboard/services/dashboard_service'
import { ReporteService } from '#modules/dashboard/services/reporte_service'
import { ComensalService } from '#modules/comensal/services/comensal_service'
import { CubaitorService } from '#modules/cubaitor/services/cubaitor_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import Salon from '#modules/eventos/models/salon'
import type { SgebError } from '#shared/errors/sgeb_error'

const UUID_ADMIN = '11111111-1111-4111-8111-111111111111'
const UUID_CAP = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const UUID_CAP2 = 'cc2a9c14-8b7e-4d61-9a03-2c5e77b1d843'
const UUID_MESERO = 'aa2a9c14-8b7e-4d61-9a03-2c5e77b1d841'
const UUID_AJENO = 'bb2a9c14-8b7e-4d61-9a03-2c5e77b1d842'

async function codigo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_FALLO'
  } catch (e) {
    return (e as SgebError).codigo ?? 'SIN_CODIGO'
  }
}

async function base() {
  await db.table('usuario').insert([
    { uuid_usuario: UUID_ADMIN, id_rol: 1, nombre: 'Admin', apellido_paterno: 'X', correo: 'a@x.mx', password_hash: 'x'.repeat(60) },
    { uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X', correo: 'c@x.mx', password_hash: 'x'.repeat(60) },
    { uuid_usuario: UUID_CAP2, id_rol: 2, nombre: 'Cap2', apellido_paterno: 'X', correo: 'c2@x.mx', password_hash: 'x'.repeat(60) },
    { uuid_usuario: UUID_MESERO, id_rol: 3, nombre: 'Juan', apellido_paterno: 'Perez', correo: 'm@x.mx', password_hash: 'x'.repeat(60) },
    { uuid_usuario: UUID_AJENO, id_rol: 3, nombre: 'Ana', apellido_paterno: 'Lopez', correo: 'm2@x.mx', password_hash: 'x'.repeat(60) },
  ])
  return Salon.create({
    nombre: 'Salon', calle: 'Av', cp: '27000', colonia: 'C', ciudad: 'Torreon',
    estado: 'Coahuila', latitud: 25.54389, longitud: -103.40632,
    capacidadMaxMesas: 50, capacidadPersonas: 400, activo: true,
  })
}

async function evento(idSalon: number, dias = 1) {
  const ev = await app.container.make(EventoService)
  const f = DateTime.now().plus({ days: dias }).toISODate()!
  const e = await ev.crear(
    {
      idSalon, uuidCapitan: UUID_CAP, titulo: 'XV', tipo: 'social',
      fecha: f, horaPresentacion: '17:00', inicio: `${f}T19:00:00`,
      cupoMeseros: 5, numMesas: 10, tarifaPorMesero: 850, radioGeocercaM: 150,
    },
    UUID_CAP
  )
  const m = await ev.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
  await ev.cambiarEstado(e.id, 'publicado')
  return { evento: e, mesa: m, ev }
}

test.group('Autorización del dashboard de evento', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('SGEB-1004: un capitán ajeno NO ve el panel del evento', async ({ assert }) => {
    const sa = await base()
    const { evento: e } = await evento(sa.id)
    const dash = await app.container.make(DashboardService)

    /**
     * Los ids son enteros secuenciales: adivinarlos es contar. Sin esto,
     * cualquier autenticado veía plantilla, órdenes, calificaciones y alertas
     * de un evento ajeno.
     */
    assert.equal(
      await codigo(() => dash.evento(e.id, undefined, { uuid: UUID_CAP2, rol: 'capitan' })),
      'SGEB-1004'
    )
  })

  test('SGEB-1004: un mesero sin participación tampoco', async ({ assert }) => {
    const sa = await base()
    const { evento: e } = await evento(sa.id)
    const dash = await app.container.make(DashboardService)

    assert.equal(
      await codigo(() => dash.evento(e.id, undefined, { uuid: UUID_AJENO, rol: 'mesero' })),
      'SGEB-1004'
    )
  })

  test('el capitán del evento y el mesero con participación sí lo ven', async ({ assert }) => {
    const sa = await base()
    const { evento: e } = await evento(sa.id)
    const part = await app.container.make(ParticipacionService)
    await part.apartar(e.id, UUID_MESERO)

    const dash = await app.container.make(DashboardService)

    const delCapitan = await dash.evento(e.id, ['resumen'], { uuid: UUID_CAP, rol: 'capitan' })
    assert.property(delCapitan.data, 'resumen')

    const delMesero = await dash.evento(e.id, ['resumen'], { uuid: UUID_MESERO, rol: 'mesero' })
    assert.property(delMesero.data, 'resumen')

    /** El admin entra a cualquiera. */
    const delAdmin = await dash.evento(e.id, ['resumen'], { uuid: UUID_ADMIN, rol: 'admin' })
    assert.property(delAdmin.data, 'resumen')
  })
})

test.group('Atención de solicitudes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function escenario() {
    const sa = await base()
    const { evento: e, mesa } = await evento(sa.id)
    const part = await app.container.make(ParticipacionService)
    const p = await part.apartar(e.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', p.id)
      .update({ checklist_ok: true, estado: 'confirmo_llegada' })
    return { evento: e, mesa, participacion: p, comensal: await app.container.make(ComensalService) }
  }

  test('quién atendió lo deduce el servidor, no el cliente', async ({ assert }) => {
    const { mesa, participacion, comensal } = await escenario()
    const s = await comensal.solicitar(mesa.codigoQr, 'atencion')

    /**
     * Antes llegaba `id_participacion` en el cuerpo y se guardaba sin verificar:
     * un mesero podía atribuirse la atención de otro. De ese campo cuelga el
     * indicador de tiempo de respuesta, que es dato de desempeño.
     */
    const r = await comensal.cambiarEstado(s.id, 'atendida', UUID_MESERO)
    assert.equal(r.idParticipacion, participacion.id)
  })

  test('SGEB-1004: quien no trabaja en el evento no atiende sus solicitudes', async ({ assert }) => {
    const { mesa, comensal } = await escenario()
    const s = await comensal.solicitar(mesa.codigoQr, 'atencion')

    assert.equal(
      await codigo(() => comensal.cambiarEstado(s.id, 'atendida', UUID_AJENO)),
      'SGEB-1004'
    )
  })
})

test.group('Heartbeat del Cubaitor', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el latido actualiza ultima_conexion y reactiva el equipo', async ({ assert }) => {
    await base()
    const cub = new CubaitorService()
    const c = await cub.registrar({ nombre: 'Barra 1', mac: 'AA:BB:CC:DD:EE:FF', numPins: 4 })

    await db.from('cubaitor').where('id_cubaitor', c.id)
      .update({ estado: 'inactivo', ultima_conexion: null })

    /**
     * El método existía pero no tenía ruta: `ultima_conexion` nunca se
     * actualizaba y el dashboard marcaba todos los dispositivos fuera de línea
     * para siempre.
     */
    const r = await cub.heartbeat('AA:BB:CC:DD:EE:FF')
    assert.isNotNull(r.ultimaConexion)
    assert.equal(r.estado, 'activo')
  })

  test('la MAC se compara en mayúsculas', async ({ assert }) => {
    await base()
    const cub = new CubaitorService()
    await cub.registrar({ nombre: 'Barra 1', mac: 'AA:BB:CC:DD:EE:FF', numPins: 4 })

    const r = await cub.heartbeat('aa:bb:cc:dd:ee:ff')
    assert.isNotNull(r.ultimaConexion)
  })
})

test.group('Reporte de desempeño', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('cuenta eventos, asistencias y faltas por mesero', async ({ assert }) => {
    const sa = await base()
    const part = await app.container.make(ParticipacionService)

    /** Uno donde llegó, otro donde lo seleccionaron y no llegó. */
    const a = await evento(sa.id, 1)
    const pa = await part.apartar(a.evento.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', pa.id)
      .update({ estado: 'salida' })

    const b = await evento(sa.id, 2)
    const pb = await part.apartar(b.evento.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', pb.id)
      .update({ estado: 'confirmo_asistencia' })

    const rep = await app.container.make(ReporteService)
    const r = await rep.desempenoMeseros({
      fechaDesde: DateTime.now().toISODate()!,
      fechaHasta: DateTime.now().plus({ days: 30 }).toISODate()!,
    })

    const juan = r.filas.find((f) => f.uuid_usuario === UUID_MESERO)!
    assert.equal(juan.eventos_trabajados, 2)
    assert.equal(juan.asistencias, 1)
    assert.equal(juan.faltas, 1)
  })

  test('los eventos cancelados no cuentan como falta', async ({ assert }) => {
    const sa = await base()
    const part = await app.container.make(ParticipacionService)
    const a = await evento(sa.id, 1)
    const p = await part.apartar(a.evento.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', p.id)
      .update({ estado: 'confirmo_asistencia' })
    await db.from('evento').where('id_evento', a.evento.id).update({ estado: 'cancelado' })

    /**
     * Nadie trabajó en un evento cancelado, y contarlo como falta castigaría al
     * mesero por una decisión del cliente.
     */
    const rep = await app.container.make(ReporteService)
    const r = await rep.desempenoMeseros({
      fechaDesde: DateTime.now().toISODate()!,
      fechaHasta: DateTime.now().plus({ days: 30 }).toISODate()!,
    })
    assert.lengthOf(r.filas, 0)
  })

  test('el promedio de calificación es null sin datos, no cero', async ({ assert }) => {
    const sa = await base()
    const part = await app.container.make(ParticipacionService)
    const a = await evento(sa.id, 1)
    const p = await part.apartar(a.evento.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', p.id).update({ estado: 'salida' })

    const rep = await app.container.make(ReporteService)
    const r = await rep.desempenoMeseros({
      fechaDesde: DateTime.now().toISODate()!,
      fechaHasta: DateTime.now().plus({ days: 30 }).toISODate()!,
    })

    /** Un cero diría "midió cero"; null dice "no hay dato". */
    assert.isNull(r.filas[0].promedio_calificacion)
    assert.equal(r.filas[0].calificaciones_recibidas, 0)
    assert.isNull(r.filas[0].segundos_respuesta_promedio)
    assert.isNull(r.filas[0].puntualidad)
  })

  test('SGEB-2015: el rango tiene tope', async ({ assert }) => {
    await base()
    const rep = await app.container.make(ReporteService)
    assert.equal(
      await codigo(() => rep.desempenoMeseros({ fechaDesde: '2020-01-01', fechaHasta: '2026-01-01' })),
      'SGEB-2015'
    )
  })

  test('SGEB-2009: fecha_desde posterior a fecha_hasta', async ({ assert }) => {
    await base()
    const rep = await app.container.make(ReporteService)
    assert.equal(
      await codigo(() => rep.desempenoMeseros({ fechaDesde: '2026-06-01', fechaHasta: '2026-01-01' })),
      'SGEB-2009'
    )
  })

  test('filtra por mesero y pagina', async ({ assert }) => {
    const sa = await base()
    const part = await app.container.make(ParticipacionService)
    const a = await evento(sa.id, 1)
    for (const u of [UUID_MESERO, UUID_AJENO]) {
      const p = await part.apartar(a.evento.id, u)
      await db.from('participacion_evento').where('id_participacion', p.id).update({ estado: 'salida' })
    }

    const rep = await app.container.make(ReporteService)
    const desde = DateTime.now().toISODate()!
    const hasta = DateTime.now().plus({ days: 30 }).toISODate()!

    const todos = await rep.desempenoMeseros({ fechaDesde: desde, fechaHasta: hasta })
    assert.lengthOf(todos.filas, 2)
    assert.equal(todos.meta.total, 2)

    const uno = await rep.desempenoMeseros({ fechaDesde: desde, fechaHasta: hasta, uuidMesero: UUID_MESERO })
    assert.lengthOf(uno.filas, 1)
    assert.equal(uno.filas[0].uuid_usuario, UUID_MESERO)

    const pagina = await rep.desempenoMeseros({ fechaDesde: desde, fechaHasta: hasta, pageSize: 1 })
    assert.lengthOf(pagina.filas, 1)
    assert.equal(pagina.meta.last_page, 2)
  })

  test('agrega calificaciones y solicitudes atendidas', async ({ assert }) => {
    const sa = await base()
    const part = await app.container.make(ParticipacionService)
    const a = await evento(sa.id, 1)
    const p = await part.apartar(a.evento.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', p.id)
      .update({ estado: 'salida', checklist_ok: true })

    for (const puntuacion of [5, 4, 2]) {
      await db.table('calificacion').insert({
        id_mesa: a.mesa.id, id_participacion: p.id, puntuacion,
        token_comensal: crypto.randomUUID(),
      })
    }

    const creada = DateTime.now().minus({ minutes: 10 })
    await db.table('solicitud_servicio').insert({
      id_mesa: a.mesa.id, id_participacion: p.id, tipo: 'atencion', estado: 'atendida',
      creada_en: creada.toSQL(), atendida_en: creada.plus({ seconds: 120 }).toSQL(),
    })

    const rep = await app.container.make(ReporteService)
    const r = await rep.desempenoMeseros({
      fechaDesde: DateTime.now().toISODate()!,
      fechaHasta: DateTime.now().plus({ days: 30 }).toISODate()!,
    })

    const juan = r.filas[0]
    assert.equal(juan.calificaciones_recibidas, 3)
    assert.equal(juan.promedio_calificacion, 3.67)
    /** Las de 1 y 2 estrellas ameritan revisión del capitán. */
    assert.equal(juan.calificaciones_bajas, 1)
    assert.equal(juan.solicitudes_atendidas, 1)
    assert.equal(juan.segundos_respuesta_promedio, 120)
  })
})
