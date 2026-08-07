import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'
import Evento from '#modules/eventos/models/evento'
import CronogramaEvento from '#modules/eventos/models/cronograma_evento'
import Notificacion from '#modules/notificaciones/models/notificacion'
import ParticipacionEvento from '#modules/participaciones/models/participacion_evento'
import { SgebError, errores } from '#shared/errors/sgeb_error'
import { IdentidadService } from '#modules/identidad/identidad_service'
import { PushService } from '#shared/services/push_service'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CRONOGRAMA DEL EVENTO Y NOTIFICACIONES (RF-11, RF-13)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El capitán define los tiempos de comida —entrada, fuerte, postre— y el
 * sistema avisa a los meseros cuando toca. Es lo que sustituye al grito por el
 * salón, que es como se coordina hoy.
 *
 * La pieza delicada es la idempotencia: el proceso que recorre el cronograma
 * puede reiniciarse, y sin la bandera `disparado` los meseros recibirían "sirvan
 * el postre" tres veces. Peor que no avisar es avisar de más: el mesero deja de
 * confiar en el aviso y empieza a ignorarlo.
 */

/** Anticipación con la que se avisa antes de la hora objetivo del hito. */
const MINUTOS_ANTICIPACION = 5

/** Texto por tipo. Corto a propósito: cabe en un wearable. */
const MENSAJE: Record<string, string> = {
  ENTRADA: 'Sirvan la entrada',
  FUERTE: 'Sirvan el plato fuerte',
  POSTRE: 'Sirvan el postre',
  OTRO: 'Siguiente tiempo del servicio',
}

@inject()
export class CronogramaService {
  constructor(
    private identidad: IdentidadService,
    private push: PushService
  ) {}

  async listar(idEvento: number) {
    return CronogramaEvento.query().where('id_evento', idEvento).orderBy('hora_objetivo')
  }

  /**
   * Crea un hito.
   *
   * No se admiten dos hitos del mismo tipo en un evento: "sirvan el postre" dos
   * veces no describe nada real, y al dispararse el segundo el mesero no sabría
   * si el primero falló o si de verdad hay dos postres.
   */
  async crear(
    idEvento: number,
    datos: { tipoTiempo: 'ENTRADA' | 'FUERTE' | 'POSTRE' | 'OTRO'; horaObjetivo: string; descripcion?: string | null }
  ) {
    const evento = await Evento.find(idEvento)
    if (!evento) throw errores.noEncontrado('EVENTO', idEvento)

    if (['finalizado', 'cancelado'].includes(evento.estado)) {
      throw new SgebError('SGEB-4013', {
        tecnico: `EVENTO id=${idEvento} estado='${evento.estado}'. No admite hitos nuevos.`,
      })
    }

    if (datos.tipoTiempo !== 'OTRO') {
      const existente = await CronogramaEvento.query()
        .where('id_evento', idEvento)
        .where('tipo_tiempo', datos.tipoTiempo)
        .first()

      if (existente) {
        throw new SgebError('SGEB-2013', {
          tecnico:
            `Ya existe CRONOGRAMA_EVENTO id=${existente.id} con tipo_tiempo=` +
            `'${datos.tipoTiempo}' en el evento ${idEvento}. Use 'OTRO' para hitos adicionales.`,
        })
      }
    }

    return CronogramaEvento.create({
      idEvento,
      tipoTiempo: datos.tipoTiempo,
      horaObjetivo: datos.horaObjetivo,
      descripcion: datos.descripcion ?? null,
      disparado: false,
      fechaDisparo: null,
    })
  }

  /**
   * Actualiza un hito.
   *
   * Un hito ya disparado no se edita: el aviso salió y los meseros ya actuaron.
   * Cambiar la hora después reescribiría la historia del servicio y dejaría el
   * registro contradiciendo lo que de verdad pasó en el salón.
   */
  async actualizar(
    idEvento: number,
    idHito: number,
    datos: { tipoTiempo?: 'ENTRADA' | 'FUERTE' | 'POSTRE' | 'OTRO'; horaObjetivo?: string; descripcion?: string | null }
  ) {
    const h = await CronogramaEvento.query()
      .where('id_cronograma', idHito)
      .where('id_evento', idEvento)
      .first()

    if (!h) throw errores.noEncontrado('CRONOGRAMA_EVENTO', idHito)

    if (h.disparado) {
      throw new SgebError('SGEB-4011', {
        tecnico:
          `CRONOGRAMA_EVENTO id=${idHito} ya disparado el ${h.fechaDisparo?.toISO()}. ` +
          `El aviso salió y los meseros ya actuaron; editarlo reescribiría la historia.`,
      })
    }

    if (datos.tipoTiempo) h.tipoTiempo = datos.tipoTiempo
    if (datos.horaObjetivo) h.horaObjetivo = datos.horaObjetivo
    if (datos.descripcion !== undefined) h.descripcion = datos.descripcion

    await h.save()
    return h
  }

  /**
   * Elimina un hito.
   *
   * Uno ya disparado tampoco se borra: su notificación existe y quedaría
   * apuntando a un hito inexistente. Se conserva como registro de lo ocurrido.
   */
  async eliminar(idEvento: number, idHito: number) {
    const h = await CronogramaEvento.query()
      .where('id_cronograma', idHito)
      .where('id_evento', idEvento)
      .first()

    if (!h) throw errores.noEncontrado('CRONOGRAMA_EVENTO', idHito)

    if (h.disparado) {
      throw new SgebError('SGEB-4016', {
        tecnico:
          `CRONOGRAMA_EVENTO id=${idHito} ya disparado: su NOTIFICACION quedaría huérfana. ` +
          `Se conserva como registro de lo ocurrido.`,
      })
    }

    await h.delete()
  }

  // ══════════════════════════════════════════════════════════ disparo

  /**
   * Recorre los hitos vencidos y notifica. La ejecuta una tarea programada.
   *
   * Todo el trabajo va dentro de una transacción con bloqueo del hito, y la
   * bandera `disparado` se marca ANTES de crear las notificaciones. Si dos
   * instancias del proceso corrieran a la vez, la segunda encontraría el hito ya
   * marcado y no volvería a avisar.
   *
   * Devuelve cuántos hitos se dispararon, para que la tarea lo registre.
   */
  async dispararVencidos(ahora: DateTime = DateTime.now()): Promise<number> {
    const eventos = await Evento.query().where('estado', 'en_curso')
    let disparados = 0

    for (const evento of eventos) {
      const hitos = await CronogramaEvento.query()
        .where('id_evento', evento.id)
        .where('disparado', false)

      for (const hito of hitos) {
        if (!this.toca(evento, hito, ahora)) continue
        if (await this.disparar(hito.id)) disparados += 1
      }
    }

    return disparados
  }

  /**
   * Dispara un hito concreto. Idempotente: si ya estaba disparado devuelve
   * `false` sin volver a notificar.
   */
  async disparar(idHito: number): Promise<boolean> {
    const resultado = await db.transaction(async (trx) => {
      const hito = await CronogramaEvento.query({ client: trx })
        .where('id_cronograma', idHito)
        .forUpdate()
        .first()

      if (!hito || hito.disparado) return null

      /**
       * Se marca ANTES de notificar. Si la creación de notificaciones falla, el
       * rollback deshace también la marca y el siguiente ciclo lo reintenta —
       * que es lo correcto: es peor no avisar que avisar tarde.
       */
      hito.disparado = true
      hito.fechaDisparo = DateTime.now()
      await hito.useTransaction(trx).save()

      /**
       * Solo a quien está trabajando en el piso. Un mesero que apartó pero no
       * llegó no necesita saber que toca el postre, y recibirlo lo confundiría.
       */
      const enPiso = await ParticipacionEvento.query({ client: trx })
        .where('id_evento', hito.idEvento)
        .whereIn('estado', ['confirmo_llegada', 'asignado', 'vinculo'])

      const mensaje = hito.descripcion?.trim() || MENSAJE[hito.tipoTiempo]

      for (const p of enPiso) {
        await Notificacion.create(
          {
            idEvento: hito.idEvento,
            idParticipacion: p.id,
            idCronograma: hito.id,
            idSolicitud: null,
            tipo: 'TIEMPO_COMIDA',
            canal: 'push',
            mensaje: mensaje.slice(0, 100),
            leida: false,
            enviadaEn: DateTime.now(),
          },
          { client: trx }
        )
      }

      return {
        hito,
        destinatarios: enPiso.length,
        destinatarios_ids: enPiso.map((p) => p.id),
        mensaje,
      }
    })

    if (!resultado) return false

    /**
     * El push va FUERA de la transacción, y `PushService.enviar` nunca lanza.
     *
     * Un fallo del proveedor no debe deshacer el registro de que el hito se
     * disparó: el siguiente ciclo volvería a notificar a quienes sí recibieron.
     * La notificación ya está en la base y llega además por el canal de tiempo
     * real, así que el push es refuerzo, no el único camino.
     */
    const envio = await this.push.aParticipaciones(
      resultado.destinatarios_ids,
      'Tiempo de servicio',
      resultado.mensaje,
      { tipo: 'TIEMPO_COMIDA', id_evento: String(resultado.hito.idEvento) }
    )

    logger.info(
      { idHito, destinatarios: resultado.destinatarios, push: envio },
      `Hito ${resultado.hito.tipoTiempo} disparado: ${resultado.mensaje}`
    )

    emitter.emit('cronograma:disparado', {
      idEvento: resultado.hito.idEvento,
      idCronograma: resultado.hito.id,
      tipoTiempo: resultado.hito.tipoTiempo,
      mensaje: resultado.mensaje,
      destinatarios: resultado.destinatarios,
    })

    return true
  }

  /**
   * ¿Ya toca este hito?
   *
   * `hora_objetivo` es una hora del día, no una marca temporal completa: se
   * combina con `EVENTO.fecha`. Un evento que cruza la medianoche —un XV que
   * sirve el postre a las 00:30— tendría el hito con hora menor que el inicio,
   * así que en ese caso se cuenta como del día siguiente.
   */
  private toca(evento: Evento, hito: CronogramaEvento, ahora: DateTime): boolean {
    const [hh, mm] = hito.horaObjetivo.split(':').map(Number)
    let objetivo = evento.fecha.set({ hour: hh, minute: mm, second: 0, millisecond: 0 })

    if (objetivo < evento.inicio) objetivo = objetivo.plus({ days: 1 })

    return ahora >= objetivo.minus({ minutes: MINUTOS_ANTICIPACION })
  }

  // ══════════════════════════════════════════════════════ notificaciones

  /**
   * Bandeja del usuario autenticado.
   *
   * Se filtra por sus participaciones, no por el evento: un mesero solo ve lo
   * suyo aunque trabaje en varios eventos.
   */
  async listarNotificaciones(uuidUsuario: string, filtros: { leida?: boolean } = {}) {
    const usuario = await this.identidad.resolverPorUuid(uuidUsuario)

    const q = Notificacion.query()
      .whereIn(
        'id_participacion',
        db.from('participacion_evento').select('id_participacion').where('id_usuario', usuario.id)
      )
      .orderBy('enviada_en', 'desc')
      .limit(100)

    if (filtros.leida !== undefined) q.where('leida', filtros.leida)

    const filas = await q
    const sinLeer = filas.filter((n) => !n.leida).length
    return { notificaciones: filas, sin_leer: sinLeer }
  }

  async marcarLeida(idNotificacion: number, uuidUsuario: string) {
    const usuario = await this.identidad.resolverPorUuid(uuidUsuario)

    const n = await Notificacion.find(idNotificacion)
    if (!n) throw errores.noEncontrado('NOTIFICACION', idNotificacion)

    /**
     * Se verifica la propiedad: sin esto, cualquiera podría marcar como leídas
     * las notificaciones de otro y hacer que se le pasara un tiempo de comida.
     */
    const propia = await db
      .from('participacion_evento')
      .where('id_participacion', n.idParticipacion ?? -1)
      .where('id_usuario', usuario.id)
      .first()

    if (!propia) {
      throw new SgebError('SGEB-1004', {
        tecnico:
          `sub=${uuidUsuario} intentó marcar la NOTIFICACION id=${idNotificacion}, ` +
          `que pertenece a la participación ${n.idParticipacion}.`,
      })
    }

    /** Idempotente: marcar dos veces no es un error. */
    if (n.leida) return n

    n.leida = true
    await n.save()
    return n
  }
}
