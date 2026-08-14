import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { CierreService } from '#modules/cierre/services/cierre_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import Salon from '#modules/eventos/models/salon'
import Pago from '#modules/cierre/models/pago'
import type { SgebError } from '#shared/errors/sgeb_error'

const UUID_CAP = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const UUID_MESERO = 'aa2a9c14-8b7e-4d61-9a03-2c5e77b1d841'
const CLABE = '012180012345678909'

async function codigo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_FALLO'
  } catch (e) {
    return (e as SgebError).codigo ?? 'SIN_CODIGO'
  }
}

test.group('Cierre del evento', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /**
   * Monta un evento con un mesero que ya recorrió todo el ciclo, listo para
   * cerrarse. `conClabe` permite probar el bloqueo por cuenta bancaria.
   */
  async function eventoCerrable(opciones: { conClabe?: boolean; conSalida?: boolean } = {}) {
    const { conClabe = true, conSalida = true } = opciones

    const [cap] = await db.table('usuario').returning('id_usuario').insert({
      uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X',
      correo: 'c@x.mx', password_hash: 'x'.repeat(60),
    })
    const [mes] = await db.table('usuario').returning('id_usuario').insert({
      uuid_usuario: UUID_MESERO, id_rol: 3, nombre: 'Mesero', apellido_paterno: 'X',
      correo: 'm@x.mx', password_hash: 'x'.repeat(60),
    })

    if (conClabe) {
      await db.table('datos_bancarios').insert({
        id_usuario: mes.id_usuario, clabe: CLABE, banco: 'BBVA',
        titular_cuenta: 'Juan Perez', activo: true,
      })
    }

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
    await eventos.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
    await eventos.cambiarEstado(e.id, 'publicado')

    const part = await app.container.make(ParticipacionService)
    const p = await part.apartar(e.id, UUID_MESERO)
    await eventos.cambiarEstado(e.id, 'en_curso')

    if (conSalida) {
      await db.from('participacion_evento').where('id_participacion', p.id).update({ estado: 'salida' })
    }

    return {
      evento: e, participacion: p, idMesero: mes.id_usuario, idCap: cap.id_usuario,
      eventos, cierre: await app.container.make(CierreService),
    }
  }

  async function finalizar(idEvento: number, eventos: EventoService) {
    await db.from('evento').where('id_evento', idEvento).update({ inicio: DateTime.now().minus({ hours: 6 }).toSQL() })
    await eventos.cambiarEstado(idEvento, 'finalizado')
  }

  // ══════════════════════════════════════════════════════════════ mermas

  test('el capitán registra merma durante el servicio, no solo al final', async ({ assert }) => {
    const { evento, cierre } = await eventoCerrable()

    /** Las piezas se rompen durante el evento; el capitán las va anotando. */
    const r = await cierre.registrarMerma(evento.id, UUID_CAP, {
      observaciones: 'Se cayó una charola',
      detalles: [
        { tipo: 'copa_rota', cantidad: 3, costoEstimado: 45.5 },
        { tipo: 'plato_roto', cantidad: 2, costoEstimado: 30 },
      ],
    })

    assert.lengthOf(r.detalles, 2)

    const total = await cierre.listarMermas(evento.id)
    assert.equal(total.costo_total, 75.5)
    assert.equal(total.piezas_sin_costear, 0)
  })

  test('las piezas sin costear se reportan aparte, no como cero', async ({ assert }) => {
    const { evento, cierre } = await eventoCerrable()

    await cierre.registrarMerma(evento.id, UUID_CAP, {
      detalles: [
        { tipo: 'copa_rota', cantidad: 1, costoEstimado: 40 },
        { tipo: 'otro', cantidad: 5, costoEstimado: null },
      ],
    })

    /**
     * Un total de $40 con cinco piezas sin valorar dice algo distinto de un
     * total de $40 con todo costeado. Colapsarlos mentiría al capitán.
     */
    const r = await cierre.listarMermas(evento.id)
    assert.equal(r.costo_total, 40)
    assert.equal(r.piezas_sin_costear, 1)
  })

  test('SGEB-4013: no se registra merma en un evento en borrador', async ({ assert }) => {
    const { evento, cierre } = await eventoCerrable()
    await db.from('evento').where('id_evento', evento.id).update({ estado: 'borrador' })

    assert.equal(
      await codigo(() =>
        cierre.registrarMerma(evento.id, UUID_CAP, {
          detalles: [{ tipo: 'copa_rota', cantidad: 1 }],
        })
      ),
      'SGEB-4013'
    )
  })

  // ══════════════════════════════════════════════════════════════ pagos

  test('verificarCierre dice qué falta ANTES de intentar pagar', async ({ assert }) => {
    const { evento, cierre } = await eventoCerrable({ conSalida: false })

    const antes = await cierre.verificarCierre(evento.id)
    assert.isFalse(antes.listo)
    assert.isFalse(antes.evento_finalizado)
    assert.equal(antes.participaciones_sin_salida, 1)
  })

  test('SGEB-4013: no se calculan pagos de un evento sin finalizar', async ({ assert }) => {
    const { evento, cierre } = await eventoCerrable()
    assert.equal(await codigo(() => cierre.calcularPagos(evento.id)), 'SGEB-4013')
  })

  test('SGEB-4015: no se paga con meseros sin salida verificada', async ({ assert }) => {
    const { evento, eventos, cierre } = await eventoCerrable({ conSalida: false })
    await finalizar(evento.id, eventos)

    /**
     * Un mesero que no registró salida puede haberse ido antes de tiempo, y de
     * eso depende si se le paga completo.
     */
    assert.equal(await codigo(() => cierre.calcularPagos(evento.id)), 'SGEB-4015')
  })

  test('SGEB-4012: no se paga a un mesero sin CLABE vigente', async ({ assert }) => {
    const { evento, eventos, cierre } = await eventoCerrable({ conClabe: false })
    await finalizar(evento.id, eventos)

    /** Descubrirlo al dispersar dejaría pagos a medias. */
    assert.equal(await codigo(() => cierre.calcularPagos(evento.id)), 'SGEB-4012')
  })

  test('una CLABE desactivada cuenta como ausente', async ({ assert }) => {
    const { evento, eventos, cierre, idMesero } = await eventoCerrable()
    await db.from('datos_bancarios').where('id_usuario', idMesero).update({ activo: false })
    await finalizar(evento.id, eventos)

    assert.equal(await codigo(() => cierre.calcularPagos(evento.id)), 'SGEB-4012')
  })

  test('el cálculo usa la tarifa del evento y guarda la CLABE como snapshot', async ({ assert }) => {
    const { evento, eventos, cierre, participacion } = await eventoCerrable()
    await finalizar(evento.id, eventos)

    const r = await cierre.calcularPagos(evento.id)

    assert.lengthOf(r.pagos, 1)
    assert.equal(r.total, 850)
    assert.equal(r.pagos[0].idParticipacion, participacion.id)
    assert.equal(r.pagos[0].estado, 'pendiente')

    /**
     * Snapshot: si el mesero cambia de cuenta después, este registro debe
     * seguir diciendo a dónde se transfirió realmente el dinero.
     */
    const fila = await db.from('pago').where('id_pago', r.pagos[0].id).firstOrFail()
    assert.equal(fila.clabe_destino, CLABE)
  })

  test('la CLABE se enmascara al serializar el pago', async ({ assert }) => {
    const { evento, eventos, cierre } = await eventoCerrable()
    await finalizar(evento.id, eventos)
    const r = await cierre.calcularPagos(evento.id)

    const json = r.pagos[0].serialize()
    assert.equal(json.clabe_destino, '0121…8909')
    assert.notInclude(String(json.clabe_destino), '12345678')
  })

  test('recalcular es idempotente: no duplica pagos', async ({ assert }) => {
    const { evento, eventos, cierre } = await eventoCerrable()
    await finalizar(evento.id, eventos)

    await cierre.calcularPagos(evento.id)
    const segunda = await cierre.calcularPagos(evento.id)

    assert.lengthOf(segunda.pagos, 1)
    assert.lengthOf(await cierre.listarPagos(evento.id), 1)
  })

  test('un pago ya dispersado NO se recalcula', async ({ assert }) => {
    const { evento, eventos, cierre } = await eventoCerrable()
    await finalizar(evento.id, eventos)

    const r = await cierre.calcularPagos(evento.id)
    await cierre.marcarPagado(r.pagos[0].id, 'REF-001')

    /** Cambiar la tarifa después no debe alterar lo ya transferido. */
    await db.from('evento').where('id_evento', evento.id).update({ tarifa_por_mesero: 1200 })
    const segunda = await cierre.calcularPagos(evento.id)

    assert.equal(segunda.ya_pagados, 1)
    assert.lengthOf(segunda.pagos, 0)

    const pago = await Pago.findOrFail(r.pagos[0].id)
    assert.equal(pago.monto, 850)
    assert.equal(pago.estado, 'pagado')
  })

  test('un pago pendiente SÍ se actualiza al recalcular', async ({ assert }) => {
    const { evento, eventos, cierre } = await eventoCerrable()
    await finalizar(evento.id, eventos)
    const r = await cierre.calcularPagos(evento.id)

    /** Puede que la tarifa cambiara o que el mesero corrigiera su CLABE. */
    await db.from('evento').where('id_evento', evento.id).update({ tarifa_por_mesero: 900 })
    await cierre.calcularPagos(evento.id)

    assert.equal((await Pago.findOrFail(r.pagos[0].id)).monto, 900)
  })

  test('marcar pagado sella la fecha y normaliza la referencia', async ({ assert }) => {
    const { evento, eventos, cierre } = await eventoCerrable()
    await finalizar(evento.id, eventos)
    const r = await cierre.calcularPagos(evento.id)

    const pagado = await cierre.marcarPagado(r.pagos[0].id, ' ref-abc-123 ')
    assert.equal(pagado.estado, 'pagado')
    assert.equal(pagado.referencia, 'REF-ABC-123')
    assert.isNotNull(pagado.fechaPago)
  })

  test('pagado es terminal: no se marca dos veces ni se revierte', async ({ assert }) => {
    const { evento, eventos, cierre } = await eventoCerrable()
    await finalizar(evento.id, eventos)
    const r = await cierre.calcularPagos(evento.id)
    await cierre.marcarPagado(r.pagos[0].id, 'REF-001')

    /**
     * El pago se hace por transferencia manual, sin integración con banca: no
     * hay a quién preguntarle si de verdad llegó, así que revertirlo dejaría el
     * registro contradiciendo al banco.
     */
    assert.equal(await codigo(() => cierre.marcarPagado(r.pagos[0].id, 'REF-002')), 'SGEB-4011')
    assert.equal(await codigo(() => cierre.marcarFallido(r.pagos[0].id, 'error')), 'SGEB-4011')
  })

  test('SGEB-5004: una transferencia fallida queda registrada para reintentar', async ({
    assert,
  }) => {
    const { evento, eventos, cierre } = await eventoCerrable()
    await finalizar(evento.id, eventos)
    const r = await cierre.calcularPagos(evento.id)

    assert.equal(
      await codigo(() => cierre.marcarFallido(r.pagos[0].id, 'CLABE rechazada por el banco')),
      'SGEB-5004'
    )

    const pago = await Pago.findOrFail(r.pagos[0].id)
    assert.equal(pago.estado, 'fallido')

    /** Un pago fallido sí se puede recalcular y volver a intentar. */
    await cierre.calcularPagos(evento.id)
    assert.equal((await Pago.findOrFail(pago.id)).estado, 'pendiente')
  })

  test('verificarCierre confirma que todo está listo', async ({ assert }) => {
    const { evento, eventos, cierre } = await eventoCerrable()
    await finalizar(evento.id, eventos)

    const r = await cierre.verificarCierre(evento.id)
    assert.isTrue(r.listo)
    assert.equal(r.participaciones_sin_salida, 0)
    assert.equal(r.meseros_sin_clabe_vigente, 0)
  })
})
