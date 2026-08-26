import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import ParticipacionEvento from '#modules/participaciones/models/participacion_evento'
import AsignacionMesa from '#modules/participaciones/models/asignacion_mesa'
import Salon from '#modules/eventos/models/salon'
import type { SgebError } from '#shared/errors/sgeb_error'

/**
 * Correcciones del smoke real del frontend.
 *
 * Cada prueba fija un defecto que ellos reprodujeron en la interfaz, para que
 * no vuelva a colarse.
 */

const UUID_CAP = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const UUID_MESERO = 'aa2a9c14-8b7e-4d61-9a03-2c5e77b1d841'
const UUID_OTRO = 'bb2a9c14-8b7e-4d61-9a03-2c5e77b1d842'

async function codigo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_FALLO'
  } catch (e) {
    return (e as SgebError).codigo ?? 'SIN_CODIGO'
  }
}

test.group('Correcciones del smoke', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function escenario() {
    await db.table('usuario').insert([
      { uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X', correo: 'c@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_MESERO, id_rol: 3, nombre: 'Juan', apellido_paterno: 'Perez', correo: 'm@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_OTRO, id_rol: 3, nombre: 'Ana', apellido_paterno: 'Lopez', correo: 'm2@x.mx', password_hash: 'x'.repeat(60) },
    ])

    const sa = await Salon.create({
      nombre: 'Salon', calle: 'Av', cp: '27000', colonia: 'C', ciudad: 'Torreon',
      estado: 'Coahuila', latitud: 25.54389, longitud: -103.40632,
      capacidadMaxMesas: 50, capacidadPersonas: 400, activo: true,
    })

    const eventos = await app.container.make(EventoService)
    const f = DateTime.now().plus({ days: 1 }).toISODate()!
    const e = await eventos.crear(
      {
        idSalon: sa.id, uuidCapitan: UUID_CAP, titulo: 'XV', tipo: 'social',
        fecha: f, horaPresentacion: '17:00', inicio: `${f}T19:00:00`,
        cupoMeseros: 5, numMesas: 10, tarifaPorMesero: 850, radioGeocercaM: 150,
      },
      UUID_CAP
    )
    const m1 = await eventos.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
    const m2 = await eventos.agregarMesa(e.id, { etiqueta: 'Mesa 2' })
    await eventos.cambiarEstado(e.id, 'publicado')

    const part = await app.container.make(ParticipacionService)
    const p = await part.apartar(e.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', p.id)
      .update({ checklist_ok: true, estado: 'confirmo_llegada' })

    return { evento: e, salon: sa, mesa: m1, mesa2: m2, part, eventos, participacion: p }
  }

  // ══════════════════════════════════ el mesero confirma su propia asistencia

  test('el mesero confirma su asistencia sin pasar por el capitán', async ({ assert }) => {
    const { evento, part } = await escenario()

    const p = await part.apartar(evento.id, UUID_OTRO)
    await db.from('participacion_evento').where('id_participacion', p.id)
      .update({ estado: 'seleccionado' })

    /**
     * Antes la única ruta era `PATCH /estado`, que vive en el bloque del
     * capitán: el mesero no tenía forma de confirmar y el flujo se quedaba
     * trabado en `seleccionado`.
     */
    const r = await part.confirmarAsistencia(p.id, UUID_OTRO)
    assert.equal(r.estado, 'confirmo_asistencia')
    assert.isNotNull(r.fechaConfirmaAsistencia)
  })

  test('confirmar asistencia es idempotente', async ({ assert }) => {
    const { evento, part } = await escenario()
    const p = await part.apartar(evento.id, UUID_OTRO)
    await db.from('participacion_evento').where('id_participacion', p.id)
      .update({ estado: 'seleccionado' })

    /** Doble pulsación o reintento de red: no debe responder error. */
    await part.confirmarAsistencia(p.id, UUID_OTRO)
    const r = await part.confirmarAsistencia(p.id, UUID_OTRO)
    assert.equal(r.estado, 'confirmo_asistencia')
  })

  test('SGEB-1004: nadie confirma la asistencia de otro', async ({ assert }) => {
    const { evento, part } = await escenario()
    const p = await part.apartar(evento.id, UUID_OTRO)
    await db.from('participacion_evento').where('id_participacion', p.id)
      .update({ estado: 'seleccionado' })

    /** Es una declaración personal: el capitán no puede darla por hecha. */
    assert.equal(await codigo(() => part.confirmarAsistencia(p.id, UUID_MESERO)), 'SGEB-1004')
  })

  test('no se confirma asistencia desde un estado que no la admite', async ({ assert }) => {
    const { evento, part } = await escenario()
    const p = await part.apartar(evento.id, UUID_OTRO)

    /** En `aparto` todavía no lo han seleccionado: no hay nada que confirmar. */
    assert.equal(await codigo(() => part.confirmarAsistencia(p.id, UUID_OTRO)), 'SGEB-4011')
  })

  // ══════════════════════════════════════════════════ #6 shape del PATCH

  test('PATCH /estado devuelve el mismo shape que obtener', async ({ assert }) => {
    const { evento, eventos } = await escenario()

    /**
     * La transición se guardaba bien, pero la respuesta llegaba sin capitán ni
     * salón: el panel la interpretaba como error después de un PATCH exitoso.
     */
    const r = await eventos.cambiarEstado(evento.id, 'en_curso')
    const json = r.serialize()

    assert.property(json, 'capitan')
    assert.property(json, 'salon')
    assert.equal(json.estado, 'en_curso')
  })

  // ══════════════════════════════════════════════════ #3 y #4 lecturas

  test('el readback de asignaciones 404 si el evento no existe', async ({ assert }) => {
    const { part } = await escenario()

    /**
     * Antes un id inventado y un evento sin asignaciones respondían igual —
     * `200 []`— y el panel no podía distinguir "no hay nada todavía" de
     * "esta pantalla no existe".
     */
    assert.equal(await codigo(() => part.listarAsignaciones(999999)), 'SGEB-3001')
  })

  test('el listado de eventos filtra por salón', async ({ assert }) => {
    const { evento, eventos } = await escenario()

    const otro = await Salon.create({
      nombre: 'Otro', calle: 'B', cp: '27000', colonia: 'C', ciudad: 'Torreon',
      estado: 'Coahuila', latitud: 25.5, longitud: -103.4,
      capacidadMaxMesas: 20, capacidadPersonas: 100, activo: true,
    })

    assert.lengthOf(await eventos.listar({ idSalon: evento.idSalon }), 1)
    assert.lengthOf(await eventos.listar({ idSalon: otro.id }), 0)
  })

  // ══════════════════════════════════════════════════ #14 etiqueta duplicada

  test('SGEB-2013: etiqueta duplicada NO revienta con 500', async ({ assert }) => {
    const { evento, eventos } = await escenario()

    /**
     * La restricción de la base funcionaba, pero el error de PostgreSQL
     * escapaba sin traducir y el cliente veía un 500 técnico.
     */
    assert.equal(
      await codigo(() => eventos.agregarMesa(evento.id, { etiqueta: 'Mesa 1' })),
      'SGEB-2013'
    )

    /** Y la transacción no queda muerta: se puede seguir operando. */
    const m = await eventos.agregarMesa(evento.id, { etiqueta: 'Mesa 3' })
    assert.equal(m.etiqueta, 'Mesa 3')
  })

  // ══════════════════════════════════════════════════ #7 guards de asignación

  test('SGEB-4011: no se asigna mesa a quien no ha llegado', async ({ assert }) => {
    const { evento, mesa, part } = await escenario()

    const p2 = await part.apartar(evento.id, UUID_OTRO)
    await db.from('participacion_evento').where('id_participacion', p2.id)
      .update({ checklist_ok: true })

    /**
     * Antes solo se miraba el checklist, así que se podía asignar mesa a
     * alguien que ni siquiera había confirmado asistencia: el plano de piso
     * describía una realidad que no existía.
     */
    assert.equal(await codigo(() => part.asignarMesa(p2.id, mesa.id)), 'SGEB-4011')
  })

  test('SGEB-4013: un evento finalizado no admite asignaciones', async ({ assert }) => {
    const { evento, mesa, part, participacion } = await escenario()
    await db.from('evento').where('id_evento', evento.id).update({ estado: 'finalizado' })

    assert.equal(await codigo(() => part.asignarMesa(participacion.id, mesa.id)), 'SGEB-4013')
  })

  // ══════════════════════════════════════════════════ #8 doble asignación

  test('SGEB-4006: no hay dos asignaciones pendientes sobre la misma mesa', async ({ assert }) => {
    const { evento, mesa, part, participacion } = await escenario()
    await part.asignarMesa(participacion.id, mesa.id)

    const p2 = await part.apartar(evento.id, UUID_OTRO)
    await db.from('participacion_evento').where('id_participacion', p2.id)
      .update({ checklist_ok: true, estado: 'confirmo_llegada' })

    /**
     * El guard miraba `vinculada = true`, así que dos meseros podían tener la
     * misma mesa asignada mientras ninguno hubiera llegado a ella. Ahora mira
     * `activa`, y además lo respalda un índice parcial.
     */
    assert.equal(await codigo(() => part.asignarMesa(p2.id, mesa.id)), 'SGEB-4006')
  })

  // ══════════════════════════════════════════════════ #9 y #10 liberar

  test('liberar revierte el estado de la participación', async ({ assert }) => {
    const { mesa, part, participacion } = await escenario()
    const a = await part.asignarMesa(participacion.id, mesa.id)

    assert.equal((await ParticipacionEvento.findOrFail(participacion.id)).estado, 'asignado')

    await part.liberarMesa(a.id)

    /**
     * Antes el mesero se quedaba en `asignado` sin mesa: el panel lo mostraba
     * trabajando en una que ya no tenía, y la máquina de estados mentía.
     */
    assert.equal((await ParticipacionEvento.findOrFail(participacion.id)).estado, 'confirmo_llegada')
  })

  test('liberar tras vincular también revierte', async ({ assert }) => {
    const { mesa, part, participacion } = await escenario()
    const a = await part.asignarMesa(participacion.id, mesa.id)
    await part.vincularMesa(a.id, mesa.codigoQr, UUID_MESERO)

    assert.equal((await ParticipacionEvento.findOrFail(participacion.id)).estado, 'vinculo')

    await part.liberarMesa(a.id)
    assert.equal((await ParticipacionEvento.findOrFail(participacion.id)).estado, 'confirmo_llegada')
  })

  test('pendiente y liberada son distinguibles', async ({ assert }) => {
    const { mesa, part, participacion } = await escenario()
    const a = await part.asignarMesa(participacion.id, mesa.id)

    /** Recién asignada: vigente, sin vincular. */
    let fila = await AsignacionMesa.findOrFail(a.id)
    assert.isTrue(fila.activa)
    assert.isFalse(fila.vinculada)
    assert.isNull(fila.fechaLiberacion)

    await part.liberarMesa(a.id)

    /**
     * Liberada: `vinculada = false` significaba las dos cosas y eran
     * indistinguibles. El panel seguía mostrando al mesero con mesa después de
     * quitársela.
     */
    fila = await AsignacionMesa.findOrFail(a.id)
    assert.isFalse(fila.activa)
    assert.isNotNull(fila.fechaLiberacion)
  })

  test('el readback solo trae las vigentes por defecto', async ({ assert }) => {
    const { evento, mesa, part, participacion } = await escenario()
    const a = await part.asignarMesa(participacion.id, mesa.id)
    await part.liberarMesa(a.id)

    assert.lengthOf(await part.listarAsignaciones(evento.id), 0)

    /** El histórico se consulta explícitamente. */
    assert.lengthOf(await part.listarAsignaciones(evento.id, { activa: false }), 1)
  })

  test('liberar deja la mesa disponible para otro mesero', async ({ assert }) => {
    const { evento, mesa, part, participacion } = await escenario()
    const a = await part.asignarMesa(participacion.id, mesa.id)
    await part.liberarMesa(a.id)

    const p2 = await part.apartar(evento.id, UUID_OTRO)
    await db.from('participacion_evento').where('id_participacion', p2.id)
      .update({ checklist_ok: true, estado: 'confirmo_llegada' })

    /** El índice parcial solo cuenta las vigentes, así que la mesa vuelve al ruedo. */
    const nueva = await part.asignarMesa(p2.id, mesa.id)
    assert.isTrue(nueva.activa)
  })

  // ══════════════════════════════════════════════════ #11 ownership

  test('SGEB-1004: un mesero no vincula la asignación de otro', async ({ assert }) => {
    const { mesa, part, participacion } = await escenario()
    const a = await part.asignarMesa(participacion.id, mesa.id)

    /**
     * El QR está impreso en la mesa, a la vista de todos: sin esta comprobación
     * cualquier mesero podía vincular la asignación ajena y aparecer como
     * responsable de una mesa que no le tocaba.
     */
    assert.equal(await codigo(() => part.vincularMesa(a.id, mesa.codigoQr, UUID_OTRO)), 'SGEB-1004')

    /** El dueño sí puede. */
    const r = await part.vincularMesa(a.id, mesa.codigoQr, UUID_MESERO)
    assert.isTrue(r.vinculada)
  })

  test('no se vincula una asignación ya liberada', async ({ assert }) => {
    const { mesa, part, participacion } = await escenario()
    const a = await part.asignarMesa(participacion.id, mesa.id)
    await part.liberarMesa(a.id)

    assert.equal(
      await codigo(() => part.vincularMesa(a.id, mesa.codigoQr, UUID_MESERO)),
      'SGEB-4011'
    )
  })

  // ══════════════════════════════════════════════════ #13 semántica de mesa

  test('la mesa sigue libre hasta que el mesero la vincula', async ({ assert }) => {
    const { mesa, part, participacion } = await escenario()
    await part.asignarMesa(participacion.id, mesa.id)

    /**
     * Es intencional: `MESA.estado` describe la ocupación **física**, no la
     * planeación. Entre asignar y vincular la mesa está asignada pero vacía, y
     * mostrarla ocupada haría que el capitán la diera por atendida.
     */
    const fila = await db.from('mesa').where('id_mesa', mesa.id).firstOrFail()
    assert.equal(fila.estado, 'libre')
  })
})
