import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'

import Salon from '#modules/eventos/models/salon'
import Evento from '#modules/eventos/models/evento'
import Mesa from '#modules/eventos/models/mesa'
import ParticipacionEvento from '#modules/participaciones/models/participacion_evento'
import Insumo from '#modules/menu/models/insumo'
import Bebida from '#modules/menu/models/bebida'
import Envase from '#modules/menu/models/envase'
import RecetaIngrediente from '#modules/menu/models/receta_ingrediente'
import Orden from '#modules/ordenes/models/orden'
import OrdenDetalle from '#modules/ordenes/models/orden_detalle'
import Calificacion from '#modules/comensal/models/calificacion'
import Pago from '#modules/cierre/models/pago'
import DatosBancarios from '#modules/identidad/models/datos_bancarios'

/**
 * Verifica que cada modelo mapee correctamente contra el esquema real: nombres
 * de columna, tipos y decisiones de serialización.
 *
 * Un modelo con un `columnName` equivocado compila sin problema y truena en la
 * primera consulta, en producción. Estas pruebas mueven ese fallo al CI.
 */
test.group('Modelos de dominio', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function capitan() {
    const [u] = await db
      .table('usuario')
      .returning('id_usuario')
      .insert({
        uuid_usuario: '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840',
        id_rol: 2,
        nombre: 'Isaac',
        apellido_paterno: 'Velasquez',
        correo: 'cap@x.mx',
        password_hash: 'a'.repeat(60),
      })
    return u.id_usuario as number
  }

  async function escenario() {
    const idCap = await capitan()
    const salon = await Salon.create({
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
    const evento = await Evento.create({
      idSalon: salon.id,
      idCapitan: idCap,
      idUsuarioCreador: idCap,
      titulo: 'XV de Maria',
      tipo: 'social',
      fecha: DateTime.fromISO('2026-09-15'),
      horaPresentacion: '17:00',
      inicio: DateTime.fromISO('2026-09-15T19:00:00'),
      cupoMeseros: 10,
      numMesas: 20,
      tarifaPorMesero: 850,
      radioGeocercaM: 150,
      estado: 'publicado',
    })
    return { idCap, salon, evento }
  }

  test('Salon lee las coordenadas como número, no como cadena', async ({ assert }) => {
    const salon = await Salon.create({
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

    const leido = await Salon.findOrFail(salon.id)

    /**
     * El driver de PostgreSQL entrega los DECIMAL como cadena para no perder
     * precisión. Sin el `consume` del modelo, calcular la distancia a la
     * geocerca haría aritmética con strings y daría NaN.
     */
    assert.isNumber(leido.latitud)
    assert.isNumber(leido.longitud)
    assert.closeTo(leido.longitud, -103.40632, 0.00001)
  })

  test('Evento no serializa los identificadores enteros de usuario', async ({ assert }) => {
    const { evento } = await escenario()
    const json = evento.serialize()

    assert.notProperty(json, 'idCapitan')
    assert.notProperty(json, 'id_capitan')
    assert.notProperty(json, 'idUsuarioCreador')
    assert.property(json, 'id_evento')
    assert.property(json, 'tarifa_por_mesero')
  })

  test('Evento lee la tarifa como número', async ({ assert }) => {
    const { evento } = await escenario()
    const leido = await Evento.findOrFail(evento.id)
    assert.isNumber(leido.tarifaPorMesero)
    assert.equal(leido.tarifaPorMesero, 850)
  })

  test('la relación Evento → Mesas carga correctamente', async ({ assert }) => {
    const { evento } = await escenario()
    await Mesa.createMany([
      { idEvento: evento.id, etiqueta: 'Mesa 1', codigoQr: '11111111-1111-4111-8111-111111111111' },
      { idEvento: evento.id, etiqueta: 'Mesa 2', codigoQr: '22222222-2222-4222-8222-222222222222' },
    ])

    const conMesas = await Evento.query().where('id_evento', evento.id).preload('mesas').firstOrFail()
    assert.lengthOf(conMesas.mesas, 2)
    assert.equal(conMesas.mesas[0].estado, 'libre')
  })

  test('la receta se ordena por orden_servido', async ({ assert }) => {
    const ron = await Insumo.create({
      nombre: 'Ron Blanco',
      tipo: 'alcohol',
      unidad: 'ml',
      costo: 250,
      estado: 'disponible',
      activo: true,
    })
    const cola = await Insumo.create({
      nombre: 'Refresco Cola',
      tipo: 'refresco',
      unidad: 'ml',
      costo: 30,
      estado: 'disponible',
      activo: true,
    })
    const cuba = await Bebida.create({
      nombre: 'Cuba Libre',
      alcoholica: true,
      activo: true,
      descripcion: null,
    })

    /**
     * El orden importa físicamente: el alcohol va primero y el refresco al
     * final, porque el vaso lleva hielo y el orden inverso lo desborda.
     */
    await RecetaIngrediente.createMany([
      { idBebida: cuba.id, idInsumo: cola.id, tipoPorcion: 'RESTO', valor: 0, ordenServido: 2 },
      { idBebida: cuba.id, idInsumo: ron.id, tipoPorcion: 'FIJO_ML', valor: 45, ordenServido: 1 },
    ])

    const conReceta = await Bebida.query()
      .where('id_bebida', cuba.id)
      .preload('receta', (q) => q.orderBy('orden_servido'))
      .firstOrFail()

    assert.lengthOf(conReceta.receta, 2)
    assert.equal(conReceta.receta[0].idInsumo, ron.id)
    assert.equal(conReceta.receta[0].tipoPorcion, 'FIJO_ML')
    assert.isNumber(conReceta.receta[0].valor)
  })

  test('la orden usa el enumerado del Diccionario: entregada, no servida', async ({ assert }) => {
    const { idCap, evento } = await escenario()
    const mesa = await Mesa.create({
      idEvento: evento.id,
      etiqueta: 'Mesa 3',
      codigoQr: '33333333-3333-4333-8333-333333333333',
    })
    const part = await ParticipacionEvento.create({
      idEvento: evento.id,
      idUsuario: idCap,
      puesto: 'mesero',
      estado: 'vinculo',
      checklistOk: true,
    })
    const envase = await Envase.create({ nombre: 'Vaso Normal', volumenMl: 350, activo: true })
    const bebida = await Bebida.create({
      nombre: 'Agua Mineral',
      alcoholica: false,
      activo: true,
      descripcion: null,
    })

    const orden = await Orden.create({
      idMesa: mesa.id,
      idParticipacion: part.id,
      estado: 'pendiente',
    })

    await OrdenDetalle.create({
      idOrden: orden.id,
      idBebida: bebida.id,
      idEnvase: envase.id,
      cantidad: 2,
      volumenTotalMl: envase.volumenMl * 2,
      estado: 'pendiente',
    })

    // Recorrido completo de la máquina de estados del Diccionario (tabla 20).
    for (const estado of ['en_preparacion', 'dispensando', 'entregada'] as const) {
      orden.estado = estado
      await orden.save()
    }

    const leida = await Orden.query().where('id_orden', orden.id).preload('detalles').firstOrFail()
    assert.equal(leida.estado, 'entregada')
    assert.lengthOf(leida.detalles, 1)
    assert.equal(leida.detalles[0].volumenTotalMl, 700)
  })

  test('la CLABE se enmascara al serializar, en datos bancarios y en el pago', async ({
    assert,
  }) => {
    const idCap = await capitan()

    const cuenta = await DatosBancarios.create({
      idUsuario: idCap,
      clabe: '012180012345678903',
      banco: 'BBVA',
      titularCuenta: 'Isaac Velasquez',
      activo: true,
    })

    const json = cuenta.serialize()
    assert.equal(json.clabe, '0121…8903')
    assert.notInclude(String(json.clabe), '012345678')
    // El entero de usuario tampoco sale.
    assert.notProperty(json, 'idUsuario')
    assert.notProperty(json, 'id_usuario')
  })

  test('el token del comensal nunca se serializa', async ({ assert }) => {
    const { idCap, evento } = await escenario()
    const mesa = await Mesa.create({
      idEvento: evento.id,
      etiqueta: 'Mesa 9',
      codigoQr: '99999999-9999-4999-8999-999999999999',
    })
    const part = await ParticipacionEvento.create({
      idEvento: evento.id,
      idUsuario: idCap,
      puesto: 'mesero',
      estado: 'vinculo',
      checklistOk: true,
    })

    const cal = await Calificacion.create({
      idMesa: mesa.id,
      idParticipacion: part.id,
      tokenComensal: '55555555-5555-4555-8555-555555555555',
      puntuacion: 5,
      comentario: 'Excelente servicio',
    })

    /**
     * Devolver el token permitiría cruzar calificaciones con el orden de escaneo
     * y deducir quién dijo qué, que es justo lo que el anonimato debe impedir.
     */
    const json = cal.serialize()
    assert.notProperty(json, 'tokenComensal')
    assert.notProperty(json, 'token_comensal')
    assert.equal(json.puntuacion, 5)
  })

  test('el pago enmascara la CLABE de destino', async ({ assert }) => {
    const { idCap, evento } = await escenario()
    const part = await ParticipacionEvento.create({
      idEvento: evento.id,
      idUsuario: idCap,
      puesto: 'mesero',
      estado: 'salida',
      checklistOk: true,
    })

    const pago = await Pago.create({
      idParticipacion: part.id,
      monto: 850,
      clabeDestino: '012180012345678903',
      estado: 'pendiente',
    })

    const json = pago.serialize()
    assert.equal(json.clabe_destino, '0121…8903')
    assert.isNumber((await Pago.findOrFail(pago.id)).monto)
  })
})
