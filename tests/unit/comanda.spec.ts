import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { ComandaService, MAX_BYTES } from '#modules/eventos/services/comanda_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import ComandaEvento from '#modules/eventos/models/comanda_evento'
import Salon from '#modules/eventos/models/salon'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
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

/**
 * Archivo temporal que imita lo que entrega el bodyparser.
 *
 * Se escribe en disco de verdad porque `AlmacenLocal` lo copia con un stream:
 * simular el objeto sin el archivo probaría el validador pero no el flujo.
 */
function archivo(opciones: {
  nombre?: string
  tipo?: string
  bytes?: number
  ext?: string
} = {}): MultipartFile {
  const { nombre = 'comanda.pdf', tipo = 'application/pdf', bytes = 2048, ext = 'pdf' } = opciones

  const dir = app.tmpPath('subidas')
  mkdirSync(dir, { recursive: true })
  const ruta = join(dir, `prueba-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
  writeFileSync(ruta, Buffer.alloc(bytes, 'x'))

  return {
    tmpPath: ruta,
    clientName: nombre,
    extname: ext,
    size: bytes,
    headers: { 'content-type': tipo },
    isValid: true,
    errors: [],
  } as unknown as MultipartFile
}

test.group('Comanda del evento', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function escenario() {
    await db.table('usuario').insert([
      { uuid_usuario: UUID_ADMIN, id_rol: 1, nombre: 'Admin', apellido_paterno: 'X', correo: 'a@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X', correo: 'c@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_CAP2, id_rol: 2, nombre: 'Cap2', apellido_paterno: 'X', correo: 'c2@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_MESERO, id_rol: 3, nombre: 'Juan', apellido_paterno: 'X', correo: 'm@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_AJENO, id_rol: 3, nombre: 'Ana', apellido_paterno: 'X', correo: 'm2@x.mx', password_hash: 'x'.repeat(60) },
    ])

    const sa = await Salon.create({
      nombre: 'Salon', calle: 'Av', cp: '27000', colonia: 'Centro', ciudad: 'Torreon',
      estado: 'Coahuila', latitud: 25.54389, longitud: -103.40632,
      capacidadMaxMesas: 50, capacidadPersonas: 400, activo: true,
    })

    const eventos = await app.container.make(EventoService)
    const fecha = DateTime.now().plus({ days: 1 }).toISODate()!
    const e = await eventos.crear(
      {
        idSalon: sa.id, uuidCapitan: UUID_CAP, titulo: 'XV', tipo: 'social',
        fecha, horaPresentacion: '17:00', inicio: `${fecha}T19:00:00`,
        cupoMeseros: 5, numMesas: 10, tarifaPorMesero: 850, radioGeocercaM: 150,
      },
      UUID_CAP
    )
    await eventos.agregarMesa(e.id, { etiqueta: 'M1' })
    await eventos.cambiarEstado(e.id, 'publicado')

    const part = await app.container.make(ParticipacionService)
    await part.apartar(e.id, UUID_MESERO)

    return { evento: e, comandas: await app.container.make(ComandaService) }
  }

  // ══════════════════════════════════════════════════════════ subida

  test('el capitán sube la comanda y queda vigente', async ({ assert }) => {
    const { evento, comandas } = await escenario()

    const c = await comandas.subir(evento.id, archivo(), UUID_CAP)

    assert.equal(c.nombreOriginal, 'comanda.pdf')
    assert.equal(c.tipoMime, 'application/pdf')
    assert.isTrue(c.activo)
    assert.equal(c.tamanoBytes, 2048)

    /** `EVENTO.comanda_url` guarda la clave del objeto, no una URL pública. */
    const fila = await db.from('evento').where('id_evento', evento.id).firstOrFail()
    assert.equal(fila.comanda_url, c.claveObjeto)
    assert.include(c.claveObjeto, `comandas/${evento.id}/`)
  })

  test('la clave lleva UUID, no el nombre que puso el capitán', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    const c = await comandas.subir(evento.id, archivo({ nombre: 'XV de María.pdf' }), UUID_CAP)

    /**
     * El nombre del capitán puede repetirse entre eventos, y uno adivinable en
     * el bucket haría que la privacidad dependiera solo del ACL.
     */
    assert.notInclude(c.claveObjeto, 'María')
    assert.match(c.claveObjeto, /comandas\/\d+\/[0-9a-f-]{36}\.pdf$/)
  })

  test('acepta imágenes: muchos capitanes reciben la comanda por WhatsApp', async ({ assert }) => {
    const { evento, comandas } = await escenario()

    const c = await comandas.subir(
      evento.id,
      archivo({ nombre: 'IMG_2043.jpg', tipo: 'image/jpeg', ext: 'jpg' }),
      UUID_CAP
    )
    assert.equal(c.tipoMime, 'image/jpeg')
  })

  test('SGEB-2004: rechaza un tipo no permitido', async ({ assert }) => {
    const { evento, comandas } = await escenario()

    assert.equal(
      await codigo(() =>
        comandas.subir(
          evento.id,
          archivo({ nombre: 'comanda.docx', tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' }),
          UUID_CAP
        )
      ),
      'SGEB-2004'
    )
  })

  test('SGEB-2012: rechaza un archivo de más de 10 MB', async ({ assert }) => {
    const { evento, comandas } = await escenario()

    const grande = archivo({ bytes: 1024 })
    /** Se falsea el tamaño para no escribir 10 MB en disco durante la prueba. */
    ;(grande as unknown as { size: number }).size = MAX_BYTES + 1

    assert.equal(await codigo(() => comandas.subir(evento.id, grande, UUID_CAP)), 'SGEB-2012')
  })

  test('SGEB-4013: un evento finalizado no admite comanda nueva', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    await db.from('evento').where('id_evento', evento.id).update({ estado: 'finalizado' })

    assert.equal(await codigo(() => comandas.subir(evento.id, archivo(), UUID_CAP)), 'SGEB-4013')
  })

  // ══════════════════════════════════════════════════════════ reemplazo

  test('reemplazar desactiva la anterior sin borrarla', async ({ assert }) => {
    const { evento, comandas } = await escenario()

    const primera = await comandas.subir(evento.id, archivo({ nombre: 'v1.pdf' }), UUID_CAP)
    const segunda = await comandas.subir(evento.id, archivo({ nombre: 'v2.pdf' }), UUID_CAP)

    /**
     * Si el capitán sube la equivocada a media fiesta, se puede volver. Costaría
     * más un evento servido con la comanda incorrecta que los kilobytes de las
     * versiones viejas.
     */
    const todas = await ComandaEvento.query().where('id_evento', evento.id)
    assert.lengthOf(todas, 2)
    assert.lengthOf(todas.filter((c) => c.activo), 1)

    assert.isFalse((await ComandaEvento.findOrFail(primera.id)).activo)
    assert.isTrue((await ComandaEvento.findOrFail(segunda.id)).activo)
  })

  test('restaurar una versión anterior no re-sube nada', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    const primera = await comandas.subir(evento.id, archivo({ nombre: 'v1.pdf' }), UUID_CAP)
    const claveOriginal = primera.claveObjeto
    await comandas.subir(evento.id, archivo({ nombre: 'v2.pdf' }), UUID_CAP)

    const restaurada = await comandas.restaurar(evento.id, primera.id, UUID_CAP)

    /** El objeto sigue en el bucket: solo cambia cuál está activa. */
    assert.isTrue(restaurada.activo)
    assert.equal(restaurada.claveObjeto, claveOriginal)

    const fila = await db.from('evento').where('id_evento', evento.id).firstOrFail()
    assert.equal(fila.comanda_url, claveOriginal)
    assert.lengthOf(await ComandaEvento.query().where('id_evento', evento.id).where('activo', true), 1)
  })

  test('el historial conserva todas las versiones', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    for (const n of ['v1.pdf', 'v2.pdf', 'v3.pdf']) {
      await comandas.subir(evento.id, archivo({ nombre: n }), UUID_CAP)
    }

    const h = await comandas.historial(evento.id, UUID_CAP, 'capitan')
    assert.lengthOf(h, 3)
    assert.equal(h[0].nombreOriginal, 'v3.pdf')
  })

  test('retirar no reactiva la anterior', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    await comandas.subir(evento.id, archivo({ nombre: 'v1.pdf' }), UUID_CAP)
    await comandas.subir(evento.id, archivo({ nombre: 'v2.pdf' }), UUID_CAP)

    await comandas.retirar(evento.id, UUID_CAP)

    /**
     * Reactivar la anterior sería adivinar la intención del capitán. Queda el
     * evento sin comanda hasta que suba otra o restaure una a propósito.
     */
    assert.lengthOf(await ComandaEvento.query().where('id_evento', evento.id).where('activo', true), 0)

    const fila = await db.from('evento').where('id_evento', evento.id).firstOrFail()
    assert.isNull(fila.comanda_url)
  })

  // ══════════════════════════════════════════════════════════ acceso

  test('el mesero con participación SÍ la ve', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    await comandas.subir(evento.id, archivo(), UUID_CAP)

    const r = await comandas.obtener(evento.id, UUID_MESERO, 'mesero')
    assert.equal(r.comanda.nombreOriginal, 'comanda.pdf')
    assert.isString(r.url)
    assert.isString(r.expira_en)
  })

  test('SGEB-1004: un mesero sin participación NO la ve', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    await comandas.subir(evento.id, archivo(), UUID_CAP)

    /**
     * Con un enlace público, cualquiera que lo consiguiera vería la operación
     * completa de un evento ajeno — y los enlaces se reenvían por WhatsApp sin
     * pensarlo.
     */
    assert.equal(
      await codigo(() => comandas.obtener(evento.id, UUID_AJENO, 'mesero')),
      'SGEB-1004'
    )
  })

  test('SGEB-1004: un capitán ajeno tampoco', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    await comandas.subir(evento.id, archivo(), UUID_CAP)

    assert.equal(await codigo(() => comandas.obtener(evento.id, UUID_CAP2, 'capitan')), 'SGEB-1004')
  })

  test('el admin ve cualquier comanda', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    await comandas.subir(evento.id, archivo(), UUID_CAP)

    const r = await comandas.obtener(evento.id, UUID_ADMIN, 'admin')
    assert.isNotNull(r.comanda)
  })

  test('SGEB-3001: sin comanda subida se dice claramente', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    assert.equal(await codigo(() => comandas.obtener(evento.id, UUID_CAP, 'capitan')), 'SGEB-3001')
  })

  test('la clave del objeto NO se serializa', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    const c = await comandas.subir(evento.id, archivo(), UUID_CAP)

    /**
     * Exponerla permitiría construir peticiones directas al almacenamiento
     * saltándose la verificación de permisos que hace el backend.
     */
    const json = c.serialize()
    assert.notProperty(json, 'claveObjeto')
    assert.notProperty(json, 'clave_objeto')
    assert.notProperty(json, 'idSubidoPor')
    assert.property(json, 'nombre_original')
  })

  test('el contenido se puede leer del almacén', async ({ assert }) => {
    const { evento, comandas } = await escenario()
    await comandas.subir(evento.id, archivo({ bytes: 512 }), UUID_CAP)

    const { datos } = await comandas.contenido(evento.id, UUID_CAP, 'capitan')
    assert.equal(datos.byteLength, 512)
  })
})
