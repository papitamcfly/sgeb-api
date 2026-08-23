import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SEMBRAR — datos de prueba que cubren todo el sistema
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node ace sembrar              siembra sobre lo que haya
 *   node ace sembrar --limpiar    borra todo primero
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  QUÉ SIEMBRA Y POR QUÉ ASÍ
 * ────────────────────────────────────────────────────────────────────────────
 * Cuatro eventos, uno por estado interesante, para que cada pantalla tenga algo
 * que mostrar sin tener que armarlo a mano:
 *
 *   BORRADOR    editable por completo, incluido el radio de geocerca
 *   PUBLICADO   con cupo a medio llenar: el panel de selección tiene qué mostrar
 *   EN CURSO    el grande. Meseros en cada estado de la máquina, mesas asignadas
 *               y vinculadas, órdenes en cada estado, solicitudes, calificaciones
 *   FINALIZADO  listo para calcular pagos, con merma registrada
 *
 * **Los datos pasan por los servicios, no por INSERT directo.** Es más lento,
 * pero garantiza que lo sembrado respeta las mismas reglas que produce la
 * aplicación: un seeder que inserta a mano puede crear estados imposibles, y
 * entonces las pruebas manuales validan algo que nunca ocurriría.
 *
 * Las contraseñas son todas `Mesero2026` y los correos siguen un patrón
 * predecible, para poder entrar sin consultar la base.
 */

const PASSWORD = 'Mesero2026'

/** CLABEs con dígito verificador válido (algoritmo del Banco de México). */
const CLABES = [
  '012180012345678909',
  '002180012345678906',
  '014180012345678902',
  '021180012345678900',
  '036180012345678907',
]

export default class Sembrar extends BaseCommand {
  static commandName = 'sembrar'
  static description = 'Siembra datos de prueba que cubren todos los módulos'
  static options: CommandOptions = { startApp: true }

  @flags.boolean({ description: 'Borra todos los datos antes de sembrar' })
  declare limpiar: boolean

  @flags.boolean({
    description: 'Siembra además un segundo evento con la barra en todos sus estados de falla',
  })
  declare barra: boolean

  async run() {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const app = this.app



    if (this.limpiar) await this.borrarTodo(db)

    this.logger.info('Sembrando…')

    // ═══════════════════════════════════════════════════ 1. Personas
    const hash = await this.hashear()

    const personas = [
      { uuid: randomUUID(), rol: 1, nombre: 'Ana', ap: 'Ramírez', correo: 'admin@sgeb.mx' },
      { uuid: randomUUID(), rol: 2, nombre: 'Isaac', ap: 'Velásquez', correo: 'capitan@sgeb.mx' },
      { uuid: randomUUID(), rol: 2, nombre: 'Gustavo', ap: 'Contreras', correo: 'capitan2@sgeb.mx' },
      { uuid: randomUUID(), rol: 3, nombre: 'Juan', ap: 'Pérez', correo: 'mesero1@sgeb.mx' },
      { uuid: randomUUID(), rol: 3, nombre: 'María', ap: 'López', correo: 'mesero2@sgeb.mx' },
      { uuid: randomUUID(), rol: 3, nombre: 'Carlos', ap: 'Sánchez', correo: 'mesero3@sgeb.mx' },
      { uuid: randomUUID(), rol: 3, nombre: 'Lucía', ap: 'Torres', correo: 'mesero4@sgeb.mx' },
      { uuid: randomUUID(), rol: 3, nombre: 'Pedro', ap: 'Martínez', correo: 'mesero5@sgeb.mx' },
      { uuid: randomUUID(), rol: 3, nombre: 'Sofía', ap: 'Herrera', correo: 'mesero6@sgeb.mx' },
    ]

    /**
     * Uno por uno y saltando los existentes. `multiInsert` fallaba entero si
     * cualquiera de los nueve correos ya estaba: un usuario previo bastaba para
     * que el seeder no arrancara.
     *
     * Al reutilizar uno existente **se conserva su UUID**, no el generado aquí:
     * si ya tenía participaciones o pagos, siguen apuntando a la persona
     * correcta.
     */
    const ids: Record<string, number> = {}
    let nuevos = 0
    let reusados = 0

    for (const p of personas) {
      const existente = await this.buscarUsuario(db, p.correo)
      if (existente) {
        p.uuid = existente.uuid_usuario
        ids[p.correo] = existente.id_usuario
        reusados += 1
        continue
      }
      await db.table('usuario').insert({
        uuid_usuario: p.uuid, id_rol: p.rol, nombre: p.nombre,
        apellido_paterno: p.ap, correo: p.correo, password_hash: hash,
        biometria_habilitada: false, activo: true,
      })
      const f = await db.from('usuario').where('uuid_usuario', p.uuid).firstOrFail()
      ids[p.correo] = f.id_usuario
      nuevos += 1
    }

    const meseros = personas.filter((p) => p.rol === 3)
    const CAP = personas[1].uuid
    const CAP2 = personas[2].uuid

    /**
     * CLABE a los primeros cinco: el sexto queda sin ella a propósito, para
     * poder probar el bloqueo del cierre (SGEB-4012).
     *
     * Se salta a quien ya tenga una activa: sobrescribirla borraría el snapshot
     * contra el que se dispersaron pagos anteriores.
     */
    for (const [i, m] of meseros.slice(0, 5).entries()) {
      const tiene = await db
        .from('datos_bancarios')
        .where('id_usuario', ids[m.correo])
        .where('activo', true)
        .first()
      if (tiene) continue

      await db.table('datos_bancarios').insert({
        id_usuario: ids[m.correo], clabe: CLABES[i], banco: 'BBVA',
        titular_cuenta: `${m.nombre} ${m.ap}`, activo: true,
      })
    }

    this.logger.success(
      `  ${personas.length} usuarios (${nuevos} nuevos, ${reusados} ya existían)`
    )
    this.logger.info('    · El mesero6 NO tiene CLABE: sirve para probar SGEB-4012 al cerrar')

    // ═══════════════════════════════════════════════════ 2. Salones
    const { default: Salon } = await import('#modules/eventos/models/salon')

    /**
     * `firstOrCreate` por nombre: el salón no tiene restricción única en la
     * base, pero dos "Salón Galeana" son la misma cosa para quien los mira, y
     * acumular copias en cada corrida ensucia el selector del panel.
     */
    const salones = await Promise.all([
      Salon.firstOrCreate({ nombre: 'Salón Galeana' }, {
        calle: 'Av. Morelos 1200', cp: '27000',
        colonia: 'Centro', ciudad: 'Torreón', estado: 'Coahuila',
        latitud: 25.54389, longitud: -103.40632,
        capacidadMaxMesas: 50, capacidadPersonas: 400, activo: true,
      }),
      Salon.firstOrCreate({ nombre: 'Jardín Las Palmas' }, {
        calle: 'Blvd. Independencia 3400', cp: '27010',
        colonia: 'San Isidro', ciudad: 'Torreón', estado: 'Coahuila',
        latitud: 25.55120, longitud: -103.41890,
        capacidadMaxMesas: 30, capacidadPersonas: 250, activo: true,
      }),
      Salon.firstOrCreate({ nombre: 'Terraza Colón' }, {
        calle: 'Colón 850', cp: '27020',
        colonia: 'Torreón Jardín', ciudad: 'Torreón', estado: 'Coahuila',
        latitud: 25.53200, longitud: -103.43100,
        capacidadMaxMesas: 20, capacidadPersonas: 150, activo: true,
      }),
    ])
    this.logger.success('  3 salones en Torreón (coordenadas reales)')

    // ═══════════════════════════════════════════════════ 3. Menú
    const { MenuService } = await import('#modules/menu/services/menu_service')
    const menu = new MenuService()

    /**
     * El catálogo se reutiliza por nombre. No tiene restricción única en la
     * base —dos rones distintos podrían llamarse igual— pero aquí sembrar dos
     * veces "Ron blanco" solo produce ruido, y las recetas apuntarían a copias.
     */
    const insumo = async (
      nombre: string,
      tipo: 'alcohol' | 'refresco' | 'jugo' | 'agua' | 'otro',
      costo: number
    ) => {
      const ya = await db.from('insumo').where('nombre', nombre).first()
      if (ya) return { id: ya.id_insumo as number }
      return menu.crearInsumo({ nombre, tipo, unidad: 'ml', costo })
    }

    const envaseDe = async (nombre: string, volumenMl: number) => {
      const ya = await db.from('envase').where('nombre', nombre).first()
      if (ya) return { id: ya.id_envase as number }
      return menu.crearEnvase({ nombre, volumenMl })
    }

    /**
     * La bebida devuelve además si es nueva: la receta solo se define al
     * crearla. Redefinirla en cada corrida borraría los ajustes que alguien
     * haya hecho probando el motor de dispensado.
     */
    const bebidaDe = async (nombre: string, descripcion: string, alcoholica: boolean) => {
      const ya = await db.from('bebida').where('nombre', nombre).first()
      if (ya) return { id: ya.id_bebida as number, nueva: false }
      const b = await menu.crearBebida({ nombre, descripcion, alcoholica })
      return { id: b.id, nueva: true }
    }

    const ron = await insumo('Ron blanco', 'alcohol', 0.35)
    const tequila = await insumo('Tequila', 'alcohol', 0.52)
    const vodka = await insumo('Vodka', 'alcohol', 0.44)
    const cola = await insumo('Refresco de cola', 'refresco', 0.04)
    const toronja = await insumo('Refresco de toronja', 'refresco', 0.04)
    const naranja = await insumo('Jugo de naranja', 'jugo', 0.08)
    const agua = await insumo('Agua mineral', 'agua', 0.03)

    const vaso = await envaseDe('Vaso old fashioned', 350)
    const highball = await envaseDe('Vaso highball', 470)
    await envaseDe('Jarra', 1500)

    /**
     * El alcohol es FIJO_ML: si escalara con el envase, la misma cuba saldría
     * casi tres veces más fuerte en jarra sin que nadie lo decidiera.
     */
    const cuba = await bebidaDe('Cuba libre', 'Ron con refresco de cola', true)
    if (cuba.nueva) {
      await menu.definirReceta(cuba.id, [
        { idInsumo: ron.id, tipoPorcion: 'FIJO_ML', valor: 45, ordenServido: 1 },
        { idInsumo: cola.id, tipoPorcion: 'RESTO', valor: 0, ordenServido: 2 },
      ])
    }

    const paloma = await bebidaDe('Paloma', 'Tequila con toronja', true)
    if (paloma.nueva) {
      await menu.definirReceta(paloma.id, [
        { idInsumo: tequila.id, tipoPorcion: 'FIJO_ML', valor: 45, ordenServido: 1 },
        { idInsumo: toronja.id, tipoPorcion: 'RESTO', valor: 0, ordenServido: 2 },
      ])
    }

    const destornillador = await bebidaDe('Destornillador', 'Vodka con naranja', true)
    if (destornillador.nueva) {
      await menu.definirReceta(destornillador.id, [
        { idInsumo: vodka.id, tipoPorcion: 'FIJO_ML', valor: 45, ordenServido: 1 },
        { idInsumo: naranja.id, tipoPorcion: 'RESTO', valor: 0, ordenServido: 2 },
      ])
    }

    /** Una sin alcohol, para probar el filtro y el menú de menores. */
    const naranjada = await bebidaDe('Naranjada mineral', 'Sin alcohol', false)
    if (naranjada.nueva) {
      await menu.definirReceta(naranjada.id, [
        { idInsumo: naranja.id, tipoPorcion: 'PROPORCION', valor: 0.4, ordenServido: 1 },
        { idInsumo: agua.id, tipoPorcion: 'RESTO', valor: 0, ordenServido: 2 },
      ])
    }

    this.logger.success('  7 insumos, 3 envases, 4 bebidas con receta')

    // ═══════════════════════════════════════════════════ 4. Checklists
    const { ChecklistService } = await import('#modules/checklists/services/checklist_service')
    const checklists = new ChecklistService()

    /**
     * La plantilla se reutiliza por nombre. Recrearla en cada corrida dejaría
     * las instancias históricas apuntando a ítems de una copia anterior, y el
     * reporte de montaje no podría decir qué se revisó.
     */
    const plantilla = async (
      nombre: string,
      tipo: 'montaje' | 'servicio' | 'cierre',
      items: Array<{ descripcion: string; cantidadEsperada: number; orden: number }>
    ) => {
      const ya = await db.from('checklist').where('nombre', nombre).first()
      if (ya) return { id: ya.id_checklist as number }
      return checklists.crear({ nombre, tipo, items })
    }

    const clMontaje = await plantilla('Montaje de mesa', 'montaje', [
        { descripcion: 'Mantel planchado y sin manchas', cantidadEsperada: 1, orden: 1 },
        { descripcion: 'Platos base', cantidadEsperada: 10, orden: 2 },
        { descripcion: 'Cubiertos completos', cantidadEsperada: 10, orden: 3 },
        { descripcion: 'Copas de agua', cantidadEsperada: 10, orden: 4 },
        { descripcion: 'Servilletas dobladas', cantidadEsperada: 10, orden: 5 },
        { descripcion: 'Centro de mesa colocado', cantidadEsperada: 1, orden: 6 },
    ])
    await plantilla('Revisión de servicio', 'servicio', [
      { descripcion: 'Charolas limpias', cantidadEsperada: 2, orden: 1 },
      { descripcion: 'Uniforme completo', cantidadEsperada: 1, orden: 2 },
    ])
    await plantilla('Cierre de estación', 'cierre', [
      { descripcion: 'Loza recogida y contada', cantidadEsperada: 1, orden: 1 },
      { descripcion: 'Cristalería sin faltantes', cantidadEsperada: 1, orden: 2 },
      { descripcion: 'Área despejada', cantidadEsperada: 1, orden: 3 },
    ])
    this.logger.success('  3 checklists (montaje, servicio, cierre)')

    // ═══════════════════════════════════════════════════ 5. Cubaitor
    const { CubaitorService } = await import('#modules/cubaitor/services/cubaitor_service')
    const cub = new CubaitorService()
    /** La MAC sí es UNIQUE en la base: registrar dos veces reventaba. */
    const dispositivo = async (nombre: string, mac: string, numPins: number, hostIp: string) => {
      const ya = await db.from('cubaitor').where('mac', mac).first()
      if (ya) return { id: ya.id_cubaitor as number }
      return cub.registrar({ nombre, mac, numPins, hostIp })
    }
    const barra1 = await dispositivo('Barra principal', 'AA:BB:CC:DD:EE:01', 8, '10.17.0.20')
    const barra2 = await dispositivo('Barra terraza', 'AA:BB:CC:DD:EE:02', 4, '10.17.0.21')
    this.logger.success('  2 Cubaitores registrados')

    // ═══════════════════════════════════════════════════ 6. Eventos
    const { EventoService } = await import('#modules/eventos/services/evento_service')
    const { ParticipacionService } = await import('#modules/participaciones/services/participacion_service')
    const { OrdenService } = await import('#modules/ordenes/services/orden_service')
    const { ComensalService } = await import('#modules/comensal/services/comensal_service')

    const eventos = await app.container.make(EventoService)
    const part = await app.container.make(ParticipacionService)
    const ordenes = await app.container.make(OrdenService)
    const comensal = await app.container.make(ComensalService)

    const hoy = DateTime.now()
    const f = (d: number) => hoy.plus({ days: d }).toISODate()!

    /**
     * Los eventos se identifican por título. Es lo que evita que una segunda
     * corrida duplique todo el árbol: sin esto salían cuatro eventos más, con
     * sus mesas, participaciones, órdenes y dispensados.
     *
     * Si el evento ya existe, se salta el bloque entero — no se intenta
     * reconciliar su contenido. Reconstruir un evento a medias es peor que
     * dejarlo como está: alguien pudo haberlo avanzado probando, y sobrescribir
     * eso borraría justo lo que estaba examinando.
     */
    const yaSembrado = async (titulo: string) =>
      Boolean(await db.from('evento').where('titulo', titulo).first())

    // ── 6.1 BORRADOR: editable por completo
    let creados = 0
    if (!(await yaSembrado('Cena de fin de año Aceros del Norte'))) {
    const borrador = await eventos.crear(
      {
        idSalon: salones[2].id, uuidCapitan: CAP, titulo: 'Cena de fin de año Aceros del Norte',
        tipo: 'empresarial', fecha: f(45), horaPresentacion: '17:00',
        inicio: `${f(45)}T19:30:00`, cupoMeseros: 8, numMesas: 15,
        tarifaPorMesero: 900, radioGeocercaM: 120,
      },
      CAP
    )
    for (let i = 1; i <= 3; i++) await eventos.agregarMesa(borrador.id, { etiqueta: `Mesa ${i}` })
    creados += 1
    }

    // ── 6.2 PUBLICADO: cupo a medio llenar
    if (!(await yaSembrado('Boda Hernández–Ruiz'))) {
    const publicado = await eventos.crear(
      {
        idSalon: salones[1].id, uuidCapitan: CAP, titulo: 'Boda Hernández–Ruiz',
        tipo: 'social', fecha: f(12), horaPresentacion: '16:00',
        inicio: `${f(12)}T18:00:00`, cupoMeseros: 6, numMesas: 20,
        tarifaPorMesero: 950, radioGeocercaM: 200,
      },
      CAP
    )
    for (let i = 1; i <= 20; i++) await eventos.agregarMesa(publicado.id, { etiqueta: `Mesa ${i}` })
    await eventos.cambiarEstado(publicado.id, 'publicado')

    /** Tres apartados de seis: el panel de selección tiene qué mostrar. */
    for (const m of meseros.slice(0, 3)) await part.apartar(publicado.id, m.uuid)
    /** Y uno ya seleccionado, para ver los dos estados a la vez. */
    const pSel = await db.from('participacion_evento')
      .where('id_evento', publicado.id).orderBy('id_participacion').firstOrFail()
    await db.from('participacion_evento').where('id_participacion', pSel.id_participacion)
      .update({ estado: 'seleccionado', fecha_seleccion: DateTime.now().toSQL() })
    creados += 1
    }

    // ── 6.3 EN CURSO: el grande
    if (!(await yaSembrado('XV años de María Fernanda'))) {
    const enCurso = await eventos.crear(
      {
        idSalon: salones[0].id, uuidCapitan: CAP, titulo: 'XV años de María Fernanda',
        tipo: 'social', fecha: hoy.toISODate()!, horaPresentacion: '17:00',
        inicio: `${hoy.toISODate()}T19:00:00`, cupoMeseros: 6, numMesas: 12,
        tarifaPorMesero: 850, radioGeocercaM: 150,
      },
      CAP
    )
    const mesas = []
    for (let i = 1; i <= 12; i++) mesas.push(await eventos.agregarMesa(enCurso.id, { etiqueta: `Mesa ${i}` }))
    await eventos.cambiarEstado(enCurso.id, 'publicado')

    /**
     * Un mesero en cada estado de la máquina, para que el panel de asistencia
     * muestre la progresión completa sin tener que avanzarla a mano.
     */
    const participaciones = []
    for (const m of meseros) participaciones.push(await part.apartar(enCurso.id, m.uuid))

    const estados = [
      'vinculo', 'vinculo', 'asignado', 'confirmo_llegada', 'confirmo_asistencia', 'aparto',
    ]
    for (let i = 0; i < participaciones.length; i++) {
      const estado = estados[i]
      const marcas: Record<string, unknown> = { estado }
      if (estado !== 'aparto') marcas.fecha_seleccion = DateTime.now().minus({ hours: 6 }).toSQL()
      if (['confirmo_asistencia', 'confirmo_llegada', 'asignado', 'vinculo'].includes(estado)) {
        marcas.fecha_confirma_asistencia = DateTime.now().minus({ hours: 5 }).toSQL()
      }
      if (['confirmo_llegada', 'asignado', 'vinculo'].includes(estado)) {
        marcas.fecha_llegada = DateTime.now().minus({ hours: 2 }).toSQL()
        marcas.checklist_ok = true
      }
      await db.from('participacion_evento')
        .where('id_participacion', participaciones[i].id).update(marcas)
    }

    /** Checklist de montaje: uno aprobado, uno a medias. */
    const inst1 = await checklists.instanciar(participaciones[0].id, clMontaje.id)
    const items = await db.from('checklist_item').where('id_checklist', clMontaje.id).orderBy('orden')
    await checklists.responder(
      inst1.id,
      items.map((it) => ({ idItem: it.id_item, cantidad: it.cantidad_esperada, hecho: true }))
    )
    await checklists.aprobar(inst1.id)

    const inst2 = await checklists.instanciar(participaciones[2].id, clMontaje.id)
    await checklists.responder(
      inst2.id,
      items.slice(0, 3).map((it) => ({ idItem: it.id_item, cantidad: it.cantidad_esperada, hecho: true }))
    )

    /** Dos mesas vinculadas y una asignada sin vincular: los tres estados. */
    const asig1 = await part.asignarMesa(participaciones[0].id, mesas[0].id)
    await part.vincularMesa(asig1.id, mesas[0].codigoQr, meseros[0].uuid)
    const asig2 = await part.asignarMesa(participaciones[1].id, mesas[1].id)
    await part.vincularMesa(asig2.id, mesas[1].codigoQr, meseros[1].uuid)
    await part.asignarMesa(participaciones[2].id, mesas[2].id)

    await eventos.cambiarEstado(enCurso.id, 'en_curso')

    /** Cronograma con un hito ya disparado y dos por venir. */
    const { CronogramaService } = await import('#modules/eventos/services/cronograma_service')
    const cronograma = await app.container.make(CronogramaService)
    const hEntrada = await cronograma.crear(enCurso.id, { tipoTiempo: 'ENTRADA', horaObjetivo: '20:00' })
    await cronograma.crear(enCurso.id, { tipoTiempo: 'FUERTE', horaObjetivo: '21:30' })
    await cronograma.crear(enCurso.id, { tipoTiempo: 'POSTRE', horaObjetivo: '23:00' })
    await cronograma.disparar(hEntrada.id)

    /** Barra configurada, con una botella casi vacía a propósito. */
    await cub.configurarPin({
      idEvento: enCurso.id, idCubaitor: barra1.id, idInsumo: ron.id,
      pinGpio: 12, caudalMlSeg: 15.5, volumenCargadoMl: 4500,
    })
    await cub.configurarPin({
      idEvento: enCurso.id, idCubaitor: barra1.id, idInsumo: cola.id,
      pinGpio: 13, caudalMlSeg: 25.0, volumenCargadoMl: 12000,
    })
    await cub.configurarPin({
      idEvento: enCurso.id, idCubaitor: barra1.id, idInsumo: tequila.id,
      pinGpio: 14, caudalMlSeg: 15.0, volumenCargadoMl: 3000,
    })
    await cub.configurarPin({
      idEvento: enCurso.id, idCubaitor: barra1.id, idInsumo: toronja.id,
      pinGpio: 15, caudalMlSeg: 24.0, volumenCargadoMl: 8000,
    })
    /** Al 4 % de su carga: dispara la alerta de botella baja en el dashboard. */
    const cVodka = await cub.configurarPin({
      idEvento: enCurso.id, idCubaitor: barra2.id, idInsumo: vodka.id,
      pinGpio: 12, caudalMlSeg: 15.0, volumenCargadoMl: 3000,
    })
    await db.from('config_dispensado').where('id_config', cVodka.id)
      .update({ volumen_disponible_ml: 120 })
    await cub.configurarPin({
      idEvento: enCurso.id, idCubaitor: barra2.id, idInsumo: naranja.id,
      pinGpio: 13, caudalMlSeg: 22.0, volumenCargadoMl: 6000,
    })
    await cub.heartbeat('AA:BB:CC:DD:EE:01')

    /** Órdenes en distintos estados, con dispensados reportados. */
    const o1 = await ordenes.crear({
      idMesa: mesas[0].id, idParticipacion: participaciones[0].id,
      lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 2 }],
    })
    for (const det of o1.detalles) {
      const r = await ordenes.procesarDetalle(det.id)
      for (const ins of r.instrucciones) {
        /** 97 % de lo pedido: dentro de tolerancia, queda `ok`. */
        await ordenes.reportarDispensado(ins.id_dispensado, Number((ins.segundos * 0.97).toFixed(2)))
      }
    }
    await ordenes.cambiarEstado(o1.id, 'entregada')

    const o2 = await ordenes.crear({
      idMesa: mesas[1].id, idParticipacion: participaciones[1].id,
      lineas: [
        { idBebida: paloma.id, idEnvase: highball.id, cantidad: 1 },
        { idBebida: naranjada.id, idEnvase: vaso.id, cantidad: 1 },
      ],
    })
    const r2 = await ordenes.procesarDetalle(o2.detalles[0].id)
    /** 70 %: queda `parcial`, y el mesero debe ver la bebida antes de llevarla. */
    for (const ins of r2.instrucciones) {
      await ordenes.reportarDispensado(ins.id_dispensado, Number((ins.segundos * 0.7).toFixed(2)))
    }

    /** Una recién creada, sin procesar: el tablero la muestra pendiente. */
    await ordenes.crear({
      idMesa: mesas[0].id, idParticipacion: participaciones[0].id,
      lineas: [{ idBebida: destornillador.id, idEnvase: vaso.id, cantidad: 1 }],
    })

    /** Solicitudes del comensal: una pendiente y una atendida. */
    const s1 = await comensal.solicitar(mesas[0].codigoQr, 'atencion')
    await comensal.cambiarEstado(s1.id, 'atendida', meseros[0].uuid)
    await comensal.solicitar(mesas[1].codigoQr, 'cuenta')

    /** Calificaciones, incluida una baja para probar el indicador. */
    for (const [i, puntuacion] of [5, 4, 5, 2].entries()) {
      await db.table('calificacion').insert({
        id_mesa: mesas[i % 2].id,
        id_participacion: participaciones[i % 2].id,
        puntuacion,
        comentario: puntuacion <= 2 ? 'Tardó mucho en traer las bebidas' : null,
        token_comensal: randomUUID(),
      })
    }

    creados += 1
    }

    // ── 6.4 FINALIZADO: listo para cerrar
    /**
     * Se crea con fecha futura y **después se retrocede por SQL**: el servicio
     * rechaza crear eventos en el pasado (SGEB-2007), y con razón — nadie
     * agenda un banquete para ayer.
     *
     * El seeder sí necesita historia: sin un evento finalizado no hay nada que
     * cerrar, ni reporte de desempeño que mirar.
     */
    if (!(await yaSembrado('Bautizo Familia Guzmán'))) {
    const finalizado = await eventos.crear(
      {
        idSalon: salones[0].id, uuidCapitan: CAP2, titulo: 'Bautizo Familia Guzmán',
        tipo: 'social', fecha: f(1), horaPresentacion: '12:00',
        inicio: `${f(1)}T14:00:00`, cupoMeseros: 4, numMesas: 8,
        tarifaPorMesero: 800, radioGeocercaM: 150,
      },
      CAP2
    )
    await db.from('evento').where('id_evento', finalizado.id).update({
      fecha: f(-7),
      inicio: DateTime.fromISO(`${f(-7)}T14:00:00`).toSQL(),
    })
    for (let i = 1; i <= 8; i++) await eventos.agregarMesa(finalizado.id, { etiqueta: `Mesa ${i}` })
    await eventos.cambiarEstado(finalizado.id, 'publicado')

    for (const m of meseros.slice(0, 4)) {
      const p = await part.apartar(finalizado.id, m.uuid)
      await db.from('participacion_evento').where('id_participacion', p.id).update({
        estado: 'salida', checklist_ok: true,
        fecha_seleccion: DateTime.fromISO(f(-8)).toSQL(),
        fecha_confirma_asistencia: DateTime.fromISO(f(-8)).toSQL(),
        fecha_llegada: DateTime.fromISO(`${f(-7)}T12:15:00`).toSQL(),
        fecha_salida: DateTime.fromISO(`${f(-7)}T20:30:00`).toSQL(),
      })
    }
    await eventos.cambiarEstado(finalizado.id, 'en_curso')
    await eventos.cambiarEstado(finalizado.id, 'finalizado')

    /**
     * Merma, con una pieza **sin costear** a propósito: el reporte separa el
     * total de las piezas no valoradas, y $180 con una sin costear dice algo
     * distinto de $180 con todo costeado.
     */
    const { CierreService } = await import('#modules/cierre/services/cierre_service')
    const cierre = await app.container.make(CierreService)
    await cierre.registrarMerma(finalizado.id, CAP2, {
      observaciones: 'Dos copas rotas al recoger la mesa 4',
      detalles: [
        { tipo: 'copa_rota', descripcion: 'Copas de vino', cantidad: 2, costoEstimado: 180.0 },
        { tipo: 'plato_roto', descripcion: 'Plato base', cantidad: 1, costoEstimado: null },
      ],
    })

    creados += 1
    }

    this.logger.success(
      creados === 4
        ? '  4 eventos: borrador, publicado, en curso y finalizado'
        : `  ${creados} eventos nuevos (${4 - creados} ya estaban sembrados)`
    )

    // ═══════════════════════════════════════════════ 6.5 BARRA EN FALLA
    /**
     * Segundo evento en curso, dedicado a los estados de falla del Cubaitor.
     *
     * Va aparte y detrás de un flag porque **contamina el evento principal**:
     * un salón donde la mitad de las botellas están vacías y un dispositivo no
     * responde no sirve para probar el flujo normal de servicio.
     *
     * Aquí se siembran las cuatro cosas que el evento principal no cubre:
     * botella vacía, insumo sin pin configurado, dispositivo fuera de línea y
     * dispensado en `error` por falta de reporte.
     */
    if (this.barra && !(await yaSembrado('Posada Grupo Lerdo (barra en falla)'))) {
      const falla = await eventos.crear(
        {
          idSalon: salones[1].id, uuidCapitan: CAP, titulo: 'Posada Grupo Lerdo (barra en falla)',
          tipo: 'empresarial', fecha: hoy.toISODate()!, horaPresentacion: '18:00',
          inicio: `${hoy.toISODate()}T20:00:00`, cupoMeseros: 4, numMesas: 6,
          tarifaPorMesero: 880, radioGeocercaM: 180,
        },
        CAP
      )
      const mesasF = []
      for (let i = 1; i <= 6; i++) {
        mesasF.push(await eventos.agregarMesa(falla.id, { etiqueta: `Mesa ${i}` }))
      }
      await eventos.cambiarEstado(falla.id, 'publicado')

      const pf = []
      for (const m of meseros.slice(0, 2)) {
        const p = await part.apartar(falla.id, m.uuid)
        await db.from('participacion_evento').where('id_participacion', p.id).update({
          estado: 'confirmo_llegada', checklist_ok: true,
          fecha_seleccion: DateTime.now().minus({ hours: 4 }).toSQL(),
          fecha_confirma_asistencia: DateTime.now().minus({ hours: 3 }).toSQL(),
          fecha_llegada: DateTime.now().minus({ hours: 1 }).toSQL(),
        })
        pf.push(p)
      }
      await eventos.cambiarEstado(falla.id, 'en_curso')

      const asigF = await part.asignarMesa(pf[0].id, mesasF[0].id)
      await part.vincularMesa(asigF.id, mesasF[0].codigoQr, meseros[0].uuid)
      const asigF2 = await part.asignarMesa(pf[1].id, mesasF[1].id)
      await part.vincularMesa(asigF2.id, mesasF[1].codigoQr, meseros[1].uuid)

      /**
       * Barra 2 se registra como el dispositivo del evento y **se deja sin
       * latir**: `ultima_conexion` retrocede más allá del umbral de 120 s, y el
       * dashboard lo marca fuera de línea (SGEB-5003).
       *
       * El evento NO se bloquea por eso (RNF-13): se sirve a mano.
       */
      const cRonF = await cub.configurarPin({
        idEvento: falla.id, idCubaitor: barra2.id, idInsumo: ron.id,
        pinGpio: 20, caudalMlSeg: 15.5, volumenCargadoMl: 3000,
      })
      const cColaF = await cub.configurarPin({
        idEvento: falla.id, idCubaitor: barra2.id, idInsumo: cola.id,
        pinGpio: 21, caudalMlSeg: 25.0, volumenCargadoMl: 8000,
      })
      await cub.configurarPin({
        idEvento: falla.id, idCubaitor: barra2.id, idInsumo: tequila.id,
        pinGpio: 22, caudalMlSeg: 15.0, volumenCargadoMl: 2000,
      })

      /**
       * A la toronja **no se le configura pin** a propósito: pedir una Paloma
       * aquí responde SGEB-4008, que es distinto de la botella vacía y el
       * frontend debe distinguirlos.
       */

      /** Una orden entregada limpia, para que el evento no sea solo fallas. */
      const oa = await ordenes.crear({
        idMesa: mesasF[0].id, idParticipacion: pf[0].id,
        lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 1 }],
      })
      const ra = await ordenes.procesarDetalle(oa.detalles[0].id)
      for (const ins of ra.instrucciones) {
        await ordenes.reportarDispensado(ins.id_dispensado, ins.segundos)
      }
      await ordenes.cambiarEstado(oa.id, 'entregada')

      /**
       * Un dispensado en **`error`**: el dispositivo abrió la válvula y nunca
       * reportó (SGEB-5006). Es el estado que faltaba y el más difícil de
       * reproducir a mano, porque exige que el hardware falle a media apertura.
       */
      const ob = await ordenes.crear({
        idMesa: mesasF[1].id, idParticipacion: pf[1].id,
        lineas: [{ idBebida: cuba.id, idEnvase: highball.id, cantidad: 1 }],
      })
      const rb = await ordenes.procesarDetalle(ob.detalles[0].id)
      try {
        await ordenes.reportarDispensado(rb.instrucciones[0].id_dispensado, null)
      } catch {
        /**
         * `reportarDispensado(null)` marca el estado en `error` y **luego
         * lanza** SGEB-5006, para que quien reporta sepa que la válvula quedó
         * forzada a cierre. El efecto ya ocurrió: aquí solo se ignora la señal.
         */
      }

      /**
       * Botella vacía: el ron queda en 0 ml. La siguiente orden que lo pida
       * **no sirve nada** y pausa la orden entera (SGEB-4009) — servir medio
       * vaso deja una bebida que igual hay que tirar.
       */
      await db.from('config_dispensado').where('id_config', cRonF.id)
        .update({ volumen_disponible_ml: 0 })

      /** El refresco al 8 %: alerta de botella baja sin llegar a vacía. */
      await db.from('config_dispensado').where('id_config', cColaF.id)
        .update({ volumen_disponible_ml: 640 })

      /** Una orden que quedará pausada al intentar servirse. */
      const oc = await ordenes.crear({
        idMesa: mesasF[0].id, idParticipacion: pf[0].id,
        lineas: [{ idBebida: cuba.id, idEnvase: vaso.id, cantidad: 2 }],
      })
      try {
        await ordenes.procesarDetalle(oc.detalles[0].id)
      } catch {
        /** Se espera SGEB-4009: la orden queda `pausada_por_insumo`. */
      }

      /** El dispositivo deja de reportar: 10 minutos sin latido. */
      await db.from('cubaitor').where('id_cubaitor', barra2.id)
        .update({ ultima_conexion: DateTime.now().minus({ minutes: 10 }).toSQL() })

      this.logger.success('  + evento con la barra en falla (--barra)')
      this.logger.info('    · ron VACÍO, cola al 8 %, toronja SIN PIN, barra2 fuera de línea')
    }

    // ═══════════════════════════════════════════════════ 7. Resumen
    this.logger.info('')
    this.logger.success('════════════════════════════════════════════════════')
    this.logger.success('  Listo. Todas las contraseñas: ' + PASSWORD)
    this.logger.success('════════════════════════════════════════════════════')
    this.logger.info('')
    this.logger.info('  admin@sgeb.mx      admin')
    this.logger.info('  capitan@sgeb.mx    dirige borrador, publicado y en curso')
    this.logger.info('  capitan2@sgeb.mx   dirige el finalizado')
    this.logger.info('  mesero1..6@sgeb.mx mesero6 SIN CLABE, a propósito')
    this.logger.info('')
    /**
     * Los QR se consultan de la base, no de las variables locales: así se
     * imprimen también cuando el evento ya estaba sembrado de una corrida
     * anterior, que es justo cuando hacen falta y no se tienen a mano.
     */
    const qrs = await db
      .from('mesa as m')
      .join('evento as e', 'e.id_evento', 'm.id_evento')
      .where('e.titulo', 'XV años de María Fernanda')
      .orderBy('m.id_mesa')
      .limit(3)
      .select('m.etiqueta', 'm.codigo_qr')

    if (qrs.length > 0) {
      this.logger.info('  Códigos QR del evento en curso:')
      for (const m of qrs) {
        this.logger.info(`    ${String(m.etiqueta).padEnd(8)} ${m.codigo_qr}`)
      }
    }
    this.logger.info('')
    this.logger.info('  Qué probar sin preparar nada:')
    this.logger.info('    · Cierre con SGEB-4012 → el finalizado, si le agregas al mesero6')
    this.logger.info('    · Alerta de botella baja → vodka al 4 % en la barra terraza')
    this.logger.info('    · Dispensado parcial     → la Paloma de la Mesa 2')
    this.logger.info('    · Checklist a medias     → participación 3 del evento en curso')
    this.logger.info('    · Hito ya disparado      → ENTRADA del evento en curso')
    this.logger.info('')
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   *  IDEMPOTENCIA POR CLAVE NATURAL
   * ────────────────────────────────────────────────────────────────────────
   * Sin `--limpiar`, el seeder debe **convivir con lo que ya haya**. Antes
   * hacía `multiInsert` a ciegas y reventaba con `usuario_correo_unique` en
   * cuanto existía un solo usuario previo — que es el caso normal, porque nadie
   * borra la base para sembrar.
   *
   * Cada bloque se salta lo que ya existe, identificándolo por su clave
   * natural: el correo del usuario, la MAC del dispositivo, el nombre del
   * salón o del insumo. No es la llave primaria, pero es lo que hace que dos
   * filas sean "la misma cosa" para una persona.
   */
  private async buscarUsuario(
    db: Awaited<typeof import('@adonisjs/lucid/services/db')>['default'],
    correo: string
  ) {
    return db.from('usuario').where('correo', correo).first()
  }

  /** Hash real de Bcrypt: el login debe funcionar de verdad con estos datos. */
  private async hashear(): Promise<string> {
    const { default: hash } = await import('@adonisjs/core/services/hash')
    return hash.make(PASSWORD)
  }

  /**
   * Borra en orden inverso a las dependencias.
   *
   * `TRUNCATE ... CASCADE` sería más corto, pero borraría también `rol`, que es
   * catálogo fijo del sistema y no dato de prueba.
   */
  private async borrarTodo(db: Awaited<typeof import('@adonisjs/lucid/services/db')>['default']) {
    this.logger.warning('Borrando datos existentes…')

    const tablas = [
      'calificacion', 'solicitud_servicio', 'notificacion',
      'dispensado', 'orden_detalle', 'orden',
      'merma_detalle', 'reporte_merma', 'pago',
      'checklist_respuesta', 'checklist_instancia', 'checklist_item', 'checklist',
      'asignacion_mesa', 'confirmacion_llegada', 'participacion_evento',
      'cronograma_evento', 'comanda_evento', 'mesa', 'evento',
      'config_dispensado', 'cubaitor',
      'receta_ingrediente', 'bebida', 'insumo', 'envase',
      'salon', 'movimiento_bitacora', 'dispositivo_push', 'datos_bancarios',
    ]
    for (const t of tablas) await db.rawQuery(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`)

    const auth = [
      'auth.peticion_ip', 'auth.sesion_sso', 'auth.codigo_autorizacion',
      'auth.flujo_autorizacion', 'auth.token_recuperacion', 'auth.invitacion',
      'auth.dispositivo_confiable', 'auth.codigo_verificacion',
      'auth.bloqueo_cuenta', 'auth.intento_login', 'auth.refresh_token',
    ]
    for (const t of auth) await db.rawQuery(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`)

    await db.rawQuery('TRUNCATE TABLE "usuario" RESTART IDENTITY CASCADE')
    this.logger.success('  Datos borrados. `rol` se conserva: es catálogo, no dato de prueba.')
  }
}
