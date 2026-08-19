import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import Evento, { type EventoEstado } from '#modules/eventos/models/evento'
import Salon from '#modules/eventos/models/salon'
import Mesa from '#modules/eventos/models/mesa'
import { SgebError, errores } from '#shared/errors/sgeb_error'
import { IdentidadService } from '#modules/identidad/identidad_service'

/**
 * Reglas de negocio del evento.
 *
 * Tres cosas que se ven aquí y aplican a todo el dominio:
 *
 *  1. El servicio no conoce HTTP. Recibe datos, devuelve datos o lanza.
 *  2. Las verificaciones que deciden si una operación procede van DENTRO de la
 *     transacción. Entre un SELECT optimista y el UPDATE que le sigue cabe otra
 *     petición.
 *  3. Los usuarios entran y salen por UUID; el entero solo vive dentro.
 */

/**
 * Máquina de estados del evento. El orden ES la secuencia válida.
 *
 * `cancelado` se alcanza desde cualquier estado no terminal: un evento se puede
 * cancelar hasta el último momento. `finalizado` y `cancelado` son terminales —
 * de ellos no se sale, porque de un evento cerrado cuelgan pagos calculados.
 */
const TRANSICIONES: Record<EventoEstado, EventoEstado[]> = {
  borrador: ['publicado', 'cancelado'],
  publicado: ['en_curso', 'borrador', 'cancelado'],
  en_curso: ['finalizado', 'cancelado'],
  finalizado: [],
  cancelado: [],
}

export interface CrearEvento {
  idSalon: number
  uuidCapitan: string
  titulo: string
  tipo: 'social' | 'empresarial'
  fecha: string
  horaPresentacion: string
  inicio: string
  cupoMeseros: number
  numMesas: number
  tarifaPorMesero: number
  radioGeocercaM: number
  comandaUrl?: string | null
}

@inject()
export class EventoService {
  constructor(private identidad: IdentidadService) {}

  async listar(filtros: {
    estado?: EventoEstado
    fechaDesde?: string
    fechaHasta?: string
    uuidCapitan?: string
  }) {
    const q = Evento.query()
      .preload('salon')
      .preload('capitan', (u) => u.select('uuid_usuario', 'nombre', 'apellido_paterno', 'apellido_materno', 'correo'))
      .orderBy('fecha', 'desc')

    if (filtros.estado) q.where('estado', filtros.estado)
    if (filtros.fechaDesde) q.where('fecha', '>=', filtros.fechaDesde)
    if (filtros.fechaHasta) q.where('fecha', '<=', filtros.fechaHasta)

    if (filtros.uuidCapitan) {
      const cap = await this.identidad.resolverPorUuid(filtros.uuidCapitan)
      q.where('id_capitan', cap.id)
    }

    if (filtros.fechaDesde && filtros.fechaHasta && filtros.fechaDesde > filtros.fechaHasta) {
      throw new SgebError('SGEB-2009', {
        tecnico: `Query fecha_desde=${filtros.fechaDesde} > fecha_hasta=${filtros.fechaHasta}.`,
      })
    }

    return q
  }

  async obtener(id: number): Promise<Evento> {
    const evento = await Evento.query()
      .where('id_evento', id)
      .preload('salon')
      .preload('capitan', (u) => u.select('uuid_usuario', 'nombre', 'apellido_paterno', 'apellido_materno', 'correo'))
      .first()
    if (!evento) throw errores.noEncontrado('EVENTO', id)
    return evento
  }

  /**
   * Crea el evento validando las tres reglas que dependen del salón y la fecha.
   *
   * Todo dentro de una transacción con bloqueo del salón: sin él, dos capitanes
   * pueden crear eventos simultáneos en el mismo salón y fecha, cada uno viendo
   * el salón libre porque el otro todavía no ha confirmado.
   */
  async crear(datos: CrearEvento, uuidCreador: string): Promise<Evento> {
    const capitan = await this.identidad.exigirRol(datos.uuidCapitan, ['capitan', 'admin'])
    const creador = await this.identidad.resolverPorUuid(uuidCreador)

    this.validarFechas(datos)

    return db.transaction(async (trx) => {
      const salon = await Salon.query({ client: trx })
        .where('id_salon', datos.idSalon)
        .forUpdate()
        .first()

      if (!salon) {
        throw new SgebError('SGEB-3002', {
          tecnico: `id_salon=${datos.idSalon} no existe en SALON.`,
        })
      }
      if (!salon.activo) throw errores.desactivado('SALON', salon.id)

      // ── SGEB-4007: coherencia evento-salón ────────────────────────────
      if (datos.numMesas > salon.capacidadMaxMesas) {
        throw new SgebError('SGEB-4007', {
          tecnico:
            `num_mesas=${datos.numMesas} > SALON.capacidad_max_mesas=` +
            `${salon.capacidadMaxMesas} para id_salon=${salon.id}.`,
        })
      }

      // ── SGEB-4001: disponibilidad del salón (RF-9) ────────────────────
      const ocupado = await Evento.query({ client: trx })
        .where('id_salon', datos.idSalon)
        .where('fecha', datos.fecha)
        .whereIn('estado', ['publicado', 'en_curso'])
        .first()

      if (ocupado) {
        throw new SgebError('SGEB-4001', {
          tecnico:
            `SALON id=${salon.id} tiene EVENTO id=${ocupado.id} estado=${ocupado.estado} ` +
            `en fecha=${datos.fecha}.`,
        })
      }

      return Evento.create(
        {
          idSalon: datos.idSalon,
          idCapitan: capitan.id,
          idUsuarioCreador: creador.id,
          titulo: datos.titulo.trim(),
          tipo: datos.tipo,
          comandaUrl: datos.comandaUrl ?? null,
          fecha: DateTime.fromISO(datos.fecha),
          horaPresentacion: datos.horaPresentacion,
          inicio: DateTime.fromISO(datos.inicio),
          fin: null,
          cupoMeseros: datos.cupoMeseros,
          numMesas: datos.numMesas,
          tarifaPorMesero: datos.tarifaPorMesero,
          radioGeocercaM: datos.radioGeocercaM,
          estado: 'borrador',
        },
        { client: trx }
      )
    })
  }

  /**
   * Cambia el estado respetando la máquina de estados (SGEB-4011).
   *
   * Publicar exige que existan las mesas: un evento publicado sin mesas deja a
   * los meseros sin nada que asignar y al comensal sin QR que escanear.
   */
  async cambiarEstado(id: number, nuevo: EventoEstado): Promise<Evento> {
    return db.transaction(async (trx) => {
      const evento = await Evento.query({ client: trx })
        .where('id_evento', id)
        .forUpdate()
        .first()

      if (!evento) throw errores.noEncontrado('EVENTO', id)

      if (!TRANSICIONES[evento.estado].includes(nuevo)) {
        throw errores.transicionInvalida('EVENTO', id, evento.estado, nuevo)
      }

      if (nuevo === 'publicado') {
        const [{ count }] = await trx.from('mesa').where('id_evento', id).count('* as count')
        if (Number(count) === 0) {
          throw new SgebError('SGEB-4013', {
            tecnico:
              `EVENTO id=${id} sin mesas registradas. Publicar exige al menos una: ` +
              `sin mesas no hay QR que escanear ni nada que asignar.`,
          })
        }
      }

      if (nuevo === 'finalizado') {
        /**
         * Un evento no puede terminar antes de empezar. El CHECK de la base ya
         * lo impide, pero llegar hasta allá devolvería un error técnico
         * (SGEB-5001) sobre algo que el capitán sí puede entender y corregir.
         */
        if (evento.inicio > DateTime.now()) {
          throw new SgebError('SGEB-4013', {
            tecnico:
              `EVENTO id=${id} con inicio=${evento.inicio.toISO()} en el futuro. ` +
              `No se puede finalizar un evento que aún no comienza.`,
          })
        }

        /**
         * `fin` se sella aquí y no lo manda el cliente: es el dato del que
         * dependen los cálculos de duración y los pagos.
         */
        evento.fin = DateTime.now()
      }

      evento.estado = nuevo
      await evento.useTransaction(trx).save()
      return evento
    })
  }

  async actualizar(id: number, datos: Partial<CrearEvento>): Promise<Evento> {
    const evento = await this.obtener(id)

    /**
     * Un evento finalizado o cancelado no se edita: de él cuelgan pagos ya
     * calculados y asistencias confirmadas contra una geocerca concreta.
     */
    if (['finalizado', 'cancelado'].includes(evento.estado)) {
      throw new SgebError('SGEB-4013', {
        tecnico: `EVENTO id=${id} estado='${evento.estado}'. Operación 'actualizar' requiere borrador|publicado|en_curso.`,
      })
    }

    if (datos.uuidCapitan) {
      const cap = await this.identidad.exigirRol(datos.uuidCapitan, ['capitan', 'admin'])
      evento.idCapitan = cap.id
    }

    if (datos.numMesas !== undefined) {
      const salon = await Salon.findOrFail(evento.idSalon)
      if (datos.numMesas > salon.capacidadMaxMesas) {
        throw new SgebError('SGEB-4007', {
          tecnico: `num_mesas=${datos.numMesas} > capacidad_max_mesas=${salon.capacidadMaxMesas}.`,
        })
      }
      evento.numMesas = datos.numMesas
    }

    if (datos.titulo) evento.titulo = datos.titulo.trim()
    if (datos.tipo) evento.tipo = datos.tipo
    if (datos.comandaUrl !== undefined) evento.comandaUrl = datos.comandaUrl
    if (datos.cupoMeseros !== undefined) evento.cupoMeseros = datos.cupoMeseros
    if (datos.tarifaPorMesero !== undefined) evento.tarifaPorMesero = datos.tarifaPorMesero

    /**
     * El radio de la geocerca NO se toca después de publicar. Cambiarlo
     * invalidaría retroactivamente asistencias ya confirmadas, y de esas
     * asistencias dependen pagos.
     */
    if (datos.radioGeocercaM !== undefined) {
      if (evento.estado !== 'borrador') {
        throw new SgebError('SGEB-4013', {
          tecnico:
            `Intento de cambiar radio_geocerca_m en EVENTO id=${id} estado='${evento.estado}'. ` +
            `Solo editable en borrador: cambiarlo invalidaría asistencias ya confirmadas.`,
        })
      }
      evento.radioGeocercaM = datos.radioGeocercaM
    }

    await evento.save()
    return evento
  }

  // ══════════════════════════════════════════════════════════════ mesas

  /**
   * Registra una mesa. El servidor genera el UUID del QR: aceptarlo del cliente
   * permitiría fijar un código conocido y suplantar la mesa de otro evento.
   */
  async agregarMesa(idEvento: number, datos: { etiqueta: string; nfcUid?: string | null }) {
    const evento = await this.obtener(idEvento)

    if (['finalizado', 'cancelado'].includes(evento.estado)) {
      throw new SgebError('SGEB-4013', {
        tecnico: `EVENTO id=${idEvento} estado='${evento.estado}'. No admite mesas nuevas.`,
      })
    }

    const salon = await Salon.findOrFail(evento.idSalon)
    const [{ count }] = await db.from('mesa').where('id_evento', idEvento).count('* as count')

    if (Number(count) >= salon.capacidadMaxMesas) {
      throw new SgebError('SGEB-4007', {
        tecnico:
          `Mesas actuales=${count} alcanzan SALON.capacidad_max_mesas=${salon.capacidadMaxMesas} ` +
          `para id_salon=${salon.id}.`,
      })
    }

    return Mesa.create({
      idEvento,
      etiqueta: datos.etiqueta.trim(),
      codigoQr: randomUUID(),
      nfcUid: datos.nfcUid ?? null,
      estado: 'libre',
    })
  }

  async listarMesas(idEvento: number) {
    await this.obtener(idEvento)
    return Mesa.query().where('id_evento', idEvento).orderBy('etiqueta')
  }

  async obtenerMesa(idEvento: number, idMesa: number): Promise<Mesa> {
    const m = await Mesa.query().where('id_mesa', idMesa).where('id_evento', idEvento).first()
    if (!m) throw errores.noEncontrado('MESA', idMesa)
    return m
  }

  /**
   * Edita la mesa. El `codigo_qr` NO se toca aquí: para eso está regenerar, que
   * es una operación con consecuencia —invalida el impreso— y merece una ruta
   * propia en vez de ocurrir de rebote al corregir una etiqueta.
   */
  async actualizarMesa(
    idEvento: number,
    idMesa: number,
    datos: Partial<{ etiqueta: string; nfcUid: string | null }>
  ): Promise<Mesa> {
    const m = await this.obtenerMesa(idEvento, idMesa)

    if (datos.etiqueta) m.etiqueta = datos.etiqueta.trim()
    if (datos.nfcUid !== undefined) m.nfcUid = datos.nfcUid

    try {
      await m.save()
    } catch (error) {
      const e = error as { code?: string }
      if (e.code === '23505') {
        throw new SgebError('SGEB-2013', {
          tecnico: `etiqueta='${datos.etiqueta}' ya existe en el evento ${idEvento}.`,
          causa: error,
        })
      }
      throw error
    }
    return m
  }

  /**
   * Fechas ocupadas de un salón.
   *
   * Solo cuentan los eventos `publicado` y `en_curso`: un borrador todavía es un
   * plan, no un compromiso, y bloquear la fecha por un borrador impediría que
   * otro capitán agendara algo real.
   */
  async disponibilidadSalon(idSalon: number, desde: string, hasta: string) {
    const salon = await Salon.find(idSalon)
    if (!salon) throw errores.noEncontrado('SALON', idSalon)

    if (desde > hasta) {
      throw new SgebError('SGEB-2009', {
        tecnico: `fecha_desde=${desde} > fecha_hasta=${hasta}.`,
      })
    }

    const ocupados = await Evento.query()
      .where('id_salon', idSalon)
      .whereIn('estado', ['publicado', 'en_curso'])
      .whereBetween('fecha', [desde, hasta])
      .orderBy('fecha')

    return {
      id_salon: salon.id,
      nombre: salon.nombre,
      activo: salon.activo,
      desde,
      hasta,
      fechas_ocupadas: ocupados.map((e) => ({
        fecha: e.fecha.toISODate(),
        id_evento: e.id,
        titulo: e.titulo,
        estado: e.estado,
      })),
    }
  }

  /**
   * Regenera el QR de una mesa (RF-22).
   *
   * Se usa cuando el impreso se daña, se pierde, o alguien fotografía el código
   * y lo difunde. El anterior deja de resolver de inmediato: quien tenga la
   * vista abierta con el código viejo recibe SGEB-3003.
   */
  async regenerarQr(idEvento: number, idMesa: number) {
    const mesa = await Mesa.query().where('id_mesa', idMesa).where('id_evento', idEvento).first()
    if (!mesa) throw errores.noEncontrado('MESA', idMesa)

    const anterior = mesa.codigoQr
    mesa.codigoQr = randomUUID()
    await mesa.save()

    return { codigo_qr: mesa.codigoQr, codigo_qr_anterior: anterior }
  }

  /**
   * Resuelve la mesa desde el QR que escanea el comensal.
   *
   * El comensal es anónimo y no dice a qué evento pertenece: el código por sí
   * solo tiene que resolverlo. Por eso es único a nivel global.
   */
  async porCodigoQr(codigoQr: string) {
    const mesa = await Mesa.query().where('codigo_qr', codigoQr).preload('evento').first()

    if (!mesa) {
      throw new SgebError('SGEB-3003', {
        tecnico: `MESA.codigo_qr='${codigoQr}' → 0 filas.`,
      })
    }

    if (!['publicado', 'en_curso'].includes(mesa.evento.estado)) {
      throw new SgebError('SGEB-3003', {
        tecnico:
          `MESA id=${mesa.id} pertenece a EVENTO id=${mesa.evento.id} ` +
          `estado='${mesa.evento.estado}'. QR de evento no vigente.`,
      })
    }

    return mesa
  }

  async eliminarMesa(idEvento: number, idMesa: number): Promise<void> {
    return db.transaction(async (trx) => {
      const mesa = await Mesa.query({ client: trx })
        .where('id_mesa', idMesa)
        .where('id_evento', idEvento)
        .forUpdate()
        .first()

      if (!mesa) throw errores.noEncontrado('MESA', idMesa)

      const evento = await Evento.findOrFail(idEvento, { client: trx })
      if (!['borrador', 'publicado'].includes(evento.estado)) {
        throw new SgebError('SGEB-4013', {
          tecnico: `EVENTO id=${idEvento} estado='${evento.estado}'. Eliminar mesa requiere borrador|publicado.`,
        })
      }

      const [{ ordenes }] = await trx
        .from('orden')
        .where('id_mesa', idMesa)
        .whereNotIn('estado', ['entregada', 'cancelada'])
        .count('* as ordenes')

      const [{ asignaciones }] = await trx
        .from('asignacion_mesa')
        .where('id_mesa', idMesa)
        .where('vinculada', true)
        .count('* as asignaciones')

      if (Number(ordenes) > 0 || Number(asignaciones) > 0) {
        throw new SgebError('SGEB-4018', {
          tecnico:
            `MESA id=${idMesa}: ${ordenes} órdenes vivas y ${asignaciones} asignaciones ` +
            `vinculadas. Operación 'eliminar' rechazada.`,
        })
      }

      await mesa.useTransaction(trx).delete()
    })
  }

  // ══════════════════════════════════════════════════════════════ internos

  private validarFechas(d: CrearEvento): void {
    const fecha = DateTime.fromISO(d.fecha)
    const inicio = DateTime.fromISO(d.inicio)

    if (!fecha.isValid || !inicio.isValid) {
      throw new SgebError('SGEB-2002', {
        tecnico: `Fecha o inicio con formato inválido: fecha='${d.fecha}', inicio='${d.inicio}'.`,
      })
    }

    if (fecha < DateTime.now().startOf('day')) {
      throw new SgebError('SGEB-2007', {
        tecnico: `EVENTO.fecha='${d.fecha}' < CURRENT_DATE. Rechazado.`,
      })
    }

    /**
     * `inicio` tiene que caer el mismo día que `fecha`. Si no, el cronograma y
     * la ventana de confirmación de llegada se calculan contra días distintos y
     * los meseros reciben avisos el día equivocado.
     */
    if (inicio.toISODate() !== fecha.toISODate()) {
      throw new SgebError('SGEB-2008', {
        tecnico: `inicio='${d.inicio}' no coincide con fecha='${d.fecha}'.`,
      })
    }

    /**
     * `hora_presentacion` debe ser **estrictamente anterior** a `inicio`.
     *
     * Es la hora a la que el mesero se presenta a montar; el montaje toma
     * tiempo. Iguales significaría que llega cuando los invitados ya están
     * entrando, y posterior no describe nada real.
     *
     * No se exige una anticipación mínima concreta: un coctel de dos horas y un
     * banquete de doce necesitan montajes muy distintos, y fijar un número aquí
     * obligaría al capitán a pelearse con el sistema en el caso que no previmos.
     */
    const [hh, mm] = d.horaPresentacion.split(':').map(Number)
    const presentacion = fecha.set({ hour: hh, minute: mm, second: 0, millisecond: 0 })

    if (presentacion >= inicio) {
      throw new SgebError('SGEB-2008', {
        tecnico:
          `hora_presentacion='${d.horaPresentacion}' >= inicio='${d.inicio}'. ` +
          `El mesero se presenta a montar ANTES de que empiece el evento.`,
      })
    }
  }
}
