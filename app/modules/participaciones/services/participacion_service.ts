import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import Evento from '#modules/eventos/models/evento'
import Mesa from '#modules/eventos/models/mesa'
import ParticipacionEvento, {
  type ParticipacionEstado,
} from '#modules/participaciones/models/participacion_evento'
import AsignacionMesa from '#modules/participaciones/models/asignacion_mesa'
import { SgebError, errores } from '#shared/errors/sgeb_error'
import { IdentidadService } from '#modules/identidad/identidad_service'

/**
 * Ciclo de vida del mesero dentro del evento.
 *
 * El orden del enumerado ES la secuencia válida. `salida` es terminal: de un
 * mesero que ya salió cuelga el cálculo del pago.
 */
const TRANSICIONES: Record<ParticipacionEstado, ParticipacionEstado[]> = {
  aparto: ['seleccionado'],
  seleccionado: ['confirmo_asistencia'],
  confirmo_asistencia: ['confirmo_llegada'],
  confirmo_llegada: ['asignado'],
  asignado: ['vinculo'],
  vinculo: ['salida'],
  salida: [],
}

/** Campo de fecha que sella cada transición. El servidor los pone, nunca el cliente. */
const SELLO: Partial<Record<ParticipacionEstado, keyof ParticipacionEvento>> = {
  aparto: 'fechaAparto',
  seleccionado: 'fechaSeleccion',
  confirmo_asistencia: 'fechaConfirmaAsistencia',
  confirmo_llegada: 'fechaLlegada',
  salida: 'fechaSalida',
}

/** Ventana mínima antes del inicio para que el mesero libere su lugar solo. */
const HORAS_CANCELACION = 12

@inject()
export class ParticipacionService {
  constructor(private identidad: IdentidadService) {}

  async listarPorEvento(idEvento: number, estado?: ParticipacionEstado) {
    const q = ParticipacionEvento.query().where('id_evento', idEvento)
    if (estado) q.where('estado', estado)
    return q.orderBy('id_participacion')
  }

  /**
   * El mesero aparta su lugar (RF-8).
   *
   * El conteo del cupo va DENTRO de la transacción con bloqueo del evento. Sin
   * él, diez meseros tocando el botón a la vez ven todos "quedan 2 lugares" y
   * se inscriben los diez: el `SELECT count(*)` de cada uno corre antes de que
   * los demás confirmen.
   */
  async apartar(idEvento: number, uuidUsuario: string): Promise<ParticipacionEvento> {
    const usuario = await this.identidad.resolverPorUuid(uuidUsuario)

    return db.transaction(async (trx) => {
      const evento = await Evento.query({ client: trx })
        .where('id_evento', idEvento)
        .forUpdate()
        .first()

      if (!evento) throw errores.noEncontrado('EVENTO', idEvento)

      if (evento.estado !== 'publicado') {
        throw new SgebError('SGEB-4013', {
          tecnico: `EVENTO id=${idEvento} estado='${evento.estado}'. Apartar requiere 'publicado'.`,
        })
      }

      const [{ count }] = await trx
        .from('participacion_evento')
        .where('id_evento', idEvento)
        .whereNot('estado', 'salida')
        .count('* as count')

      if (Number(count) >= evento.cupoMeseros) {
        throw new SgebError('SGEB-4002', {
          tecnico:
            `cupo_meseros=${evento.cupoMeseros}, participaciones activas=${count}. ` +
            `INSERT rechazado para id_usuario=${usuario.id}.`,
        })
      }

      /**
       * Transacción anidada (SAVEPOINT) alrededor del INSERT: se va a capturar
       * la violación de unicidad, y sin aislarla la transacción quedaría
       * abortada aunque el error se maneje. Ver la nota extensa en
       * CubaitorService.configurarPin.
       */
      try {
        return await trx.transaction(async (sp) =>
          ParticipacionEvento.create(
            {
              idEvento,
              idUsuario: usuario.id,
              puesto: 'mesero',
              estado: 'aparto',
              fechaAparto: DateTime.now(),
              checklistOk: false,
            },
            { client: sp }
          )
        )
      } catch (error) {
        const e = error as { code?: string }
        if (e.code === '23505') {
          /**
           * El índice único (id_evento, id_usuario) atrapa el doble toque en la
           * app, que de otro modo consumiría dos lugares del cupo y dejaría
           * fantasmas en la plantilla del capitán.
           */
          throw new SgebError('SGEB-4011', {
            tecnico: `Ya existe PARTICIPACION para evento=${idEvento}, usuario=${usuario.id}.`,
            causa: error,
          })
        }
        throw error
      }
    })
  }

  /**
   * El mesero libera su lugar (RF-14).
   *
   * Solo mientras no haya confirmado asistencia y falte tiempo suficiente. Más
   * cerca del evento, la baja la ejecuta el capitán: a doce horas del inicio ya
   * no hay margen para buscar reemplazo, y el capitán necesita enterarse.
   */
  async liberar(idParticipacion: number, uuidUsuario: string): Promise<void> {
    const usuario = await this.identidad.resolverPorUuid(uuidUsuario)

    return db.transaction(async (trx) => {
      const p = await ParticipacionEvento.query({ client: trx })
        .where('id_participacion', idParticipacion)
        .forUpdate()
        .first()

      if (!p) throw errores.noEncontrado('PARTICIPACION_EVENTO', idParticipacion)

      if (p.idUsuario !== usuario.id) {
        throw new SgebError('SGEB-1004', {
          tecnico:
            `sub=${uuidUsuario} intentó liberar la participación ${idParticipacion} ` +
            `de id_usuario=${p.idUsuario}.`,
        })
      }

      const evento = await Evento.findOrFail(p.idEvento, { client: trx })
      const horas = evento.inicio.diff(DateTime.now(), 'hours').hours

      if (!['aparto', 'seleccionado'].includes(p.estado) || horas < HORAS_CANCELACION) {
        throw new SgebError('SGEB-4020', {
          tecnico:
            `DELETE participacion id=${idParticipacion} rechazado: estado='${p.estado}', ` +
            `faltan ${horas.toFixed(1)} h para inicio (mínimo ${HORAS_CANCELACION} h).`,
        })
      }

      await p.useTransaction(trx).delete()
    })
  }

  /** Transición de estado con su sello de fecha (SGEB-4011). */
  async cambiarEstado(
    idParticipacion: number,
    nuevo: ParticipacionEstado
  ): Promise<ParticipacionEvento> {
    return db.transaction(async (trx) => {
      const p = await ParticipacionEvento.query({ client: trx })
        .where('id_participacion', idParticipacion)
        .forUpdate()
        .first()

      if (!p) throw errores.noEncontrado('PARTICIPACION_EVENTO', idParticipacion)

      if (!TRANSICIONES[p.estado].includes(nuevo)) {
        throw errores.transicionInvalida('PARTICIPACION_EVENTO', idParticipacion, p.estado, nuevo)
      }

      /**
       * SGEB-4005: sin checklist de montaje aprobado no hay asignación de mesas.
       * Es la regla que impide que un mesero atienda una mesa que nunca se montó.
       */
      if (nuevo === 'asignado' && !p.checklistOk) {
        throw new SgebError('SGEB-4005', {
          tecnico:
            `PARTICIPACION id=${idParticipacion} con checklist_ok=false. ` +
            `Bloqueo de asignación de mesas (RF-21).`,
        })
      }

      p.estado = nuevo
      const campo = SELLO[nuevo]
      if (campo) (p as unknown as Record<string, DateTime>)[campo] = DateTime.now()

      await p.useTransaction(trx).save()
      return p
    })
  }

  // ══════════════════════════════════════════════════════════ asignaciones

  /**
   * El capitán asigna una mesa a un mesero (SGEB-4006).
   *
   * Asignar y vincular son cosas distintas: el capitán asigna desde el panel, y
   * el mesero vincula escaneando el QR ya parado frente a la mesa. Una mesa
   * asignada pero no vinculada significa que el mesero aún no llegó a ella.
   */
  async asignarMesa(idParticipacion: number, idMesa: number): Promise<AsignacionMesa> {
    return db.transaction(async (trx) => {
      const p = await ParticipacionEvento.query({ client: trx })
        .where('id_participacion', idParticipacion)
        .forUpdate()
        .first()

      if (!p) throw errores.noEncontrado('PARTICIPACION_EVENTO', idParticipacion)

      if (!p.checklistOk) {
        throw new SgebError('SGEB-4005', {
          tecnico: `PARTICIPACION id=${idParticipacion} con checklist_ok=false.`,
        })
      }

      const mesa = await Mesa.query({ client: trx }).where('id_mesa', idMesa).forUpdate().first()
      if (!mesa) throw errores.noEncontrado('MESA', idMesa)

      if (mesa.idEvento !== p.idEvento) {
        throw new SgebError('SGEB-3002', {
          tecnico:
            `MESA id=${idMesa} pertenece a evento ${mesa.idEvento}, ` +
            `pero la participación ${idParticipacion} es del evento ${p.idEvento}.`,
        })
      }

      const vigente = await AsignacionMesa.query({ client: trx })
        .where('id_mesa', idMesa)
        .where('vinculada', true)
        .first()

      if (vigente) {
        throw new SgebError('SGEB-4006', {
          tecnico:
            `MESA id=${idMesa} con ASIGNACION_MESA activa id=${vigente.id} ` +
            `para participacion=${vigente.idParticipacion}.`,
        })
      }

      const asignacion = await AsignacionMesa.create(
        { idParticipacion, idMesa, vinculada: false, fechaAsignacion: DateTime.now() },
        { client: trx }
      )

      if (p.estado === 'confirmo_llegada') {
        p.estado = 'asignado'
        await p.useTransaction(trx).save()
      }

      return asignacion
    })
  }

  /**
   * El mesero vincula la mesa escaneando su QR.
   *
   * Exigir el escaneo y no un botón es lo que da evidencia de presencia física:
   * el código está impreso en la mesa, así que vincular implica haber estado
   * ahí.
   */
  async vincularMesa(idAsignacion: number, codigoQr: string): Promise<AsignacionMesa> {
    return db.transaction(async (trx) => {
      const a = await AsignacionMesa.query({ client: trx })
        .where('id_asignacion', idAsignacion)
        .forUpdate()
        .first()

      if (!a) throw errores.noEncontrado('ASIGNACION_MESA', idAsignacion)

      const mesa = await Mesa.findOrFail(a.idMesa, { client: trx })

      if (mesa.codigoQr !== codigoQr) {
        throw new SgebError('SGEB-3003', {
          tecnico:
            `QR escaneado no corresponde a la mesa asignada. ` +
            `Esperado MESA id=${a.idMesa}; el código recibido es de otra mesa o fue regenerado.`,
        })
      }

      if (a.vinculada) return a

      a.vinculada = true
      a.fechaVinculacion = DateTime.now()
      await a.useTransaction(trx).save()

      mesa.estado = 'ocupada'
      await mesa.useTransaction(trx).save()

      const p = await ParticipacionEvento.findOrFail(a.idParticipacion, { client: trx })
      if (p.estado === 'asignado') {
        p.estado = 'vinculo'
        await p.useTransaction(trx).save()
      }

      return a
    })
  }

  /**
   * El capitán libera una mesa para reasignarla.
   *
   * La fila NO se borra: el histórico de quién atendió qué mesa es lo que
   * permite resolver una queja del comensal después del evento.
   */
  async liberarMesa(idAsignacion: number): Promise<void> {
    return db.transaction(async (trx) => {
      const a = await AsignacionMesa.query({ client: trx })
        .where('id_asignacion', idAsignacion)
        .forUpdate()
        .first()

      if (!a) throw errores.noEncontrado('ASIGNACION_MESA', idAsignacion)

      const [{ count }] = await trx
        .from('orden')
        .where('id_mesa', a.idMesa)
        .whereNotIn('estado', ['entregada', 'cancelada'])
        .count('* as count')

      if (Number(count) > 0) {
        throw new SgebError('SGEB-4018', {
          tecnico: `MESA id=${a.idMesa} con ${count} órdenes en curso. Liberación rechazada.`,
        })
      }

      a.vinculada = false
      await a.useTransaction(trx).save()

      await trx.from('mesa').where('id_mesa', a.idMesa).update({ estado: 'libre' })
    })
  }
}
