import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { UsuarioService } from '#modules/identidad/services/usuario_service'
import { BitacoraService } from '#modules/admin/services/bitacora_service'
import { DashboardService } from '#modules/dashboard/services/dashboard_service'
import { EventoService } from '#modules/eventos/services/evento_service'
import { ParticipacionService } from '#modules/participaciones/services/participacion_service'
import { CierreService } from '#modules/cierre/services/cierre_service'
import Usuario from '#modules/identidad/models/usuario'
import Salon from '#modules/eventos/models/salon'
import type { SgebError } from '#shared/errors/sgeb_error'

const UUID_ADMIN = '11111111-1111-4111-8111-111111111111'
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

async function semilla() {
  await db.table('usuario').insert([
    { uuid_usuario: UUID_ADMIN, id_rol: 1, nombre: 'Admin', apellido_paterno: 'X', correo: 'a@x.mx', password_hash: 'x'.repeat(60) },
    { uuid_usuario: UUID_CAP, id_rol: 2, nombre: 'Cap', apellido_paterno: 'X', correo: 'c@x.mx', password_hash: 'x'.repeat(60) },
    { uuid_usuario: UUID_MESERO, id_rol: 3, nombre: 'Juan', apellido_paterno: 'Perez', correo: 'm@x.mx', password_hash: 'x'.repeat(60) },
  ])
}

test.group('Usuarios', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function servicio() {
    await semilla()
    return app.container.make(UsuarioService)
  }

  test('el alta NO crea una contraseña utilizable', async ({ assert }) => {
    const s = await servicio()
    const u = await s.crear(
      { idRol: 3, nombre: 'Ana', apellidoPaterno: 'Lopez', correo: 'Ana@X.MX' },
      UUID_ADMIN
    )

    assert.equal(u.correo, 'ana@x.mx')
    assert.match(u.uuidUsuario, /^[0-9a-f-]{36}$/)

    /**
     * Ningún hash Bcrypt empieza así, de modo que nadie puede entrar hasta que
     * el proveedor emita la invitación y el usuario defina la suya.
     */
    const fila = await db.from('usuario').where('id_usuario', u.id).firstOrFail()
    assert.equal(fila.password_hash, '!sin-credencial')
    assert.notMatch(fila.password_hash, /^\$2[aby]\$/)
  })

  test('SGEB-2006: no se dan de alta dos cuentas con el mismo correo', async ({ assert }) => {
    const s = await servicio()
    assert.equal(
      await codigo(() =>
        s.crear({ idRol: 3, nombre: 'Otro', apellidoPaterno: 'Uno', correo: 'm@x.mx' }, UUID_ADMIN)
      ),
      'SGEB-2006'
    )
  })

  test('SGEB-4022: nadie se desactiva a sí mismo', async ({ assert }) => {
    const s = await servicio()

    /** Un admin que se desactiva se deja fuera y a nadie más con permisos. */
    assert.equal(await codigo(() => s.cambiarEstado(UUID_ADMIN, false, UUID_ADMIN)), 'SGEB-4022')
  })

  test('desactivar revoca sesiones, tokens y dispositivos', async ({ assert }) => {
    const s = await servicio()
    const u = await Usuario.query().where('uuid_usuario', UUID_MESERO).firstOrFail()

    await db.table('auth.refresh_token').insert({
      id_usuario: u.id, token_hash: 'a'.repeat(64), cliente: 'movil',
      metodo_login: 'password_2fa', expira_en: DateTime.now().plus({ days: 1 }).toSQL(), revocado: false,
    })
    await db.table('auth.dispositivo_confiable').insert({
      id_usuario: u.id, token_hash: 'b'.repeat(64), plataforma: 'ios',
      expira_en: DateTime.now().plus({ days: 30 }).toSQL(), activo: true,
    })

    await s.cambiarEstado(UUID_MESERO, false, UUID_ADMIN)

    assert.lengthOf(await db.from('auth.refresh_token').where('id_usuario', u.id).where('revocado', false), 0)
    assert.lengthOf(await db.from('auth.dispositivo_confiable').where('id_usuario', u.id).where('activo', true), 0)
    assert.isFalse((await Usuario.findOrFail(u.id)).activo)
  })

  test('el listado filtra por rol y por texto', async ({ assert }) => {
    const s = await servicio()

    const meseros = await s.listar({ rol: 'mesero' })
    assert.lengthOf(meseros, 1)
    assert.equal(meseros[0].correo, 'm@x.mx')

    const porNombre = await s.listar({ q: 'Perez' })
    assert.lengthOf(porNombre, 1)
  })

  // ══════════════════════════════════════════════════════ datos bancarios

  test('SGEB-2005: la CLABE valida su dígito de control', async ({ assert }) => {
    const s = await servicio()

    assert.equal(
      await codigo(() =>
        s.registrarDatosBancarios(
          UUID_MESERO,
          { clabe: '012180012345678903', banco: 'BBVA', titularCuenta: 'Juan Perez' },
          UUID_CAP
        )
      ),
      'SGEB-2005'
    )

    const ok = await s.registrarDatosBancarios(
      UUID_MESERO,
      { clabe: CLABE, banco: 'BBVA', titularCuenta: 'Juan Perez' },
      UUID_CAP
    )
    assert.isTrue(ok.activo)
  })

  test('reemplazar la CLABE desactiva la anterior sin borrarla', async ({ assert }) => {
    const s = await servicio()
    await s.registrarDatosBancarios(UUID_MESERO, { clabe: CLABE, banco: 'BBVA', titularCuenta: 'Juan' }, UUID_CAP)
    await s.registrarDatosBancarios(
      UUID_MESERO,
      { clabe: '002180012345678906', banco: 'Banamex', titularCuenta: 'Juan' },
      UUID_CAP
    )

    const u = await Usuario.query().where('uuid_usuario', UUID_MESERO).firstOrFail()
    const todas = await db.from('datos_bancarios').where('id_usuario', u.id)

    /**
     * Los PAGO históricos conservan el snapshot de la CLABE con la que se
     * dispersaron; borrarla dejaría sin explicación a dónde se fue el dinero.
     */
    assert.lengthOf(todas, 2)
    assert.lengthOf(todas.filter((d) => d.activo), 1)
  })

  test('la CLABE se enmascara al serializar', async ({ assert }) => {
    const s = await servicio()
    await s.registrarDatosBancarios(UUID_MESERO, { clabe: CLABE, banco: 'BBVA', titularCuenta: 'Juan' }, UUID_CAP)

    const d = await s.obtenerDatosBancarios(UUID_MESERO)
    assert.equal(d.serialize().clabe, '0121…8909')
  })

  test('SGEB-4016: no se da de baja una cuenta con pagos pendientes', async ({ assert }) => {
    const s = await servicio()
    await s.registrarDatosBancarios(UUID_MESERO, { clabe: CLABE, banco: 'BBVA', titularCuenta: 'Juan' }, UUID_CAP)

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
    const p = await part.apartar(e.id, UUID_MESERO)
    await db.from('participacion_evento').where('id_participacion', p.id).update({ estado: 'salida' })
    await db.from('evento').where('id_evento', e.id).update({ inicio: DateTime.now().minus({ hours: 5 }).toSQL() })
    await eventos.cambiarEstado(e.id, 'en_curso')
    await eventos.cambiarEstado(e.id, 'finalizado')

    const cierre = await app.container.make(CierreService)
    await cierre.calcularPagos(e.id)

    /**
     * Esos pagos quedarían apuntando a una cuenta que el sistema ya considera
     * inválida, y al dispersar fallarían con SGEB-4012 sin que nadie entienda
     * por qué.
     */
    assert.equal(await codigo(() => s.desactivarDatosBancarios(UUID_MESERO, UUID_CAP)), 'SGEB-4016')
  })
})

test.group('Bitácora', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el alta y la baja de cuenta quedan registradas', async ({ assert }) => {
    await semilla()
    const s = await app.container.make(UsuarioService)

    const u = await s.crear({ idRol: 3, nombre: 'Ana', apellidoPaterno: 'Lopez', correo: 'ana@x.mx' }, UUID_ADMIN)
    await s.cambiarEstado(u.uuidUsuario, false, UUID_ADMIN)

    const bitacora = new BitacoraService()
    const p = await bitacora.listar({ tipoEntidad: 'USUARIO' })
    const acciones = p.all().map((m) => m.accion)

    assert.includeMembers(acciones, ['crear', 'desactivar'])
    assert.equal(p.all()[0].uuidUsuarioResponsable, UUID_ADMIN)
  })

  test('la CLABE también se enmascara en la bitácora', async ({ assert }) => {
    await semilla()
    const s = await app.container.make(UsuarioService)
    await s.registrarDatosBancarios(UUID_MESERO, { clabe: CLABE, banco: 'BBVA', titularCuenta: 'Juan' }, UUID_CAP)

    const p = await new BitacoraService().listar({ tipoEntidad: 'DATOS_BANCARIOS' })

    /** La bitácora se consulta desde el panel: no puede filtrar lo que el modelo oculta. */
    assert.include(p.all()[0].detalle!, '0121…8909')
    assert.notInclude(p.all()[0].detalle!, '12345678')
  })

  test('un fallo al escribir la bitácora no tumba la operación', async ({ assert }) => {
    await semilla()
    const bitacora = new BitacoraService()

    /**
     * Si el capitán desactiva una cuenta y la bitácora falla, la cuenta debe
     * quedar desactivada igual: perder el registro es malo, dejar la cuenta
     * activa es peor.
     */
    await bitacora.registrar({
      tipoEntidad: 'X'.repeat(200), // excede VARCHAR(40): el INSERT falla
      accion: 'crear',
    })
    assert.isTrue(true)
  })

  test('SGEB-2015: el rango de consulta tiene tope', async ({ assert }) => {
    await semilla()
    assert.equal(
      await codigo(() =>
        new BitacoraService().listar({ fechaDesde: '2020-01-01', fechaHasta: '2026-01-01' })
      ),
      'SGEB-2015'
    )
  })

  test('el IP no se serializa: es auditoría interna', async ({ assert }) => {
    await semilla()
    const bitacora = new BitacoraService()
    await bitacora.registrar({ tipoEntidad: 'USUARIO', accion: 'crear', ip: '10.8.0.5' })

    const p = await bitacora.listar({})
    assert.notProperty(p.all()[0].serialize(), 'ip')
  })
})

test.group('Dashboard', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function escenario() {
    await semilla()
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
        cupoMeseros: 5, numMesas: 10, tarifaPorMesero: 850, radioGeocercaM: 150,
      },
      UUID_CAP
    )
    await eventos.agregarMesa(e.id, { etiqueta: 'Mesa 1' })
    await eventos.cambiarEstado(e.id, 'publicado')

    const part = await app.container.make(ParticipacionService)
    const p = await part.apartar(e.id, UUID_MESERO)
    await eventos.cambiarEstado(e.id, 'en_curso')

    return { evento: e, participacion: p, dashboard: await app.container.make(DashboardService) }
  }

  test('el panel del capitán separa en curso, próximos y por cerrar', async ({ assert }) => {
    const { dashboard } = await escenario()
    const r = await dashboard.capitan(UUID_CAP)

    assert.equal(r.totales.en_curso, 1)
    assert.equal(r.totales.por_cerrar, 0)
  })

  test('el panel del mesero dice qué le toca hacer ahora', async ({ assert }) => {
    const { dashboard } = await escenario()
    const r = await dashboard.meseros(UUID_MESERO)

    assert.lengthOf(r.eventos, 1)
    /**
     * En el salón, con el teléfono en una mano y una charola en la otra, nadie
     * navega menús: el campo dice literalmente el siguiente paso.
     */
    assert.equal(r.eventos[0].siguiente_accion, 'Espera a que el capitán confirme tu lugar')
  })

  test('la acción sugerida cambia con el estado de la participación', async ({ assert }) => {
    const { participacion, dashboard } = await escenario()

    await db.from('participacion_evento').where('id_participacion', participacion.id)
      .update({ estado: 'confirmo_llegada', checklist_ok: false })
    let r = await dashboard.meseros(UUID_MESERO)
    assert.equal(r.eventos[0].siguiente_accion, 'Completa el checklist de montaje')

    await db.from('participacion_evento').where('id_participacion', participacion.id)
      .update({ checklist_ok: true })
    r = await dashboard.meseros(UUID_MESERO)
    assert.equal(r.eventos[0].siguiente_accion, 'Espera la asignación de tu mesa')

    await db.from('participacion_evento').where('id_participacion', participacion.id)
      .update({ estado: 'vinculo' })
    r = await dashboard.meseros(UUID_MESERO)
    assert.equal(r.eventos[0].siguiente_accion, 'En servicio')
  })

  test('el dashboard del evento devuelve todas las secciones', async ({ assert }) => {
    const { evento, dashboard } = await escenario()
    const r = await dashboard.evento(evento.id)

    assert.lengthOf(r.fallidas, 0)
    for (const s of ['resumen', 'asistencia', 'montaje', 'piso', 'barra', 'servicio', 'alertas']) {
      assert.property(r.data, s)
    }

    const resumen = r.data.resumen as Record<string, number>
    assert.equal(resumen.cupo_meseros, 5)
    assert.equal(resumen.inscritos, 1)
    assert.equal(resumen.disponibles, 4)
  })

  test('`secciones` pide solo lo que la pantalla necesita', async ({ assert }) => {
    const { evento, dashboard } = await escenario()

    /**
     * El panel del capitán en el salón refresca "barra" y "servicio" cada pocos
     * segundos; no tiene por qué recalcular el cierre cada vez.
     */
    const r = await dashboard.evento(evento.id, ['barra', 'servicio'])

    assert.property(r.data, 'barra')
    assert.property(r.data, 'servicio')
    assert.notProperty(r.data, 'alertas')
    assert.notProperty(r.data, 'montaje')
  })

  test('una sección inválida se ignora en vez de romper', async ({ assert }) => {
    const { evento, dashboard } = await escenario()
    const r = await dashboard.evento(evento.id, ['barra', 'inventada'])

    assert.property(r.data, 'barra')
    assert.notProperty(r.data, 'inventada')
    assert.lengthOf(r.fallidas, 0)
  })

  test('el promedio de calificación es null sin datos, no cero', async ({ assert }) => {
    const { evento, dashboard } = await escenario()
    const r = await dashboard.evento(evento.id, ['servicio'])

    const servicio = r.data.servicio as Record<string, unknown>
    assert.isNull(servicio.promedio_calificacion)
    assert.equal(servicio.calificaciones, 0)
  })
})
