import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { ComensalService } from '#modules/comensal/services/comensal_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import Salon from '#modules/eventos/models/salon'
import type { SgebError } from '#shared/errors/sgeb_error'

const UUID_CAP = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const UUID_MESERO = 'aa2a9c14-8b7e-4d61-9a03-2c5e77b1d841'
const UUID_MESERO2 = 'bb2a9c14-8b7e-4d61-9a03-2c5e77b1d842'

async function codigo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_FALLO'
  } catch (e) {
    return (e as SgebError).codigo ?? 'SIN_CODIGO'
  }
}

test.group('Comensal', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /** Evento en curso con una mesa ya vinculada a un mesero. */
  async function escenario(opciones: { vincular?: boolean } = {}) {
    const { vincular = true } = opciones

    await db.table('usuario').insert([
      { uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X', correo: 'c@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_MESERO, id_rol: 3, nombre: 'Juan', apellido_paterno: 'X', correo: 'm@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_MESERO2, id_rol: 3, nombre: 'Ana', apellido_paterno: 'X', correo: 'm2@x.mx', password_hash: 'x'.repeat(60) },
    ])

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
    const p2 = await part.apartar(e.id, UUID_MESERO2)
    await db.from('participacion_evento').whereIn('id_participacion', [p.id, p2.id]).update({ checklist_ok: true })

    let asignacion = null
    if (vincular) {
      asignacion = await part.asignarMesa(p.id, mesa.id)
      await part.vincularMesa(asignacion.id, mesa.codigoQr)
    }

    await eventos.cambiarEstado(e.id, 'en_curso')

    return {
      evento: e, mesa, participacion: p, participacion2: p2, asignacion,
      comensal: await app.container.make(ComensalService),
    }
  }

  // ══════════════════════════════════════════════════════ solicitudes

  test('el comensal llama al mesero desde el QR de su mesa', async ({ assert }) => {
    const { mesa, participacion, comensal } = await escenario()
    const s = await comensal.solicitar(mesa.codigoQr, 'atencion')

    assert.equal(s.estado, 'pendiente')
    assert.equal(s.idMesa, mesa.id)

    /**
     * Se preasigna al mesero que tiene la mesa vinculada: así la solicitud
     * aparece en SU bandeja, no en una cola general que nadie siente suya.
     */
    assert.equal(s.idParticipacion, participacion.id)
  })

  test('sin mesero vinculado la solicitud queda sin dueño, pero se registra', async ({ assert }) => {
    const { mesa, comensal } = await escenario({ vincular: false })
    const s = await comensal.solicitar(mesa.codigoQr, 'cuenta')

    /** El comensal no debe quedarse sin poder llamar solo porque nadie tomó la mesa. */
    assert.isNull(s.idParticipacion)
    assert.equal(s.estado, 'pendiente')
  })

  test('SGEB-4014: no se acumulan solicitudes con una pendiente', async ({ assert }) => {
    const { mesa, comensal } = await escenario()
    await comensal.solicitar(mesa.codigoQr, 'atencion')

    /**
     * El comensal impaciente toca tres veces el botón; no monta un ataque. El
     * freno evita que la bandeja del mesero se llene de la misma petición.
     */
    assert.equal(await codigo(() => comensal.solicitar(mesa.codigoQr, 'atencion')), 'SGEB-4014')
    assert.equal(await codigo(() => comensal.solicitar(mesa.codigoQr, 'cuenta')), 'SGEB-4014')
  })

  test('atender la solicitud libera la mesa para una nueva', async ({ assert }) => {
    const { mesa, participacion, comensal } = await escenario()
    const s = await comensal.solicitar(mesa.codigoQr, 'atencion')

    await comensal.cambiarEstado(s.id, 'atendida', participacion.id)
    const otra = await comensal.solicitar(mesa.codigoQr, 'cuenta')

    assert.equal(otra.estado, 'pendiente')
    assert.notEqual(otra.id, s.id)
  })

  test('cancelar también libera: una solicitud sin atender no bloquea la mesa', async ({
    assert,
  }) => {
    const { mesa, participacion, comensal } = await escenario()
    const s = await comensal.solicitar(mesa.codigoQr, 'atencion')

    /**
     * Sin este estado terminal, una solicitud que nadie atiende —el comensal se
     * levantó, o pidió por error— bloquearía la mesa para siempre, y el mesero
     * tendría que mentir diciendo que la atendió.
     */
    await comensal.cambiarEstado(s.id, 'cancelada', participacion.id)
    const otra = await comensal.solicitar(mesa.codigoQr, 'atencion')
    assert.equal(otra.estado, 'pendiente')
  })

  test('SGEB-4021: dos meseros tomando la misma solicitud, gana el primero', async ({ assert }) => {
    const { mesa, participacion, participacion2, comensal } = await escenario()
    const s = await comensal.solicitar(mesa.codigoQr, 'atencion')

    await comensal.cambiarEstado(s.id, 'atendida', participacion.id)

    /** El segundo recibe SGEB-4021 y su bandeja se refresca. */
    assert.equal(
      await codigo(() => comensal.cambiarEstado(s.id, 'atendida', participacion2.id)),
      'SGEB-4021'
    )

    const fila = await db.from('solicitud_servicio').where('id_solicitud', s.id).firstOrFail()
    assert.equal(fila.id_participacion, participacion.id)
  })

  test('SGEB-3003: un QR de evento no vigente no admite solicitudes', async ({ assert }) => {
    const { evento, mesa, comensal } = await escenario()
    await db.from('evento').where('id_evento', evento.id).update({ estado: 'finalizado' })

    assert.equal(await codigo(() => comensal.solicitar(mesa.codigoQr, 'atencion')), 'SGEB-3003')
  })

  test('la bandeja filtra por mesero, para que cada quien vea lo suyo', async ({ assert }) => {
    const { evento, mesa, participacion, comensal } = await escenario()
    await comensal.solicitar(mesa.codigoQr, 'atencion')

    const mias = await comensal.listarSolicitudes(evento.id, { idParticipacion: participacion.id })
    assert.lengthOf(mias, 1)

    const pendientes = await comensal.listarSolicitudes(evento.id, { estado: 'pendiente' })
    assert.lengthOf(pendientes, 1)
  })

  // ══════════════════════════════════════════════════════ calificaciones

  test('el comensal califica al mesero de su mesa', async ({ assert }) => {
    const { mesa, participacion, comensal } = await escenario()
    const token = comensal.tokenComensal()

    const c = await comensal.calificar(mesa.codigoQr, {
      tokenComensal: token,
      puntuacion: 5,
      comentario: 'Excelente servicio',
    })

    assert.equal(c.puntuacion, 5)
    assert.equal(c.idParticipacion, participacion.id)
  })

  test('SGEB-4010: un comensal no califica dos veces', async ({ assert }) => {
    const { mesa, comensal } = await escenario()
    const token = comensal.tokenComensal()

    await comensal.calificar(mesa.codigoQr, { tokenComensal: token, puntuacion: 5 })

    /**
     * El UNIQUE del token es la garantía real, no una comprobación previa: el
     * comensal puede tocar dos veces y las dos peticiones llegar a la vez.
     */
    assert.equal(
      await codigo(() => comensal.calificar(mesa.codigoQr, { tokenComensal: token, puntuacion: 1 })),
      'SGEB-4010'
    )
  })

  test('dos comensales distintos SÍ califican la misma mesa', async ({ assert }) => {
    const { evento, mesa, comensal } = await escenario()

    await comensal.calificar(mesa.codigoQr, { tokenComensal: comensal.tokenComensal(), puntuacion: 5 })
    await comensal.calificar(mesa.codigoQr, { tokenComensal: comensal.tokenComensal(), puntuacion: 3 })

    const r = await comensal.listarCalificaciones(evento.id)
    assert.equal(r.total, 2)
    assert.equal(r.promedio, 4)
  })

  test('SGEB-3002: sin mesero vinculado no hay a quién calificar', async ({ assert }) => {
    const { mesa, comensal } = await escenario({ vincular: false })

    assert.equal(
      await codigo(() =>
        comensal.calificar(mesa.codigoQr, { tokenComensal: randomUUID(), puntuacion: 5 })
      ),
      'SGEB-3002'
    )
  })

  test('la calificación es anónima: el token nunca se serializa', async ({ assert }) => {
    const { evento, mesa, comensal } = await escenario()
    const token = comensal.tokenComensal()
    await comensal.calificar(mesa.codigoQr, { tokenComensal: token, puntuacion: 4 })

    const r = await comensal.listarCalificaciones(evento.id)
    const json = r.calificaciones[0].serialize()

    /**
     * Devolver el token permitiría cruzar calificaciones con el orden de escaneo
     * y deducir quién dijo qué, que es justo lo que el anonimato debe impedir.
     */
    assert.notProperty(json, 'tokenComensal')
    assert.notProperty(json, 'token_comensal')
    assert.notInclude(JSON.stringify(json), token)
  })

  test('el capitán filtra las calificaciones bajas, que son las que atiende', async ({ assert }) => {
    const { evento, mesa, comensal } = await escenario()

    for (const p of [5, 2, 4, 1]) {
      await comensal.calificar(mesa.codigoQr, { tokenComensal: comensal.tokenComensal(), puntuacion: p })
    }

    /** Nadie revisa una lista de cincos: lo útil es ver las que hay que atender. */
    const bajas = await comensal.listarCalificaciones(evento.id, { puntuacionMax: 2 })
    assert.equal(bajas.total, 2)
    assert.deepEqual(bajas.calificaciones.map((c) => c.puntuacion).sort(), [1, 2])
  })

  test('el promedio es null sin calificaciones, no cero', async ({ assert }) => {
    const { evento, comensal } = await escenario()
    const r = await comensal.listarCalificaciones(evento.id)

    /** Un promedio de 0 diría que el servicio fue pésimo; null dice que no hay datos. */
    assert.equal(r.total, 0)
    assert.isNull(r.promedio)
  })
})
