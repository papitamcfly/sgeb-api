import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'

import { RecetaCalculo } from '#modules/menu/services/receta_calculo'
import { MenuService } from '#modules/menu/services/menu_service'
import { OrdenService } from '#modules/ordenes/services/orden_service'
import { CubaitorService } from '#modules/cubaitor/services/cubaitor_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import Salon from '#modules/eventos/models/salon'
import Orden from '#modules/ordenes/models/orden'
import OrdenDetalle from '#modules/ordenes/models/orden_detalle'
import ConfigDispensado from '#modules/cubaitor/models/config_dispensado'
import type RecetaIngrediente from '#modules/menu/models/receta_ingrediente'
import type { SgebError } from '#shared/errors/sgeb_error'

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

/** Ingrediente mínimo, sin tocar la base: el cálculo es pura aritmética. */
function ing(idInsumo: number, tipo: 'PROPORCION' | 'FIJO_ML' | 'RESTO', valor: number, orden: number) {
  return { idInsumo, tipoPorcion: tipo, valor, ordenServido: orden } as RecetaIngrediente
}

// ═══════════════════════════════════════════════════════════════════════════
test.group('Cálculo de receta', () => {
  const calc = new RecetaCalculo()

  test('una cuba: 45 ml de ron fijos y el refresco rellenando', ({ assert }) => {
    const v = calc.calcular([ing(1, 'FIJO_ML', 45, 1), ing(2, 'RESTO', 0, 2)], 350)

    /** 350 × 0.85 = 297 de capacidad útil; el hielo ocupa el resto. */
    assert.deepEqual(
      v.map((x) => [x.idInsumo, x.ml]),
      [
        [1, 45],
        [2, 252],
      ]
    )
    assert.equal(v[0].ml + v[1].ml, 297)
  })

  test('el alcohol NO escala con el envase; el refresco sí', ({ assert }) => {
    const receta = [ing(1, 'FIJO_ML', 45, 1), ing(2, 'RESTO', 0, 2)]

    const vaso = calc.calcular(receta, 350)
    const jarra = calc.calcular(receta, 1000)

    /**
     * Es la razón de ser de FIJO_ML: si el alcohol escalara, pedir la misma
     * bebida en jarra la haría casi tres veces más fuerte sin que nadie lo
     * decidiera.
     */
    assert.equal(vaso[0].ml, 45)
    assert.equal(jarra[0].ml, 45)
    assert.isAbove(jarra[1].ml, vaso[1].ml * 2)
  })

  test('respeta el orden de servido, no el orden de captura', ({ assert }) => {
    const v = calc.calcular([ing(2, 'RESTO', 0, 2), ing(1, 'FIJO_ML', 45, 1)], 350)

    /** El vaso lleva hielo: el refresco primero lo desbordaría. */
    assert.equal(v[0].idInsumo, 1)
    assert.equal(v[1].idInsumo, 2)
  })

  test('PROPORCION escala con el envase', ({ assert }) => {
    const v = calc.calcular([ing(1, 'PROPORCION', 0.2, 1), ing(2, 'RESTO', 0, 2)], 500)
    /** 500 × 0.85 = 425; el 20 % son 85 ml. */
    assert.equal(v[0].ml, 85)
    assert.equal(v[1].ml, 340)
  })

  test('varios RESTO se reparten y la suma cuadra exacta', ({ assert }) => {
    const v = calc.calcular(
      [ing(1, 'FIJO_ML', 40, 1), ing(2, 'RESTO', 0, 2), ing(3, 'RESTO', 0, 3)],
      350
    )
    /** El último absorbe el redondeo para que no se pierdan mililitros. */
    assert.equal(v.reduce((a, x) => a + x.ml, 0), 297)
  })

  test('SGEB-4007: la receta no cabe en el envase', ({ assert }) => {
    /**
     * Error de configuración del menú, no del mesero: pasa al definir una
     * bebida con 90 ml de licor y ofrecerla en vaso tequilero.
     */
    assert.throws(() => calc.calcular([ing(1, 'FIJO_ML', 90, 1), ing(2, 'RESTO', 0, 2)], 60))
  })

  test('una bebida sin receta no se puede dispensar', ({ assert }) => {
    assert.throws(() => calc.calcular([], 350))
  })

  test('los segundos salen del caudal calibrado, no de una constante', ({ assert }) => {
    assert.equal(calc.segundos(252, 15.5), 16.26)
    assert.equal(calc.segundos(45, 10), 4.5)
    /** DECIMAL(4,2) en la base: el tope es 99.99 s. */
    assert.equal(calc.segundos(100000, 1), 99.99)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
test.group('Órdenes y dispensado', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function barra(volumenRonMl = 1000) {
    await db.table('usuario').insert([
      { uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X', correo: 'c@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_MESERO, id_rol: 3, nombre: 'Mesero', apellido_paterno: 'X', correo: 'm@x.mx', password_hash: 'x'.repeat(60) },
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

    /** Apartar exige el evento publicado; ponerlo en curso viene después. */
    const part = await app.container.make(ParticipacionService)
    const p = await part.apartar(e.id, UUID_MESERO)

    await eventos.cambiarEstado(e.id, 'en_curso')

    const menu = new MenuService()
    const ron = await menu.crearInsumo({ nombre: 'Ron Blanco', tipo: 'alcohol', unidad: 'ml', costo: 250 })
    const cola = await menu.crearInsumo({ nombre: 'Refresco Cola', tipo: 'refresco', unidad: 'ml', costo: 30 })
    const cuba = await menu.crearBebida({ nombre: 'Cuba Libre', alcoholica: true })
    await menu.definirReceta(cuba.id, [
      { idInsumo: ron.id, tipoPorcion: 'FIJO_ML', valor: 45, ordenServido: 1 },
      { idInsumo: cola.id, tipoPorcion: 'RESTO', valor: 0, ordenServido: 2 },
    ])
    const vaso = await menu.crearEnvase({ nombre: 'Vaso Normal', volumenMl: 350 })

    const cub = new CubaitorService()
    const dispositivo = await cub.registrar({ nombre: 'Barra 1', mac: 'aa:bb:cc:dd:ee:ff', numPins: 8 })
    const cRon = await cub.configurarPin({
      idEvento: e.id, idCubaitor: dispositivo.id, idInsumo: ron.id,
      pinGpio: 12, caudalMlSeg: 15.5, volumenCargadoMl: volumenRonMl,
    })
    const cCola = await cub.configurarPin({
      idEvento: e.id, idCubaitor: dispositivo.id, idInsumo: cola.id,
      pinGpio: 13, caudalMlSeg: 25, volumenCargadoMl: 5000,
    })

    return {
      evento: e, mesa, participacion: p, ron, cola, cuba, vaso, dispositivo, cRon, cCola,
      ordenes: await app.container.make(OrdenService), menu, cub,
    }
  }

  test('el mesero levanta una orden y el volumen queda congelado', async ({ assert }) => {
    const { mesa, participacion, cuba, vaso, ordenes } = await barra()

    const orden = await ordenes.crear({
      idMesa: mesa.id,
      idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 2 }],
    })

    assert.equal(orden.estado, 'pendiente')
    assert.equal(orden.detalles[0].volumenTotalMl, 700)

    /**
     * Si después se corrige el volumen del envase, esta orden conserva el que
     * se usó: cambiar el histórico alteraría el consumo de eventos cerrados.
     */
    await db.from('envase').where('id_envase', vaso.id).update({ volumen_ml: 500 })
    const releida = await OrdenDetalle.findOrFail(orden.detalles[0].id)
    assert.equal(releida.volumenTotalMl, 700)
  })

  test('procesar el renglón produce las instrucciones para el Cubaitor', async ({ assert }) => {
    const { mesa, participacion, cuba, vaso, ordenes, cRon } = await barra()

    const orden = await ordenes.crear({
      idMesa: mesa.id, idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 }],
    })

    const r = await ordenes.procesarDetalle(orden.detalles[0].id)

    assert.lengthOf(r.instrucciones, 2)
    /** Ron primero: el vaso lleva hielo. */
    assert.equal(r.instrucciones[0].pin_gpio, 12)
    assert.equal(r.instrucciones[0].volumen_ml, 45)
    assert.equal(r.instrucciones[0].segundos, 2.9)
    assert.equal(r.instrucciones[1].volumen_ml, 252)

    /** El volumen disponible se descuenta al abrir la válvula, no antes. */
    const config = await ConfigDispensado.findOrFail(cRon.id)
    assert.equal(config.volumenDisponibleMl, 955)

    const detalle = await OrdenDetalle.findOrFail(orden.detalles[0].id)
    assert.equal(detalle.estado, 'dispensada')
    assert.equal((await Orden.findOrFail(orden.id)).estado, 'en_preparacion')
  })

  test('SGEB-4009: botella vacía pausa la orden ANTES de abrir la válvula', async ({ assert }) => {
    /** Solo 30 ml de ron: no alcanzan para los 45 de una cuba. */
    const { mesa, participacion, cuba, vaso, ordenes, cRon, cCola } = await barra(30)

    const orden = await ordenes.crear({
      idMesa: mesa.id, idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 }],
    })

    assert.equal(await codigo(() => ordenes.procesarDetalle(orden.detalles[0].id)), 'SGEB-4009')

    /**
     * Nada se sirvió: ni el ron que faltaba ni el refresco que sí había. Servir
     * medio vaso dejaría al comensal con una bebida que igual hay que tirar.
     */
    assert.equal((await ConfigDispensado.findOrFail(cRon.id)).volumenDisponibleMl, 30)
    assert.equal((await ConfigDispensado.findOrFail(cCola.id)).volumenDisponibleMl, 5000)
    assert.lengthOf(await db.from('dispensado'), 0)

    /** Y la pausa SOBREVIVE al throw: si no, el sistema no registraría el problema. */
    assert.equal((await OrdenDetalle.findOrFail(orden.detalles[0].id)).estado, 'pausada_por_insumo')
    assert.equal((await Orden.findOrFail(orden.id)).estado, 'pausada_por_insumo')
  })

  test('SGEB-4008: insumo sin pin configurado también pausa', async ({ assert }) => {
    const { mesa, participacion, cuba, vaso, ordenes, cRon } = await barra()
    await db.from('config_dispensado').where('id_config', cRon.id).update({ activo: false })

    const orden = await ordenes.crear({
      idMesa: mesa.id, idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 }],
    })

    assert.equal(await codigo(() => ordenes.procesarDetalle(orden.detalles[0].id)), 'SGEB-4008')
    assert.equal((await Orden.findOrFail(orden.id)).estado, 'pausada_por_insumo')
  })

  test('recargar la botella reanuda lo que estaba pausado', async ({ assert }) => {
    const { mesa, participacion, cuba, vaso, ordenes, cRon, cub } = await barra(30)

    const orden = await ordenes.crear({
      idMesa: mesa.id, idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 }],
    })
    await codigo(() => ordenes.procesarDetalle(orden.detalles[0].id))

    const r = await cub.recargar(cRon.id, 1000)

    /**
     * Contraparte operativa de SGEB-4009: el capitán cambia la botella y las
     * órdenes vuelven a la cola sin que el mesero las recapture.
     */
    assert.equal(r.detallesReanudados, 1)
    assert.equal((await OrdenDetalle.findOrFail(orden.detalles[0].id)).estado, 'pendiente')
    assert.equal((await Orden.findOrFail(orden.id)).estado, 'pendiente')

    const ok = await ordenes.procesarDetalle(orden.detalles[0].id)
    assert.lengthOf(ok.instrucciones, 2)
  })

  test('marcar un insumo agotado pausa las órdenes que lo usan', async ({ assert }) => {
    const { mesa, participacion, cuba, vaso, ordenes, ron, menu } = await barra()

    const orden = await ordenes.crear({
      idMesa: mesa.id, idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 }],
    })

    /** Preferible pausarlas de golpe a que cada mesero descubra el problema al servir. */
    const r = await menu.cambiarEstadoInsumo(ron.id, 'agotado')
    assert.equal(r.ordenesPausadas, 1)
    assert.equal((await OrdenDetalle.findOrFail(orden.detalles[0].id)).estado, 'pausada_por_insumo')
  })

  test('el reporte del Cubaitor detecta un dispensado parcial', async ({ assert }) => {
    const { mesa, participacion, cuba, vaso, ordenes } = await barra()
    const orden = await ordenes.crear({
      idMesa: mesa.id, idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 }],
    })
    const r = await ordenes.procesarDetalle(orden.detalles[0].id)
    const idDisp = r.instrucciones[0].id_dispensado

    /** Salió menos del 90 % de lo pedido: el mesero tiene que verlo antes de servir. */
    const parcial = await ordenes.reportarDispensado(idDisp, 1.0)
    assert.equal(parcial.estado, 'parcial')
    assert.equal(parcial.volumenRealEstimadoMl, 16)

    const ok = await ordenes.reportarDispensado(idDisp, 2.9)
    assert.equal(ok.estado, 'ok')
  })

  test('SGEB-5006: sin reporte del dispositivo, el dispensado queda en error', async ({ assert }) => {
    const { mesa, participacion, cuba, vaso, ordenes } = await barra()
    const orden = await ordenes.crear({
      idMesa: mesa.id, idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 }],
    })
    const r = await ordenes.procesarDetalle(orden.detalles[0].id)

    assert.equal(
      await codigo(() => ordenes.reportarDispensado(r.instrucciones[0].id_dispensado, null)),
      'SGEB-5006'
    )
  })

  test('el listado trae los dispensados anidados: rehidratación en una consulta', async ({
    assert,
  }) => {
    const { ordenes, evento, mesa, participacion, cuba, vaso } = await barra()
    const orden = await ordenes.crear({
      idMesa: mesa.id,
      idParticipacion: participacion.id,
      lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 }],
    })
    await ordenes.procesarDetalle(orden.detalles[0].id)

    /**
     * Sin esto, tras recargar la página el tablero perdía qué dispensados
     * esperaban confirmación, y pedirlos uno a uno serían N+1 peticiones en la
     * pantalla que más se refresca.
     */
    const lista = await ordenes.listarPorEvento(evento.id)
    const detalle = lista[0].detalles[0]

    assert.isArray(detalle.dispensados)
    assert.isAbove(detalle.dispensados.length, 0)

    const d = detalle.dispensados[0].serialize()
    assert.property(d, 'id_dispensado')
    assert.property(d, 'segundos_calculado')
    assert.property(d, 'estado')
  })

  test('no se entrega una orden con renglones sin dispensar', async ({ assert }) => {
    const { mesa, participacion, cuba, vaso, ordenes } = await barra()
    const orden = await ordenes.crear({
      idMesa: mesa.id, idParticipacion: participacion.id,
      lineas: [
        { idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 },
        { idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 },
      ],
    })

    await ordenes.procesarDetalle(orden.detalles[0].id)
    assert.equal(await codigo(() => ordenes.cambiarEstado(orden.id, 'entregada')), 'SGEB-4011')

    await ordenes.procesarDetalle(orden.detalles[1].id)
    const entregada = await ordenes.cambiarEstado(orden.id, 'entregada')
    assert.isNotNull(entregada.entregadaEn)
  })

  test('SGEB-4013: no se levantan órdenes fuera de un evento en curso', async ({ assert }) => {
    const { evento, mesa, participacion, cuba, vaso, ordenes } = await barra()
    await db.from('evento').where('id_evento', evento.id).update({ estado: 'publicado' })

    assert.equal(
      await codigo(() =>
        ordenes.crear({
          idMesa: mesa.id, idParticipacion: participacion.id,
          lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 }],
        })
      ),
      'SGEB-4013'
    )
  })

  test('SGEB-2012: tope de 50 unidades por renglón', async ({ assert }) => {
    const { mesa, participacion, cuba, vaso, ordenes } = await barra()
    assert.equal(
      await codigo(() =>
        ordenes.crear({
          idMesa: mesa.id, idParticipacion: participacion.id,
          lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 80 }],
        })
      ),
      'SGEB-2012'
    )
  })

  test('SGEB-4019: dos insumos no comparten el mismo pin', async ({ assert }) => {
    const { evento, dispositivo, cola, cub } = await barra()

    assert.equal(
      await codigo(() =>
        cub.configurarPin({
          idEvento: evento.id, idCubaitor: dispositivo.id, idInsumo: cola.id,
          pinGpio: 12, caudalMlSeg: 20, volumenCargadoMl: 1000,
        })
      ),
      'SGEB-4019'
    )
  })

  test('el Cubaitor caído no bloquea el evento', async ({ assert }) => {
    const { dispositivo, cub } = await barra()

    const sinReporte = await cub.estado(dispositivo.id)
    assert.isFalse(sinReporte.en_linea)
    assert.equal(sinReporte.pines_configurados, 2)

    await cub.heartbeat('AA:BB:CC:DD:EE:FF')
    const vivo = await cub.estado(dispositivo.id)
    assert.isTrue(vivo.en_linea)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
test.group('Catálogo del menú', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('SGEB-4016: no se desactiva un insumo que está en una receta activa', async ({ assert }) => {
    const menu = new MenuService()
    const ron = await menu.crearInsumo({ nombre: 'Ron', tipo: 'alcohol', unidad: 'ml', costo: 250 })
    const cuba = await menu.crearBebida({ nombre: 'Cuba', alcoholica: true })
    await menu.definirReceta(cuba.id, [
      { idInsumo: ron.id, tipoPorcion: 'FIJO_ML', valor: 45, ordenServido: 1 },
    ])

    /** Esa bebida quedaría imposible de preparar, y el mesero lo descubriría al servir. */
    assert.equal(await codigo(() => menu.desactivarInsumo(ron.id)), 'SGEB-4016')

    await menu.desactivarBebida(cuba.id)
    const ok = await menu.desactivarInsumo(ron.id)
    assert.isFalse(ok.activo)
  })

  test('SGEB-2012: las proporciones de una receta no pasan de 1.00', async ({ assert }) => {
    const menu = new MenuService()
    const a = await menu.crearInsumo({ nombre: 'A', tipo: 'jugo', unidad: 'ml', costo: 10 })
    const b = await menu.crearInsumo({ nombre: 'B', tipo: 'jugo', unidad: 'ml', costo: 10 })
    const bebida = await menu.crearBebida({ nombre: 'Mezcla', alcoholica: false })

    /**
     * Sin esta validación, dos ingredientes al 60 % pedirían 120 % del vaso y el
     * RESTO saldría negativo justo al servir, frente al comensal.
     */
    assert.equal(
      await codigo(() =>
        menu.definirReceta(bebida.id, [
          { idInsumo: a.id, tipoPorcion: 'PROPORCION', valor: 0.6, ordenServido: 1 },
          { idInsumo: b.id, tipoPorcion: 'PROPORCION', valor: 0.6, ordenServido: 2 },
        ])
      ),
      'SGEB-2012'
    )
  })

  test('redefinir la receta la reemplaza completa', async ({ assert }) => {
    const menu = new MenuService()
    const a = await menu.crearInsumo({ nombre: 'A', tipo: 'jugo', unidad: 'ml', costo: 10 })
    const b = await menu.crearInsumo({ nombre: 'B', tipo: 'agua', unidad: 'ml', costo: 5 })
    const bebida = await menu.crearBebida({ nombre: 'Mezcla', alcoholica: false })

    await menu.definirReceta(bebida.id, [
      { idInsumo: a.id, tipoPorcion: 'FIJO_ML', valor: 50, ordenServido: 1 },
    ])
    const r = await menu.definirReceta(bebida.id, [
      { idInsumo: b.id, tipoPorcion: 'RESTO', valor: 0, ordenServido: 1 },
    ])

    assert.lengthOf(r.receta, 1)
    assert.equal(r.receta[0].idInsumo, b.id)
  })
})
