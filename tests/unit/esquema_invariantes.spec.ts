import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * Invariantes que impone la BASE DE DATOS, no la aplicación.
 *
 * Van en la base porque una regla que solo vive en el código se salta desde una
 * consola de psql, desde un script de migración de datos o desde un endpoint
 * que alguien escriba sin conocerla. Estas pruebas existen para que nadie las
 * quite "porque estorban" sin que el CI se ponga en rojo.
 */

/**
 * Ejecuta algo que DEBE fallar, sin matar la transacción de la prueba.
 *
 * PostgreSQL aborta la transacción completa al primer error: cualquier consulta
 * posterior responde "current transaction is aborted". Como cada prueba corre
 * dentro de una transacción global que se revierte al final, una violación
 * esperada dejaría inservible el resto del caso.
 *
 * El SAVEPOINT acota el daño: si la operación falla, se vuelve al punto previo
 * y la transacción sigue viva. Es el mismo patrón que necesita la aplicación
 * cuando quiere intentar un INSERT y reaccionar al duplicado sin abortar todo.
 */
async function debeFallar(fn: () => Promise<unknown>): Promise<boolean> {
  await db.rawQuery('SAVEPOINT prueba_invariante')
  try {
    await fn()
    await db.rawQuery('RELEASE SAVEPOINT prueba_invariante')
    return false
  } catch {
    await db.rawQuery('ROLLBACK TO SAVEPOINT prueba_invariante')
    return true
  }
}

test.group('Invariantes del esquema', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function semilla() {
    const [cap] = await db
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
    const [mes] = await db
      .table('usuario')
      .returning('id_usuario')
      .insert({
        uuid_usuario: 'aa2a9c14-8b7e-4d61-9a03-2c5e77b1d841',
        id_rol: 3,
        nombre: 'Juan',
        apellido_paterno: 'Perez',
        correo: 'mesero@x.mx',
        password_hash: 'b'.repeat(60),
      })
    const [salon] = await db
      .table('salon')
      .returning('id_salon')
      .insert({
        nombre: 'Salon Galeana',
        calle: 'Av Morelos',
        cp: '27000',
        colonia: 'Centro',
        ciudad: 'Torreon',
        estado: 'Coahuila',
        latitud: 25.54389,
        longitud: -103.40632, // Torreón: 3 dígitos enteros
        capacidad_max_mesas: 50,
        capacidad_personas: 400,
      })
    const [evento] = await db
      .table('evento')
      .returning('id_evento')
      .insert({
        id_salon: salon.id_salon,
        id_capitan: cap.id_usuario,
        id_usuario_creador: cap.id_usuario,
        titulo: 'XV de Maria',
        tipo: 'social',
        fecha: '2026-09-15',
        hora_presentacion: '17:00',
        inicio: '2026-09-15 19:00',
        cupo_meseros: 10,
        num_mesas: 20,
        tarifa_por_mesero: 850,
        radio_geocerca_m: 150,
      })
    return {
      idCapitan: cap.id_usuario,
      idMesero: mes.id_usuario,
      idSalon: salon.id_salon,
      idEvento: evento.id_evento,
    }
  }

  test('un mesero no puede apartar dos veces el mismo evento', async ({ assert }) => {
    const { idEvento, idMesero } = await semilla()
    const fila = { id_evento: idEvento, id_usuario: idMesero, estado: 'aparto' }

    await db.table('participacion_evento').insert(fila)

    /**
     * Sin esta restricción, un doble toque en la app consume dos lugares del
     * cupo y el capitán ve fantasmas en su plantilla.
     */
    assert.isTrue(await debeFallar(() => db.table('participacion_evento').insert(fila)))
  })

  test('la etiqueta de mesa es única dentro del evento, pero no entre eventos', async ({
    assert,
  }) => {
    const { idEvento, idSalon, idCapitan } = await semilla()

    await db.table('mesa').insert({
      id_evento: idEvento,
      etiqueta: 'Mesa 1',
      codigo_qr: '11111111-1111-4111-8111-111111111111',
    })

    assert.isTrue(
      await debeFallar(() =>
        db.table('mesa').insert({
          id_evento: idEvento,
          etiqueta: 'Mesa 1',
          codigo_qr: '22222222-2222-4222-8222-222222222222',
        })
      )
    )

    // Otro evento sí puede tener su propia "Mesa 1".
    const [otro] = await db
      .table('evento')
      .returning('id_evento')
      .insert({
        id_salon: idSalon,
        id_capitan: idCapitan,
        id_usuario_creador: idCapitan,
        titulo: 'Boda Lopez',
        tipo: 'social',
        fecha: '2026-10-01',
        hora_presentacion: '16:00',
        inicio: '2026-10-01 18:00',
        cupo_meseros: 8,
        num_mesas: 15,
        tarifa_por_mesero: 900,
        radio_geocerca_m: 200,
      })

    await db.table('mesa').insert({
      id_evento: otro.id_evento,
      etiqueta: 'Mesa 1',
      codigo_qr: '33333333-3333-4333-8333-333333333333',
    })

    const total = await db.from('mesa').where('etiqueta', 'Mesa 1').count('* as n')
    assert.equal(Number(total[0].n), 2)
  })

  test('el fin del evento no puede ser anterior al inicio', async ({ assert }) => {
    const { idEvento } = await semilla()
    assert.isTrue(await debeFallar(() => db.from('evento').where('id_evento', idEvento).update({ fin: '2026-09-15 18:00' })))
  })

  test('la geocerca se mantiene dentro del rango de negocio (10–1000 m)', async ({ assert }) => {
    const { idEvento } = await semilla()
    assert.isTrue(await debeFallar(() => db.from('evento').where('id_evento', idEvento).update({ radio_geocerca_m: 5000 })))
    assert.isTrue(await debeFallar(() => db.from('evento').where('id_evento', idEvento).update({ radio_geocerca_m: 5 })))
  })

  test('la longitud admite tres dígitos enteros (Torreón está en −103)', async ({ assert }) => {
    /**
     * El Diccionario declara DECIMAL(10,8) para CONFIRMACION_LLEGADA.longitud,
     * que solo admite dos dígitos enteros: toda llegada en Torreón fallaría con
     * overflow. Esta prueba fija la corrección a DECIMAL(11,8).
     */
    const { idEvento, idMesero } = await semilla()
    const [p] = await db
      .table('participacion_evento')
      .returning('id_participacion')
      .insert({ id_evento: idEvento, id_usuario: idMesero, estado: 'confirmo_asistencia' })

    await db.table('confirmacion_llegada').insert({
      id_participacion: p.id_participacion,
      metodo: 'face_id',
      biometrico_verificado: true,
      latitud: 25.5439,
      longitud: -103.4063,
      distancia_m: 2.35,
      dentro_geocerca: true,
      resultado: 'exitoso',
    })

    const [fila] = await db.from('confirmacion_llegada').select('longitud')
    assert.closeTo(Number(fila.longitud), -103.4063, 0.0001)
  })

  test('solo una cuenta bancaria activa por usuario', async ({ assert }) => {
    const { idMesero } = await semilla()
    const cuenta = {
      id_usuario: idMesero,
      clabe: '012180012345678903',
      banco: 'BBVA',
      titular_cuenta: 'Juan Perez',
    }

    await db.table('datos_bancarios').insert(cuenta)
    assert.isTrue(await debeFallar(() => db.table('datos_bancarios').insert({ ...cuenta, clabe: '012180099999999999' })))

    // Desactivar la anterior permite registrar la nueva; la vieja se conserva
    // porque los PAGO históricos guardan la CLABE como snapshot.
    await db.from('datos_bancarios').where('id_usuario', idMesero).update({ activo: false })
    await db.table('datos_bancarios').insert({ ...cuenta, clabe: '012180099999999999' })

    const total = await db.from('datos_bancarios').where('id_usuario', idMesero).count('* as n')
    assert.equal(Number(total[0].n), 2)
  })

  test('un pin GPIO no puede tener dos insumos en el mismo evento', async ({ assert }) => {
    const { idEvento } = await semilla()

    const [c] = await db
      .table('cubaitor')
      .returning('id_cubaitor')
      .insert({ nombre: 'Barra 1', mac: 'AA:BB:CC:DD:EE:FF', num_pins: 8 })

    const [i1] = await db
      .table('insumo')
      .returning('id_insumo')
      .insert({ nombre: 'Ron Blanco', tipo: 'alcohol', unidad: 'ml', costo: 250 })
    const [i2] = await db
      .table('insumo')
      .returning('id_insumo')
      .insert({ nombre: 'Refresco Cola', tipo: 'refresco', unidad: 'ml', costo: 30 })

    const base = {
      id_evento: idEvento,
      id_cubaitor: c.id_cubaitor,
      pin_gpio: 12,
      caudal_ml_seg: 15.5,
      volumen_cargado_ml: 1000,
      volumen_disponible_ml: 1000,
    }

    await db.table('config_dispensado').insert({ ...base, id_insumo: i1.id_insumo })

    /**
     * SGEB-4019. Dos insumos peleando el mismo GPIO significa que una de las
     * bebidas sale con el líquido equivocado, y no hay forma de detectarlo
     * salvo probándola.
     */
    assert.isTrue(await debeFallar(() => db.table('config_dispensado').insert({ ...base, id_insumo: i2.id_insumo })))
  })

  test('el volumen disponible nunca excede al cargado', async ({ assert }) => {
    const { idEvento } = await semilla()
    const [c] = await db
      .table('cubaitor')
      .returning('id_cubaitor')
      .insert({ nombre: 'Barra 2', mac: 'AA:BB:CC:DD:EE:01', num_pins: 8 })
    const [i] = await db
      .table('insumo')
      .returning('id_insumo')
      .insert({ nombre: 'Tequila', tipo: 'alcohol', unidad: 'ml', costo: 400 })

    assert.isTrue(
      await debeFallar(() =>
        db.table('config_dispensado').insert({
          id_evento: idEvento,
          id_cubaitor: c.id_cubaitor,
          id_insumo: i.id_insumo,
          pin_gpio: 5,
          caudal_ml_seg: 10,
          volumen_cargado_ml: 700,
          volumen_disponible_ml: 900,
        })
      )
    )
  })

  test('la puntuación de la calificación queda entre 1 y 5', async ({ assert }) => {
    const { idEvento, idMesero } = await semilla()
    const [m] = await db
      .table('mesa')
      .returning('id_mesa')
      .insert({
        id_evento: idEvento,
        etiqueta: 'Mesa 7',
        codigo_qr: '44444444-4444-4444-8444-444444444444',
      })
    const [p] = await db
      .table('participacion_evento')
      .returning('id_participacion')
      .insert({ id_evento: idEvento, id_usuario: idMesero, estado: 'vinculo' })

    const base = {
      id_mesa: m.id_mesa,
      id_participacion: p.id_participacion,
      token_comensal: '55555555-5555-4555-8555-555555555555',
    }

    assert.isTrue(await debeFallar(() => db.table('calificacion').insert({ ...base, puntuacion: 6 })))
    await db.table('calificacion').insert({ ...base, puntuacion: 5 })

    /**
     * El token del comensal es único: es lo único que impide una segunda
     * calificación (SGEB-4010), porque el comensal es anónimo y no hay cuenta
     * contra la cual deduplicar.
     */
    assert.isTrue(
      await debeFallar(() =>
        db.table('calificacion').insert({ ...base, puntuacion: 1, id_mesa: m.id_mesa })
      )
    )
  })

  test('ninguna tabla de dominio depende del esquema auth', async ({ assert }) => {
    /**
     * Es la garantía estructural de la extracción del SSO. Si esta prueba se
     * pone en rojo, alguien agregó una FK public → auth y el módulo dejó de
     * poder desprenderse.
     */
    const filas = await db.rawQuery(`
      SELECT count(*)::int AS n
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND ccu.table_schema = 'auth'
    `)
    assert.equal(filas.rows[0].n, 0)
  })
})
