import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  CorreoService,
  CorreoLog,
  type MensajeCorreo,
} from '#shared/services/correo_service'
import { PushService, PushLog, type MensajePush, type ResultadoPush } from '#shared/services/push_service'
import { CredencialesService } from '#modules/identidad/services/credenciales_service'
import { InvitacionService } from '#modules/identidad/services/invitacion_service'
import { RecuperacionService } from '#modules/identidad/services/recuperacion_service'
import { CronogramaService } from '#modules/eventos/services/cronograma_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import Usuario from '#modules/identidad/models/usuario'
import Salon from '#modules/eventos/models/salon'

/**
 * Correo y push.
 *
 * Los transportes reales no se prueban aquí —requerirían credenciales de
 * Mailtrap y Firebase— pero sí todo lo que los rodea: que el mensaje se arme
 * bien, que se escape lo que viene de la base, y que un fallo del proveedor no
 * tumbe la operación que lo generó.
 */

const UUID_CAP = '3f2a9c14-8b7e-4d61-9a03-2c5e77b1d840'
const UUID_MESERO = 'aa2a9c14-8b7e-4d61-9a03-2c5e77b1d841'

/** Captura los mensajes en vez de enviarlos, para poder afirmar sobre ellos. */
class CorreoEspia extends CorreoService {
  enviados: MensajeCorreo[] = []
  async enviar(m: MensajeCorreo) {
    this.enviados.push(m)
  }
}

/** Simula un proveedor caído. */
class CorreoRoto extends CorreoService {
  async enviar(): Promise<void> {
    throw new Error('SMTP timeout')
  }
}

class PushEspia extends PushService {
  enviados: MensajePush[] = []
  async enviar(m: MensajePush): Promise<ResultadoPush> {
    this.enviados.push(m)
    return { enviados: m.tokens.length, fallidos: 0, tokensInvalidos: [] }
  }
}

test.group('Correo', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => {
    app.container.restore(CorreoService)
  })

  async function espia(): Promise<CorreoEspia> {
    const c = new CorreoEspia()
    app.container.swap(CorreoService, () => c)
    return c
  }

  async function usuario(): Promise<Usuario> {
    await db.table('usuario').insert({
      uuid_usuario: UUID_MESERO,
      id_rol: 3,
      nombre: 'Juan',
      apellido_paterno: 'Perez',
      correo: 'juan@x.mx',
      password_hash: 'x'.repeat(60),
    })
    return Usuario.query().where('uuid_usuario', UUID_MESERO).preload('rol').firstOrFail()
  }

  test('el código 2FA se envía por correo y NO viaja en el asunto de forma ambigua', async ({
    assert,
  }) => {
    const c = await espia()
    const u = await usuario()

    const codigo = await (await app.container.make(CredencialesService)).emitirCodigo(u, 'login')

    assert.lengthOf(c.enviados, 1)
    assert.equal(c.enviados[0].para, 'juan@x.mx')
    assert.include(c.enviados[0].texto, codigo)

    /**
     * El código va en el asunto a propósito: es lo que permite leerlo desde la
     * notificación del teléfono sin abrir el correo, que es como lo usa la gente.
     */
    assert.include(c.enviados[0].asunto, codigo)
    assert.include(c.enviados[0].texto, '10 minutos')
  })

  test('todo correo lleva versión en texto plano, no solo HTML', async ({ assert }) => {
    const c = await espia()
    const u = await usuario()
    await (await app.container.make(CredencialesService)).emitirCodigo(u, 'login')

    /** Es lo que se ve en un reloj o en un cliente sin HTML. */
    assert.isString(c.enviados[0].texto)
    assert.isAbove(c.enviados[0].texto.length, 20)
  })

  test('el nombre del invitado se escapa: lo captura el capitán', async ({ assert }) => {
    const c = await espia()
    await db.table('usuario').insert({
      uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X',
      correo: 'cap@x.mx', password_hash: 'x'.repeat(60),
    })
    const cap = await Usuario.query().where('uuid_usuario', UUID_CAP).firstOrFail()

    await (await app.container.make(InvitacionService)).invitar({
      idEmisor: cap.id,
      idRolDestino: 3,
      nombre: '<script>alert(1)</script>',
      apellidoPaterno: 'Lopez',
      correo: 'ana@x.mx',
    })

    /**
     * El nombre lo captura el capitán al invitar. Sin escapar sería inyección de
     * HTML en el correo de otra persona.
     */
    assert.notInclude(c.enviados[0].html!, '<script>alert(1)</script>')
    assert.include(c.enviados[0].html!, '&lt;script&gt;')
  })

  test('la invitación lleva el deeplink, no una URL web', async ({ assert }) => {
    const c = await espia()
    await db.table('usuario').insert({
      uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X',
      correo: 'cap@x.mx', password_hash: 'x'.repeat(60),
    })
    const cap = await Usuario.query().where('uuid_usuario', UUID_CAP).firstOrFail()

    const { deeplink } = await (await app.container.make(InvitacionService)).invitar({
      idEmisor: cap.id, idRolDestino: 3, nombre: 'Ana', apellidoPaterno: 'Lopez', correo: 'ana@x.mx',
    })

    assert.include(c.enviados[0].texto, deeplink)
    assert.include(deeplink, 'mx.mediocres.sgeb://registro?token=')
    assert.include(c.enviados[0].texto, '72 horas')
  })

  test('el correo de recuperación advierte que se cerrarán las sesiones', async ({ assert }) => {
    const c = await espia()
    const u = await usuario()
    await db.from('usuario').where('id_usuario', u.id).update({ password_hash: 'x'.repeat(60) })

    await (await app.container.make(RecuperacionService)).solicitar('juan@x.mx')

    assert.lengthOf(c.enviados, 1)
    /** Es una consecuencia que el usuario debe conocer antes de usar el enlace. */
    assert.include(c.enviados[0].texto, 'sesiones')
    assert.include(c.enviados[0].texto, '30 minutos')
  })

  test('un correo inexistente NO dispara envío', async ({ assert }) => {
    const c = await espia()
    await usuario()

    await (await app.container.make(RecuperacionService)).solicitar('nadie@x.mx')

    /** Y aun así la respuesta al usuario es idéntica (SSO-0002). */
    assert.lengthOf(c.enviados, 0)
  })

  test('SSO-5003: un fallo del proveedor NO borra el código ya guardado', async ({ assert }) => {
    app.container.swap(CorreoService, () => new CorreoRoto())
    const u = await usuario()

    let codigo: string | null = null
    try {
      await (await app.container.make(CredencialesService)).emitirCodigo(u, 'login')
    } catch {
      codigo = 'fallo'
    }

    /**
     * El envío ocurre FUERA de la transacción que guardó el código. Si fallara
     * dentro, el rollback lo borraría y el usuario recibiría un error genérico;
     * así el código queda guardado y el fallo se reporta como problema de envío,
     * que le dice al usuario que reintente en vez de recapturar credenciales.
     */
    assert.isNotNull(codigo)
    const filas = await db.from('auth.codigo_verificacion').where('id_usuario', u.id)
    assert.lengthOf(filas, 1)
    assert.isFalse(filas[0].usado)
  })

  test('el transporte de log no lanza: permite desarrollar sin servidor de correo', async ({
    assert,
  }) => {
    const log = new CorreoLog()
    await log.codigoVerificacion('juan@x.mx', '123456')
    await log.invitacion('ana@x.mx', 'Ana', 'mx.mediocres.sgeb://registro?token=x')
    await log.recuperacion('juan@x.mx', 'https://auth.sgeb.mediocres.mx/x')
    assert.isTrue(true)
  })
})

test.group('Push', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => {
    app.container.restore(PushService)
  })

  async function escenario() {
    await db.table('usuario').insert([
      { uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X', correo: 'c@x.mx', password_hash: 'x'.repeat(60) },
      { uuid_usuario: UUID_MESERO, id_rol: 3, nombre: 'Juan', apellido_paterno: 'X', correo: 'm@x.mx', password_hash: 'x'.repeat(60) },
    ])

    const sa = await Salon.create({
      nombre: 'Salon', calle: 'Av', cp: '27000', colonia: 'Centro', ciudad: 'Torreon',
      estado: 'Coahuila', latitud: 25.54389, longitud: -103.40632,
      capacidadMaxMesas: 50, capacidadPersonas: 400, activo: true,
    })
    const eventos = await app.container.make(EventoService)
    const fecha = DateTime.now().toISODate()!
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
    const p = await part.apartar(e.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', p.id).update({ estado: 'vinculo' })
    await eventos.cambiarEstado(e.id, 'en_curso')

    const u = await Usuario.query().where('uuid_usuario', UUID_MESERO).firstOrFail()
    return { evento: e, participacion: p, idMesero: u.id }
  }

  test('registrar el token es idempotente', async ({ assert }) => {
    const { idMesero } = await escenario()
    const push = new PushLog()

    await push.registrarDispositivo({ idUsuario: idMesero, token: 't'.repeat(40), plataforma: 'ios' })
    await push.registrarDispositivo({ idUsuario: idMesero, token: 't'.repeat(40), plataforma: 'ios' })

    /**
     * La app lo reenvía en cada arranque porque el sistema puede rotarlo.
     * Acumular filas mandaría la misma notificación varias veces al mismo
     * teléfono.
     */
    const filas = await db.from('dispositivo_push').where('id_usuario', idMesero)
    assert.lengthOf(filas, 1)
  })

  test('reactivar un token dado de baja no crea otro registro', async ({ assert }) => {
    const { idMesero } = await escenario()
    const push = new PushLog()
    const token = 't'.repeat(40)

    await push.registrarDispositivo({ idUsuario: idMesero, token, plataforma: 'ios' })
    await db.from('dispositivo_push').where('token', token).update({ activo: false })
    await push.registrarDispositivo({ idUsuario: idMesero, token, plataforma: 'ios' })

    const filas = await db.from('dispositivo_push').where('token', token)
    assert.lengthOf(filas, 1)
    assert.isTrue(filas[0].activo)
  })

  test('el hito del cronograma envía push a los dispositivos en piso', async ({ assert }) => {
    const espia = new PushEspia()
    app.container.swap(PushService, () => espia)

    const { evento, idMesero } = await escenario()
    await new PushLog().registrarDispositivo({
      idUsuario: idMesero, token: 't'.repeat(40), plataforma: 'ios',
    })

    const cronograma = await app.container.make(CronogramaService)
    const h = await cronograma.crear(evento.id, { tipoTiempo: 'FUERTE', horaObjetivo: '21:00' })
    await cronograma.disparar(h.id)

    assert.lengthOf(espia.enviados, 1)
    assert.lengthOf(espia.enviados[0].tokens, 1)
    assert.equal(espia.enviados[0].cuerpo, 'Sirvan el plato fuerte')
    /** Carga silenciosa para que la app navegue al abrir la notificación. */
    assert.equal(espia.enviados[0].datos?.tipo, 'TIEMPO_COMIDA')
  })

  test('sin dispositivos registrados no se intenta enviar', async ({ assert }) => {
    const espia = new PushEspia()
    app.container.swap(PushService, () => espia)

    const { evento } = await escenario()
    const cronograma = await app.container.make(CronogramaService)
    const h = await cronograma.crear(evento.id, { tipoTiempo: 'ENTRADA', horaObjetivo: '20:00' })
    await cronograma.disparar(h.id)

    assert.lengthOf(espia.enviados, 0)
  })

  test('un fallo del push NO deshace el hito ya disparado', async ({ assert }) => {
    /**
     * Si lanzara, el rollback desharía la marca y el siguiente ciclo volvería a
     * notificar a todos los que sí recibieron. Peor que no avisar es avisar de
     * más.
     */
    class PushRoto extends PushService {
      async enviar(): Promise<ResultadoPush> {
        return { enviados: 0, fallidos: 1, tokensInvalidos: [] }
      }
    }
    app.container.swap(PushService, () => new PushRoto())

    const { evento, idMesero } = await escenario()
    await new PushLog().registrarDispositivo({
      idUsuario: idMesero, token: 't'.repeat(40), plataforma: 'ios',
    })

    const cronograma = await app.container.make(CronogramaService)
    const h = await cronograma.crear(evento.id, { tipoTiempo: 'POSTRE', horaObjetivo: '22:00' })

    assert.isTrue(await cronograma.disparar(h.id))

    const fila = await db.from('cronograma_evento').where('id_cronograma', h.id).firstOrFail()
    assert.isTrue(fila.disparado)

    /** Y la notificación quedó en la base: el mesero la ve al abrir la app. */
    assert.lengthOf(await db.from('notificacion').where('id_cronograma', h.id), 1)
  })

  test('los tokens muertos se dan de baja solos', async ({ assert }) => {
    const { idMesero } = await escenario()
    const token = 't'.repeat(40)
    await new PushLog().registrarDispositivo({ idUsuario: idMesero, token, plataforma: 'ios' })

    /**
     * Un token muerto —la app se desinstaló, o el sistema lo rotó— se da de baja
     * en cuanto el proveedor lo reporta. Si no, la tabla acumula destinos que
     * fallan en cada envío y el conteo de "fallidos" deja de significar nada.
     */
    class PushConTokenMuerto extends PushService {
      async enviar(m: MensajePush): Promise<ResultadoPush> {
        return { enviados: 0, fallidos: 1, tokensInvalidos: m.tokens }
      }
    }

    const p = new PushConTokenMuerto()
    const parts = await db.from('participacion_evento').where('id_usuario', idMesero).select('id_participacion')
    await p.aParticipaciones(parts.map((x) => x.id_participacion), 'T', 'C')

    const fila = await db.from('dispositivo_push').where('token', token).firstOrFail()
    assert.isFalse(fila.activo)
  })
})
