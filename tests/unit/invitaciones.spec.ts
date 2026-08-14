import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { InvitacionService } from '#modules/identidad/services/invitacion_service'
import { CorreoService, type MensajeCorreo } from '#shared/services/correo_service'
import Invitacion from '#modules/identidad/models/invitacion'
import Usuario from '#modules/identidad/models/usuario'
import type { SgebError } from '#shared/errors/sgeb_error'

const UUID_CAP = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const CLABE = '012180012345678909'

async function codigo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_FALLO'
  } catch (e) {
    return (e as SgebError).codigo ?? 'SIN_CODIGO'
  }
}

/** Captura los correos en vez de enviarlos. */
class CorreoEspia extends CorreoService {
  enviados: MensajeCorreo[] = []
  async enviar(m: MensajeCorreo) {
    this.enviados.push(m)
  }
}

test.group('Invitaciones', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => {
    app.container.restore(CorreoService)
  })

  async function escenario() {
    const espia = new CorreoEspia()
    app.container.swap(CorreoService, () => espia)

    await db.table('usuario').insert({
      uuid_usuario: UUID_CAP,
      id_rol: 2,
      nombre: 'Isaac',
      apellido_paterno: 'Velasquez',
      correo: 'cap@x.mx',
      password_hash: 'x'.repeat(60),
    })
    const cap = await Usuario.query().where('uuid_usuario', UUID_CAP).firstOrFail()

    return { cap, espia, servicio: await app.container.make(InvitacionService) }
  }

  const nueva = (correo = 'ana@x.mx') => ({
    idRolDestino: 3,
    nombre: 'Ana',
    apellidoPaterno: 'Lopez',
    correo,
  })

  test('invitar emite el deeplink y manda el correo', async ({ assert }) => {
    const { cap, espia, servicio } = await escenario()

    const r = await servicio.invitar({ ...nueva(), idEmisor: cap.id })

    assert.include(r.deeplink, 'mx.mediocres.sgeb://registro?token=')
    assert.isAbove(r.expiraEn.diff(DateTime.now(), 'hours').hours, 71)

    assert.lengthOf(espia.enviados, 1)
    assert.equal(espia.enviados[0].para, 'ana@x.mx')
    assert.include(espia.enviados[0].texto, r.deeplink)
  })

  test('en la base solo queda el hash del token', async ({ assert }) => {
    const { cap, servicio } = await escenario()
    const r = await servicio.invitar({ ...nueva(), idEmisor: cap.id })

    /**
     * Un volcado de la tabla no permite completar registros ajenos: el valor en
     * claro solo existió en la respuesta y en el correo.
     */
    const fila = await db.from('auth.invitacion').where('correo', 'ana@x.mx').firstOrFail()
    assert.notEqual(fila.token_hash, r.token)
    assert.lengthOf(fila.token_hash, 64)
  })

  test('el listado NUNCA devuelve el token', async ({ assert }) => {
    const { cap, servicio } = await escenario()
    await servicio.invitar({ ...nueva(), idEmisor: cap.id })

    const lista = await servicio.listar({})
    assert.lengthOf(lista, 1)

    /**
     * Quien tenga acceso al panel podría completar el registro de otra persona.
     * El deeplink existe una sola vez.
     */
    const json = JSON.stringify(lista[0])
    assert.notInclude(json, 'token_hash')
    assert.notInclude(json, 'tokenHash')
  })

  test('SSO-4001: no hay dos invitaciones pendientes al mismo correo', async ({ assert }) => {
    const { cap, servicio } = await escenario()
    await servicio.invitar({ ...nueva(), idEmisor: cap.id })

    /**
     * El índice parcial lo garantiza. Sin él, dos capitanes invitan a la misma
     * persona y el mesero termina duplicado en la plantilla.
     */
    assert.equal(
      await codigo(() => servicio.invitar({ ...nueva(), idEmisor: cap.id })),
      'SSO-4001'
    )
  })

  test('SSO-2005: no se invita a un correo que ya tiene cuenta', async ({ assert }) => {
    const { cap, servicio } = await escenario()
    assert.equal(
      await codigo(() => servicio.invitar({ ...nueva('cap@x.mx'), idEmisor: cap.id })),
      'SSO-2005'
    )
  })

  test('revocar libera el correo para poder reinvitar', async ({ assert }) => {
    const { cap, servicio } = await escenario()
    await servicio.invitar({ ...nueva(), idEmisor: cap.id })
    const inv = await Invitacion.query().where('correo', 'ana@x.mx').firstOrFail()

    await servicio.revocar(inv.id, UUID_CAP)
    assert.equal((await Invitacion.findOrFail(inv.id)).estado, 'revocada')

    /** El índice parcial solo cuenta las pendientes, así que ya se puede repetir. */
    const otra = await servicio.invitar({ ...nueva(), idEmisor: cap.id })
    assert.isString(otra.deeplink)
  })

  test('revocar es idempotente y no toca las ya usadas', async ({ assert }) => {
    const { cap, servicio } = await escenario()
    const r = await servicio.invitar({ ...nueva(), idEmisor: cap.id })
    const inv = await Invitacion.query().where('correo', 'ana@x.mx').firstOrFail()

    await servicio.revocar(inv.id, UUID_CAP)
    await servicio.revocar(inv.id, UUID_CAP)
    assert.equal((await Invitacion.findOrFail(inv.id)).estado, 'revocada')

    /** Una usada ya creó la cuenta: revocarla no la desharía y confundiría. */
    const otra = await servicio.invitar({ ...nueva('bea@x.mx'), idEmisor: cap.id })
    await servicio.registrar({
      token: otra.token,
      password: 'Mesero2026',
      password2: 'Mesero2026',
      clabe: CLABE,
      banco: 'BBVA',
      titular: 'Bea Lopez',
      aceptaPrivacidad: true,
    })
    const usada = await Invitacion.query().where('correo', 'bea@x.mx').firstOrFail()
    assert.equal(await codigo(() => servicio.revocar(usada.id, UUID_CAP)), 'SSO-3002')
    void r
  })

  test('reenviar emite un token nuevo e invalida el anterior', async ({ assert }) => {
    const { cap, espia, servicio } = await escenario()
    const primera = await servicio.invitar({ ...nueva(), idEmisor: cap.id })
    const inv = await Invitacion.query().where('correo', 'ana@x.mx').firstOrFail()

    const segunda = await servicio.reenviar(inv.id, UUID_CAP)

    assert.notEqual(segunda.token, primera.token)
    assert.lengthOf(espia.enviados, 2)

    /**
     * Si el correo no llegó, el token viejo seguiría vivo 72 horas.
     * Reemplazarlo cierra esa ventana y reinicia el plazo.
     */
    assert.equal(await codigo(() => servicio.leer(primera.token)), 'SSO-3002')
    const inv2 = await servicio.leer(segunda.token)
    assert.equal(inv2.correo, 'ana@x.mx')
  })

  test('reenviar conserva los datos de la persona', async ({ assert }) => {
    const { cap, servicio } = await escenario()
    await servicio.invitar({
      idEmisor: cap.id,
      idRolDestino: 3,
      nombre: 'Ana',
      apellidoPaterno: 'Lopez',
      apellidoMaterno: 'Ruiz',
      correo: 'ana@x.mx',
    })
    const inv = await Invitacion.query().where('correo', 'ana@x.mx').firstOrFail()

    const r = await servicio.reenviar(inv.id, UUID_CAP)
    const nuevaInv = await servicio.leer(r.token)

    assert.equal(nuevaInv.nombre, 'Ana')
    assert.equal(nuevaInv.apellidoMaterno, 'Ruiz')
    assert.equal(nuevaInv.idRolDestino, 3)
  })

  test('el listado deriva `expirada` sin persistirla', async ({ assert }) => {
    const { cap, servicio } = await escenario()
    await servicio.invitar({ ...nueva(), idEmisor: cap.id })

    await db
      .from('auth.invitacion')
      .where('correo', 'ana@x.mx')
      .update({ expira_en: DateTime.now().minus({ hours: 1 }).toSQL() })

    /**
     * El estado se calcula con una comparación de fechas. Persistirlo exigiría
     * una tarea que recorriera la tabla marcándolas: un proceso más que
     * mantener para un dato derivable.
     */
    const lista = await servicio.listar({})
    assert.equal(lista[0].estado, 'expirada')

    const fila = await db.from('auth.invitacion').where('correo', 'ana@x.mx').firstOrFail()
    assert.equal(fila.estado, 'pendiente')
  })

  test('el listado filtra por emisor: el capitán ve las suyas', async ({ assert }) => {
    const { cap, servicio } = await escenario()
    await servicio.invitar({ ...nueva(), idEmisor: cap.id })

    const otro = 'cc2a9c14-8b7e-4d61-9a03-2c5e77b1d843'
    await db.table('usuario').insert({
      uuid_usuario: otro, id_rol: 2, nombre: 'Otro', apellido_paterno: 'Cap',
      correo: 'cap2@x.mx', password_hash: 'x'.repeat(60),
    })
    const cap2 = await Usuario.query().where('uuid_usuario', otro).firstOrFail()
    await servicio.invitar({ ...nueva('bea@x.mx'), idEmisor: cap2.id })

    assert.lengthOf(await servicio.listar({ idEmisor: cap.id }), 1)
    assert.lengthOf(await servicio.listar({}), 2)
  })
})
