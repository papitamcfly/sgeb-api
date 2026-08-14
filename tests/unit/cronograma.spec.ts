import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { CronogramaService } from '#modules/eventos/services/cronograma_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import CronogramaEvento from '#modules/eventos/models/cronograma_evento'
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

test.group('Cronograma y notificaciones', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /** Evento en curso hoy, con dos meseros: uno en piso y otro que solo apartó. */
  async function escenario() {
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
    const fecha = DateTime.now().toISODate()!
    const e = await eventos.crear(
      {
        idSalon: sa.id, uuidCapitan: UUID_CAP, titulo: 'XV', tipo: 'social',
        fecha, horaPresentacion: '17:00', inicio: `${fecha}T19:00:00`,
        cupoMeseros: 10, numMesas: 20, tarifaPorMesero: 850, radioGeocercaM: 150,
      },
      UUID_CAP
    )
    await eventos.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
    await eventos.cambiarEstado(e.id, 'publicado')

    const part = await app.container.make(ParticipacionService)
    const enPiso = await part.apartar(e.id, UUID_MESERO)
    const soloAparto = await part.apartar(e.id, UUID_MESERO2)

    /** Solo el primero llegó al salón. */
    await db.from('participacion_evento').where('id_participacion', enPiso.id).update({ estado: 'vinculo' })

    await eventos.cambiarEstado(e.id, 'en_curso')

    return {
      evento: e, enPiso, soloAparto,
      cronograma: await app.container.make(CronogramaService),
    }
  }

  // ══════════════════════════════════════════════════════ hitos

  test('el capitán define los tiempos del servicio', async ({ assert }) => {
    const { evento, cronograma } = await escenario()

    const h = await cronograma.crear(evento.id, { tipoTiempo: 'ENTRADA', horaObjetivo: '20:00' })
    assert.equal(h.tipoTiempo, 'ENTRADA')
    assert.isFalse(h.disparado)

    await cronograma.crear(evento.id, { tipoTiempo: 'FUERTE', horaObjetivo: '21:00' })
    const lista = await cronograma.listar(evento.id)
    assert.lengthOf(lista, 2)
    /** Ordenados por hora, que es como los lee el mesero. */
    assert.equal(lista[0].tipoTiempo, 'ENTRADA')
  })

  test('SGEB-2013: no se repite un tipo de tiempo, salvo OTRO', async ({ assert }) => {
    const { evento, cronograma } = await escenario()
    await cronograma.crear(evento.id, { tipoTiempo: 'POSTRE', horaObjetivo: '22:00' })

    /**
     * "Sirvan el postre" dos veces no describe nada real: al dispararse el
     * segundo el mesero no sabría si el primero falló o si hay dos postres.
     */
    assert.equal(
      await codigo(() => cronograma.crear(evento.id, { tipoTiempo: 'POSTRE', horaObjetivo: '23:00' })),
      'SGEB-2013'
    )

    /** OTRO sí se repite: es el comodín para hitos adicionales. */
    await cronograma.crear(evento.id, { tipoTiempo: 'OTRO', horaObjetivo: '23:30', descripcion: 'Brindis' })
    await cronograma.crear(evento.id, { tipoTiempo: 'OTRO', horaObjetivo: '00:30', descripcion: 'Vals' })
    assert.lengthOf(await cronograma.listar(evento.id), 3)
  })

  test('SGEB-4013: no se agregan hitos a un evento finalizado', async ({ assert }) => {
    const { evento, cronograma } = await escenario()
    await db.from('evento').where('id_evento', evento.id).update({ estado: 'finalizado' })

    assert.equal(
      await codigo(() => cronograma.crear(evento.id, { tipoTiempo: 'ENTRADA', horaObjetivo: '20:00' })),
      'SGEB-4013'
    )
  })

  test('un hito ya disparado no se edita ni se elimina', async ({ assert }) => {
    const { evento, cronograma } = await escenario()
    const h = await cronograma.crear(evento.id, { tipoTiempo: 'ENTRADA', horaObjetivo: '20:00' })

    await cronograma.actualizar(evento.id, h.id, { horaObjetivo: '20:30' })
    await cronograma.disparar(h.id)

    /**
     * El aviso salió y los meseros ya actuaron. Editarlo reescribiría la
     * historia del servicio; borrarlo dejaría su notificación huérfana.
     */
    assert.equal(
      await codigo(() => cronograma.actualizar(evento.id, h.id, { horaObjetivo: '21:00' })),
      'SGEB-4011'
    )
    assert.equal(await codigo(() => cronograma.eliminar(evento.id, h.id)), 'SGEB-4016')
  })

  // ══════════════════════════════════════════════════════ disparo

  test('disparar notifica SOLO a quien está en piso', async ({ assert }) => {
    const { evento, enPiso, soloAparto, cronograma } = await escenario()
    const h = await cronograma.crear(evento.id, { tipoTiempo: 'FUERTE', horaObjetivo: '21:00' })

    assert.isTrue(await cronograma.disparar(h.id))

    const notis = await db.from('notificacion').where('id_cronograma', h.id)

    /**
     * Un mesero que apartó pero no llegó no necesita saber que toca el fuerte, y
     * recibirlo lo confundiría.
     */
    assert.lengthOf(notis, 1)
    assert.equal(notis[0].id_participacion, enPiso.id)
    assert.notEqual(notis[0].id_participacion, soloAparto.id)
    assert.equal(notis[0].mensaje, 'Sirvan el plato fuerte')
    assert.equal(notis[0].tipo, 'TIEMPO_COMIDA')
  })

  test('la descripción del capitán reemplaza al mensaje por defecto', async ({ assert }) => {
    const { evento, cronograma } = await escenario()
    const h = await cronograma.crear(evento.id, {
      tipoTiempo: 'OTRO',
      horaObjetivo: '23:00',
      descripcion: 'Sacar el pastel',
    })

    await cronograma.disparar(h.id)
    const n = await db.from('notificacion').where('id_cronograma', h.id).firstOrFail()
    assert.equal(n.mensaje, 'Sacar el pastel')
  })

  test('disparar es idempotente: no duplica notificaciones', async ({ assert }) => {
    const { evento, cronograma } = await escenario()
    const h = await cronograma.crear(evento.id, { tipoTiempo: 'ENTRADA', horaObjetivo: '20:00' })

    assert.isTrue(await cronograma.disparar(h.id))

    /**
     * El proceso puede reiniciarse. Sin la bandera, los meseros recibirían
     * "sirvan la entrada" tres veces y dejarían de confiar en el aviso.
     */
    assert.isFalse(await cronograma.disparar(h.id))
    assert.isFalse(await cronograma.disparar(h.id))

    assert.lengthOf(await db.from('notificacion').where('id_cronograma', h.id), 1)

    const releido = await CronogramaEvento.findOrFail(h.id)
    assert.isTrue(releido.disparado)
    assert.isNotNull(releido.fechaDisparo)
  })

  test('dispararVencidos respeta la anticipación de 5 minutos', async ({ assert }) => {
    const { evento, cronograma } = await escenario()

    /**
     * Un evento en curso ya arrancó: se sella `inicio` en el pasado. Sin esto,
     * un hito con hora menor al inicio se interpreta —correctamente— como del
     * día siguiente, porque así se manejan los eventos que cruzan la medianoche.
     */
    await db
      .from('evento')
      .where('id_evento', evento.id)
      .update({ inicio: DateTime.now().minus({ hours: 2 }).toSQL() })

    const enUnaHora = DateTime.now().plus({ hours: 1 }).toFormat('HH:mm')
    const enTresMinutos = DateTime.now().plus({ minutes: 3 }).toFormat('HH:mm')

    await cronograma.crear(evento.id, { tipoTiempo: 'POSTRE', horaObjetivo: enUnaHora })
    await cronograma.crear(evento.id, { tipoTiempo: 'ENTRADA', horaObjetivo: enTresMinutos })

    /** Solo el que cae dentro de la ventana; el de dentro de una hora espera. */
    const n = await cronograma.dispararVencidos()
    assert.equal(n, 1)

    const disparados = await CronogramaEvento.query().where('id_evento', evento.id).where('disparado', true)
    assert.lengthOf(disparados, 1)
    assert.equal(disparados[0].tipoTiempo, 'ENTRADA')
  })

  test('dispararVencidos ignora los eventos que no están en curso', async ({ assert }) => {
    const { evento, cronograma } = await escenario()
    await cronograma.crear(evento.id, {
      tipoTiempo: 'ENTRADA',
      horaObjetivo: DateTime.now().minus({ minutes: 10 }).toFormat('HH:mm'),
    })
    await db
      .from('evento')
      .where('id_evento', evento.id)
      .update({ estado: 'publicado', inicio: DateTime.now().minus({ hours: 2 }).toSQL() })

    assert.equal(await cronograma.dispararVencidos(), 0)
  })

  test('un hito después de medianoche cuenta como del día siguiente', async ({ assert }) => {
    const { evento, cronograma } = await escenario()

    /**
     * Un XV que sirve el postre a las 00:30 tiene el hito con hora MENOR que el
     * inicio (19:00). Sin este ajuste se dispararía apenas empezar el evento.
     */
    const h = await cronograma.crear(evento.id, { tipoTiempo: 'POSTRE', horaObjetivo: '00:30' })

    const alEmpezar = DateTime.fromISO(`${evento.fecha.toISODate()}T19:30:00`)
    assert.equal(await cronograma.dispararVencidos(alEmpezar), 0)

    const yaEnLaMadrugada = DateTime.fromISO(`${evento.fecha.toISODate()}T19:30:00`).plus({ hours: 5 })
    await cronograma.dispararVencidos(yaEnLaMadrugada)

    assert.isTrue((await CronogramaEvento.findOrFail(h.id)).disparado)
  })

  // ══════════════════════════════════════════════════════ notificaciones

  test('cada mesero ve solo su bandeja', async ({ assert }) => {
    const { evento, cronograma } = await escenario()
    const h = await cronograma.crear(evento.id, { tipoTiempo: 'ENTRADA', horaObjetivo: '20:00' })
    await cronograma.disparar(h.id)

    const mias = await cronograma.listarNotificaciones(UUID_MESERO)
    assert.equal(mias.notificaciones.length, 1)
    assert.equal(mias.sin_leer, 1)

    /** El que solo apartó no recibió nada, y su bandeja lo refleja. */
    const otras = await cronograma.listarNotificaciones(UUID_MESERO2)
    assert.lengthOf(otras.notificaciones, 0)
  })

  test('marcar leída es idempotente', async ({ assert }) => {
    const { evento, cronograma } = await escenario()
    const h = await cronograma.crear(evento.id, { tipoTiempo: 'ENTRADA', horaObjetivo: '20:00' })
    await cronograma.disparar(h.id)

    const n = (await cronograma.listarNotificaciones(UUID_MESERO)).notificaciones[0]

    const primera = await cronograma.marcarLeida(n.id, UUID_MESERO)
    assert.isTrue(primera.leida)

    const segunda = await cronograma.marcarLeida(n.id, UUID_MESERO)
    assert.isTrue(segunda.leida)

    const bandeja = await cronograma.listarNotificaciones(UUID_MESERO)
    assert.equal(bandeja.sin_leer, 0)
  })

  test('SGEB-1004: nadie marca las notificaciones de otro', async ({ assert }) => {
    const { evento, cronograma } = await escenario()
    const h = await cronograma.crear(evento.id, { tipoTiempo: 'ENTRADA', horaObjetivo: '20:00' })
    await cronograma.disparar(h.id)

    const n = (await cronograma.listarNotificaciones(UUID_MESERO)).notificaciones[0]

    /**
     * Sin esta comprobación, cualquiera podría marcar como leídas las
     * notificaciones de otro y hacer que se le pasara un tiempo de comida.
     */
    assert.equal(await codigo(() => cronograma.marcarLeida(n.id, UUID_MESERO2)), 'SGEB-1004')
  })

  test('la bandeja filtra por leídas y sin leer', async ({ assert }) => {
    const { evento, cronograma } = await escenario()
    for (const [t, hora] of [['ENTRADA', '20:00'], ['FUERTE', '21:00']] as const) {
      const h = await cronograma.crear(evento.id, { tipoTiempo: t, horaObjetivo: hora })
      await cronograma.disparar(h.id)
    }

    const todas = await cronograma.listarNotificaciones(UUID_MESERO)
    assert.lengthOf(todas.notificaciones, 2)

    await cronograma.marcarLeida(todas.notificaciones[0].id, UUID_MESERO)

    const pendientes = await cronograma.listarNotificaciones(UUID_MESERO, { leida: false })
    assert.lengthOf(pendientes.notificaciones, 1)
  })
})
