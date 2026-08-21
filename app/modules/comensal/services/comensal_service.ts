import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import { inject } from '@adonisjs/core'
import Mesa from '#modules/eventos/models/mesa'
import SolicitudServicio from '#modules/comensal/models/solicitud_servicio'
import Calificacion from '#modules/comensal/models/calificacion'
import AsignacionMesa from '#modules/participaciones/models/asignacion_mesa'
import { EventoService } from '#modules/eventos/services/evento_service'
import { IdentidadService } from '#modules/identidad/identidad_service'
import { SgebError, errores } from '#shared/errors/sgeb_error'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL COMENSAL — anónimo, sin cuenta, entrando por un QR impreso
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Es la única superficie del sistema sin autenticación de usuario. Eso obliga a
 * dos cosas que no aplican en el resto del dominio:
 *
 *  1. **Nada se identifica por quién eres, sino por qué escaneaste.** El código
 *     QR resuelve la mesa y el evento; el comensal no aporta identidad.
 *  2. **Cada escritura necesita su propio freno.** Sin cuenta no hay a quién
 *     limitar por rol ni a quién bloquear: los topes van por mesa y por token.
 */

/** Ventana del anti-spam de SGEB-4014. */
const SEGUNDOS_ANTISPAM = 120

@inject()
export class ComensalService {
  constructor(
    private eventos: EventoService,
    private identidad: IdentidadService
  ) {}

  /**
   * El comensal llama al mesero desde el QR de su mesa (RF-23).
   *
   * El anti-spam no cuenta solicitudes por minuto: rechaza mientras haya UNA
   * pendiente en esa mesa. Es más simple y describe mejor la realidad —el
   * comensal impaciente toca tres veces el botón, no monta un ataque— y evita
   * que la bandeja del mesero se llene de la misma petición repetida.
   */
  async solicitar(codigoQr: string, tipo: 'atencion' | 'cuenta' | 'otro') {
    const mesa = await this.eventos.porCodigoQr(codigoQr)

    return db.transaction(async (trx) => {
      const pendiente = await SolicitudServicio.query({ client: trx })
        .where('id_mesa', mesa.id)
        .where('estado', 'pendiente')
        .forUpdate()
        .first()

      if (pendiente) {
        const segundos = Math.round(DateTime.now().diff(pendiente.creadaEn, 'seconds').seconds)
        throw new SgebError('SGEB-4014', {
          tecnico:
            `SOLICITUD_SERVICIO pendiente id=${pendiente.id} para mesa=${mesa.id} ` +
            `creada hace ${segundos}s. Anti-spam de QR (ventana ${SEGUNDOS_ANTISPAM}s).`,
        })
      }

      /**
       * Se preasigna al mesero que tiene la mesa vinculada, si lo hay. Así la
       * solicitud aparece directamente en su bandeja en vez de quedar en una
       * cola general que nadie siente suya.
       */
      const asignacion = await AsignacionMesa.query({ client: trx })
        .where('id_mesa', mesa.id)
        .where('vinculada', true)
        .first()

      const s = await SolicitudServicio.create(
        {
          idMesa: mesa.id,
          idParticipacion: asignacion?.idParticipacion ?? null,
          tipo,
          estado: 'pendiente',
          creadaEn: DateTime.now(),
        },
        { client: trx }
      )

      return { solicitud: s, idEvento: mesa.idEvento }
    }).then((r) => {
      emitter.emit('solicitud:cambio', {
        idEvento: r.idEvento,
        idSolicitud: r.solicitud.id,
        idMesa: r.solicitud.idMesa,
        tipo: r.solicitud.tipo,
        estado: r.solicitud.estado,
        idParticipacion: r.solicitud.idParticipacion,
      })
      return r.solicitud
    })
  }

  async listarSolicitudes(
    idEvento: number,
    filtros: { estado?: string; idMesa?: number; idParticipacion?: number } = {}
  ) {
    const q = SolicitudServicio.query()
      .whereIn('id_mesa', db.from('mesa').select('id_mesa').where('id_evento', idEvento))
      .orderBy('creada_en', 'desc')

    if (filtros.estado) q.where('estado', filtros.estado)
    if (filtros.idMesa) q.where('id_mesa', filtros.idMesa)
    if (filtros.idParticipacion) q.where('id_participacion', filtros.idParticipacion)
    return q
  }

  /**
   * El mesero atiende o cancela la solicitud.
   *
   * `cancelada` no es un capricho: sin un estado terminal distinto de
   * `atendida`, una solicitud que nadie atiende —el comensal se levantó, o pidió
   * por error— bloquearía la mesa para siempre por el anti-spam. Y en el
   * histórico distingue "se atendió" de "se descartó", que es justo lo que el
   * capitán necesita al medir el tiempo de respuesta.
   */
  /**
   * El mesero atiende o cancela una solicitud.
   *
   * **Quién la resolvió lo deduce el SERVIDOR, no lo declara el cliente.**
   *
   * Antes llegaba `id_participacion` en el cuerpo y se guardaba sin verificar
   * nada: un mesero podía atribuirse la atención de otro, o adjudicársela a un
   * compañero. Eso importa porque de ese campo cuelga el indicador de tiempo de
   * respuesta, que es dato de desempeño.
   *
   * Ahora se resuelve desde el sujeto del token: se busca la participación de
   * quien llama **en el evento de esa mesa**. Si no tiene, SGEB-1004.
   */
  async cambiarEstado(
    idSolicitud: number,
    estado: 'atendida' | 'cancelada',
    uuidUsuario: string
  ) {
    const usuario = await this.identidad.resolverPorUuid(uuidUsuario)

    return db.transaction(async (trx) => {
      const s = await SolicitudServicio.query({ client: trx })
        .where('id_solicitud', idSolicitud)
        .forUpdate()
        .first()

      if (!s) throw errores.noEncontrado('SOLICITUD_SERVICIO', idSolicitud)

      /**
       * Carrera real entre dos meseros tocando la misma solicitud en su bandeja.
       * Gana el primero; el segundo recibe SGEB-4021 y su pantalla se refresca.
       */
      if (s.estado !== 'pendiente') {
        throw new SgebError('SGEB-4021', {
          tecnico:
            `SOLICITUD_SERVICIO id=${idSolicitud} estado='${s.estado}', ` +
            `atendida por participacion=${s.idParticipacion} el ${s.atendidaEn?.toISO()}.`,
        })
      }

      const mesa = await Mesa.findOrFail(s.idMesa, { client: trx })

      /**
       * La participación de quien llama en ESTE evento. Un mesero puede trabajar
       * en varios, así que no basta con buscar por usuario.
       */
      const propia = await trx
        .from('participacion_evento')
        .where('id_evento', mesa.idEvento)
        .where('id_usuario', usuario.id)
        .first()

      if (!propia) {
        throw new SgebError('SGEB-1004', {
          tecnico:
            `sub=${uuidUsuario} sin participación en el evento ${mesa.idEvento}, ` +
            `al que pertenece la MESA ${mesa.id} de la solicitud ${idSolicitud}.`,
        })
      }

      s.estado = estado
      s.atendidaEn = DateTime.now()
      /** Se registra quién la resolvió, para el indicador de tiempo de respuesta. */
      s.idParticipacion = propia.id_participacion
      await s.useTransaction(trx).save()
      return { solicitud: s, idEvento: mesa.idEvento }
    }).then((r) => {
      emitter.emit('solicitud:cambio', {
        idEvento: r.idEvento,
        idSolicitud: r.solicitud.id,
        idMesa: r.solicitud.idMesa,
        tipo: r.solicitud.tipo,
        estado: r.solicitud.estado,
        idParticipacion: r.solicitud.idParticipacion,
      })
      return r.solicitud
    })
  }

  // ══════════════════════════════════════════════════════ calificaciones

  /**
   * Emite el token que identifica al comensal en esta mesa.
   *
   * Es lo único que impide una segunda calificación (SGEB-4010): el comensal es
   * anónimo y no hay cuenta contra la cual deduplicar. Se genera al escanear y
   * se guarda en el navegador del comensal.
   */
  tokenComensal(): string {
    return randomUUID()
  }

  /**
   * El comensal califica al mesero de su mesa (RF-29).
   *
   * La calificación es anónima: se guarda contra la mesa y el mesero, nunca
   * contra quién la escribió. Por eso el token se serializa como `null` y no
   * sale en ninguna respuesta —devolverlo permitiría cruzar calificaciones con
   * el orden de escaneo y deducir quién dijo qué.
   */
  async calificar(
    codigoQr: string,
    datos: { tokenComensal: string; puntuacion: number; comentario?: string | null }
  ) {
    const mesa = await this.eventos.porCodigoQr(codigoQr)

    const asignacion = await AsignacionMesa.query()
      .where('id_mesa', mesa.id)
      .where('vinculada', true)
      .first()

    if (!asignacion) {
      /**
       * Sin mesero vinculado no hay a quién calificar. Ocurre si el comensal
       * escanea antes de que alguien tome la mesa.
       */
      throw new SgebError('SGEB-3002', {
        tecnico: `MESA id=${mesa.id} sin ASIGNACION_MESA vinculada. No hay mesero que calificar.`,
      })
    }

    try {
      return await db.transaction(async (trx) =>
        Calificacion.create(
          {
            idMesa: mesa.id,
            idParticipacion: asignacion.idParticipacion,
            tokenComensal: datos.tokenComensal,
            puntuacion: datos.puntuacion,
            comentario: datos.comentario?.trim() || null,
            creadaEn: DateTime.now(),
          },
          { client: trx }
        )
      )
    } catch (error) {
      const e = error as { code?: string }
      /**
       * El UNIQUE del token es la garantía real, no una comprobación previa: el
       * comensal puede tocar dos veces y las dos peticiones llegar a la vez.
       * El INSERT va en transacción anidada porque se captura y se continúa.
       */
      if (e.code === '23505') {
        throw new SgebError('SGEB-4010', {
          tecnico: `token_comensal='${datos.tokenComensal}' ya usado en CALIFICACION.`,
          causa: error,
        })
      }
      throw error
    }
  }

  /**
   * Calificaciones del evento, para el capitán.
   *
   * Nunca expone el token: la respuesta dice qué mesa y qué mesero, jamás quién
   * escribió. `puntuacionMax` existe para filtrar las bajas y atenderlas, que es
   * el uso real del capitán —nadie revisa una lista de cincos.
   */
  async listarCalificaciones(
    idEvento: number,
    filtros: { idParticipacion?: number; puntuacionMax?: number } = {}
  ) {
    const q = Calificacion.query()
      .whereIn('id_mesa', db.from('mesa').select('id_mesa').where('id_evento', idEvento))
      .orderBy('creada_en', 'desc')

    if (filtros.idParticipacion) q.where('id_participacion', filtros.idParticipacion)
    if (filtros.puntuacionMax) q.where('puntuacion', '<=', filtros.puntuacionMax)

    const filas = await q
    const promedio = filas.length
      ? Number((filas.reduce((a, c) => a + c.puntuacion, 0) / filas.length).toFixed(2))
      : null

    return { calificaciones: filas, total: filas.length, promedio }
  }
}
