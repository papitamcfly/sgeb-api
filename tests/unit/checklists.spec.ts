import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { ChecklistService } from '#modules/checklists/services/checklist_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import ParticipacionEvento from '#modules/participaciones/models/participacion_evento'
import Salon from '#modules/eventos/models/salon'
import type { SgebError } from '#shared/errors/sgeb_error'

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

const ITEMS_MONTAJE = [
  { descripcion: 'Colocar mantelería', cantidadEsperada: 20, orden: 1 },
  { descripcion: 'Acomodar cubiertos', cantidadEsperada: 20, orden: 2 },
  { descripcion: 'Revisar copas', cantidadEsperada: 80, orden: 3 },
]

test.group('Checklists', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function escenario() {
    await db.table('usuario').insert([
      { uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X', correo: 'c@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_MESERO, id_rol: 3, nombre: 'Mesero', apellido_paterno: 'X', correo: 'm@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_OTRO, id_rol: 3, nombre: 'Otro', apellido_paterno: 'X', correo: 'm2@x.mx', password_hash: 'x'.repeat(60) },
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
    for (const s of ['seleccionado', 'confirmo_asistencia', 'confirmo_llegada'] as const) {
      await part.cambiarEstado(p.id, s)
    }

    return { evento: e, mesa, participacion: p, part, checklists: await app.container.make(ChecklistService) }
  }

  // ══════════════════════════════════════════════════════════ plantillas

  test('crear una plantilla con sus ítems', async ({ assert }) => {
    const { checklists } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje de salón', tipo: 'montaje', items: ITEMS_MONTAJE })

    assert.equal(c.tipo, 'montaje')
    assert.lengthOf(c.items, 3)
    assert.equal(c.items[0].descripcion, 'Colocar mantelería')
  })

  test('una plantilla sin ítems no sirve para nada', async ({ assert }) => {
    const { checklists } = await escenario()
    assert.equal(
      await codigo(() => checklists.crear({ nombre: 'Vacío', tipo: 'montaje', items: [] })),
      'SGEB-2001'
    )
  })

  test('editar la plantilla da de baja los ítems viejos, no los borra', async ({ assert }) => {
    const { checklists } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })

    await checklists.actualizar(c.id, {
      nombre: 'Montaje v2',
      tipo: 'montaje',
      items: [{ descripcion: 'Solo mantelería', cantidadEsperada: 20, orden: 1 }],
    })

    /**
     * Las CHECKLIST_RESPUESTA históricas apuntan a los ítems viejos: borrarlos
     * dejaría reportes de montaje sin poder decir qué se revisó.
     */
    const todos = await db.from('checklist_item').where('id_checklist', c.id)
    assert.lengthOf(todos, 4)
    assert.lengthOf(todos.filter((i) => i.activo), 1)
  })

  test('SGEB-4017: no se edita la plantilla con instancias abiertas en eventos vigentes', async ({
    assert,
  }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    await checklists.instanciar(participacion.id, c.id)

    /**
     * Un mesero podría estar a media revisión y ver cómo le cambian las tareas
     * bajo los pies.
     */
    assert.equal(
      await codigo(() =>
        checklists.actualizar(c.id, { nombre: 'Otro', tipo: 'montaje', items: ITEMS_MONTAJE })
      ),
      'SGEB-4017'
    )
  })

  test('SGEB-4016: no se desactiva una plantilla con instancias sin completar', async ({
    assert,
  }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    await checklists.instanciar(participacion.id, c.id)

    assert.equal(await codigo(() => checklists.desactivar(c.id)), 'SGEB-4016')
  })

  // ══════════════════════════════════════════════════════════ instancias

  test('instanciar crea las respuestas en cero de una vez', async ({ assert }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })

    const inst = await checklists.instanciar(participacion.id, c.id)

    /**
     * Así la pantalla pinta la lista completa desde el primer momento y el
     * conteo de "faltan 3 de 12" es exacto sin consultar la plantilla aparte.
     */
    assert.lengthOf(inst.respuestas, 3)
    assert.isTrue(inst.respuestas.every((r) => r.cantidad === 0 && !r.hecho))
    assert.isFalse(inst.completado)
  })

  test('instanciar es idempotente: refrescar la pantalla no duplica', async ({ assert }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })

    const a = await checklists.instanciar(participacion.id, c.id)
    const b = await checklists.instanciar(participacion.id, c.id)

    /** El capitán vería el mismo checklist tres veces sin saber cuál aprobar. */
    assert.equal(a.id, b.id)
    assert.lengthOf(await db.from('checklist_instancia').where('id_participacion', participacion.id), 1)
  })

  test('el servidor calcula `completado`, no el cliente', async ({ assert }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    const inst = await checklists.instanciar(participacion.id, c.id)
    const items = await db.from('checklist_item').where('id_checklist', c.id).orderBy('orden')

    const parcial = await checklists.responder(inst.id, [
      { idItem: items[0].id_item, cantidad: 20, hecho: true },
    ], UUID_MESERO)
    assert.isFalse(parcial.instancia.completado)
    assert.equal(parcial.pendientes, 2)

    const total = await checklists.responder(inst.id, [
      { idItem: items[1].id_item, cantidad: 20, hecho: true },
      { idItem: items[2].id_item, cantidad: 80, hecho: true },
    ], UUID_MESERO)

    /**
     * Si la app pudiera declarar `completado`, bastaría con enviar `true` para
     * saltarse el montaje entero.
     */
    assert.isTrue(total.instancia.completado)
    assert.equal(total.pendientes, 0)
  })

  test('SGEB-1004: un mesero no llena el checklist de otro', async ({ assert }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    const inst = await checklists.instanciar(participacion.id, c.id)
    const items = await db.from('checklist_item').where('id_checklist', c.id).orderBy('orden')

    /**
     * Sin esta comprobación, cualquier mesero podía llenar el checklist ajeno y
     * desbloquearle la asignación de mesas sin haber montado nada: el capitán
     * aprobaría un montaje que su autor nunca revisó.
     */
    assert.equal(
      await codigo(() =>
        checklists.responder(
          inst.id,
          [{ idItem: items[0].id_item, cantidad: 20, hecho: true }],
          UUID_OTRO
        )
      ),
      'SGEB-1004'
    )
  })

  test('SGEB-2012: la cantidad no excede lo esperado', async ({ assert }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    const inst = await checklists.instanciar(participacion.id, c.id)
    const items = await db.from('checklist_item').where('id_checklist', c.id).orderBy('orden')

    assert.equal(
      await codigo(() =>
        checklists.responder(
          inst.id,
          [{ idItem: items[0].id_item, cantidad: 99, hecho: true }],
          UUID_MESERO
        )
      ),
      'SGEB-2012'
    )
  })

  test('SGEB-3002: no se responde un ítem de otra plantilla', async ({ assert }) => {
    const { checklists, participacion } = await escenario()
    const a = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    const b = await checklists.crear({
      nombre: 'Cierre', tipo: 'cierre',
      items: [{ descripcion: 'Recoger loza', cantidadEsperada: 5, orden: 1 }],
    })
    const inst = await checklists.instanciar(participacion.id, a.id)
    const itemAjeno = await db.from('checklist_item').where('id_checklist', b.id).firstOrFail()

    assert.equal(
      await codigo(() =>
        checklists.responder(inst.id, [{ idItem: itemAjeno.id_item, cantidad: 1, hecho: true }], UUID_MESERO)
      ),
      'SGEB-3002'
    )
  })

  // ══════════════════════════════════════════════════════════ aprobación

  test('SGEB-4005: no se aprueba un montaje incompleto', async ({ assert }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    const inst = await checklists.instanciar(participacion.id, c.id)

    assert.equal(await codigo(() => checklists.aprobar(inst.id)), 'SGEB-4005')
  })

  test('aprobar el montaje desbloquea la asignación de mesas', async ({ assert }) => {
    const { checklists, participacion, part, mesa } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    const inst = await checklists.instanciar(participacion.id, c.id)
    const items = await db.from('checklist_item').where('id_checklist', c.id).orderBy('orden')

    /** Antes de aprobar, la asignación está bloqueada (SGEB-4005). */
    assert.equal(await codigo(() => part.asignarMesa(participacion.id, mesa.id)), 'SGEB-4005')

    await checklists.responder(
      inst.id,
      items.map((i) => ({ idItem: i.id_item, cantidad: i.cantidad_esperada, hecho: true })),
      UUID_MESERO
    )

    /**
     * La aprobación es del capitán y no automática: que el mesero marque las
     * casillas dice que él cree haber terminado; quien verifica es otra persona.
     */
    const sinAprobar = await ParticipacionEvento.findOrFail(participacion.id)
    assert.isFalse(sinAprobar.checklistOk)

    const r = await checklists.aprobar(inst.id)
    assert.isTrue(r.desbloquea_asignacion)

    const aprobada = await ParticipacionEvento.findOrFail(participacion.id)
    assert.isTrue(aprobada.checklistOk)

    const asignacion = await part.asignarMesa(participacion.id, mesa.id)
    assert.equal(asignacion.idMesa, mesa.id)
  })

  test('solo el checklist de montaje desbloquea la asignación', async ({ assert }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({
      nombre: 'Cierre de turno', tipo: 'cierre',
      items: [{ descripcion: 'Recoger loza', cantidadEsperada: 5, orden: 1 }],
    })
    const inst = await checklists.instanciar(participacion.id, c.id)
    const item = await db.from('checklist_item').where('id_checklist', c.id).firstOrFail()

    await checklists.responder(inst.id, [{ idItem: item.id_item, cantidad: 5, hecho: true }], UUID_MESERO)
    const r = await checklists.aprobar(inst.id)

    /** El de cierre alimenta el bloqueo de pagos por otra vía, no `checklist_ok`. */
    assert.isFalse(r.desbloquea_asignacion)
    assert.isFalse((await ParticipacionEvento.findOrFail(participacion.id)).checklistOk)
  })

  test('una instancia ya aprobada no se reabre', async ({ assert }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    const inst = await checklists.instanciar(participacion.id, c.id)
    const items = await db.from('checklist_item').where('id_checklist', c.id).orderBy('orden')

    await checklists.responder(
      inst.id,
      items.map((i) => ({ idItem: i.id_item, cantidad: i.cantidad_esperada, hecho: true })),
      UUID_MESERO
    )
    await checklists.aprobar(inst.id)

    /**
     * Permitir editar después dejaría al mesero atendiendo mesas con un montaje
     * que ya no coincide con lo que el capitán aprobó.
     */
    assert.equal(
      await codigo(() =>
        checklists.responder(inst.id, [{ idItem: items[0].id_item, cantidad: 0, hecho: false }], UUID_MESERO)
      ),
      'SGEB-4011'
    )
  })

  test('el readback de asignaciones resuelve mesa y mesero', async ({ assert }) => {
    const { checklists, participacion, part, mesa, evento } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    const inst = await checklists.instanciar(participacion.id, c.id)
    const items = await db.from('checklist_item').where('id_checklist', c.id).orderBy('orden')
    await checklists.responder(
      inst.id,
      items.map((i) => ({ idItem: i.id_item, cantidad: i.cantidad_esperada, hecho: true })),
      UUID_MESERO
    )
    await checklists.aprobar(inst.id)
    await part.asignarMesa(participacion.id, mesa.id)

    /**
     * Sin esto el panel de piso sabía asignar y vincular, pero no reconstruir su
     * estado tras una recarga.
     */
    const filas = await part.listarAsignaciones(evento.id)
    assert.lengthOf(filas, 1)
    assert.equal(filas[0].mesa.etiqueta, 'Mesa 1')
    assert.equal(filas[0].participacion.usuario.uuidUsuario, UUID_MESERO)
    assert.isFalse(filas[0].vinculada)

    await part.vincularMesa(filas[0].id, mesa.codigoQr, UUID_MESERO)
    const vinculadas = await part.listarAsignaciones(evento.id, { vinculada: true })
    assert.lengthOf(vinculadas, 1)
  })

  test('desmarcar un ítem antes de aprobar vuelve la instancia a incompleta', async ({ assert }) => {
    const { checklists, participacion } = await escenario()
    const c = await checklists.crear({ nombre: 'Montaje', tipo: 'montaje', items: ITEMS_MONTAJE })
    const inst = await checklists.instanciar(participacion.id, c.id)
    const items = await db.from('checklist_item').where('id_checklist', c.id).orderBy('orden')

    await checklists.responder(
      inst.id,
      items.map((i) => ({ idItem: i.id_item, cantidad: i.cantidad_esperada, hecho: true })),
      UUID_MESERO
    )
    const r = await checklists.responder(inst.id, [
      { idItem: items[0].id_item, cantidad: 10, hecho: false },
    ], UUID_MESERO)

    assert.isFalse(r.instancia.completado)
    assert.equal(r.pendientes, 1)
  })
})
