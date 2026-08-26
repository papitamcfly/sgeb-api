import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
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

  /**
   * Participaciones del evento, **con la identidad del mesero**.
   *
   * Sin precargar al usuario, la respuesta trae `id_participacion` y estados
   * pero nada que permita saber DE QUIÉN es cada fila: el panel de selección,
   * el de asistencia y el de pagos quedarían mostrando filas anónimas.
   *
   * Se precarga aquí y no se deja al controlador porque toda vista que liste
   * participaciones necesita el nombre; hacerlo opcional garantizaría que
   * alguien lo olvide.
   */
  async listarPorEvento(idEvento: number, estado?: ParticipacionEstado) {
    const q = ParticipacionEvento.query()
      .where('id_evento', idEvento)
      .preload('usuario', (u) => u.select('uuid_usuario', 'nombre', 'apellido_paterno', 'apellido_materno', 'correo', 'telefono'))
    if (estado) q.where('estado', estado)
    return q.orderBy('id_participacion')
  }

  /**
   * Asignaciones del evento, con mesa y mesero resueltos.
   *
   * Existe porque sin ella el panel de piso no puede reconstruir su estado tras
   * una recarga: sabía asignar y vincular, pero no leer qué mesa tiene quién.
   * Se resuelve por evento y no por participación porque el capitán mira el
   * salón completo, no a un mesero a la vez.
   */
  async listarAsignaciones(
    idEvento: number,
    filtros: { vinculada?: boolean; activa?: boolean } = {}
  ) {
    /**
     * Se comprueba que el evento exista. Sin esto, un id inventado y un evento
     * real sin asignaciones respondían lo mismo —`200 []`— y el panel no podía
     * distinguir "todavía no hay nada" de "esta pantalla no existe".
     */
    const existe = await db.from('evento').where('id_evento', idEvento).first()
    if (!existe) throw errores.noEncontrado('EVENTO', idEvento)

    const q = AsignacionMesa.query()
      .whereIn(
        'id_participacion',
        db.from('participacion_evento').select('id_participacion').where('id_evento', idEvento)
      )
      .preload('mesa')
      .preload('participacion', (p) =>
        p.preload('usuario', (u) =>
          u.select('uuid_usuario', 'nombre', 'apellido_paterno', 'apellido_materno')
        )
      )
      .orderBy('id_asignacion')

    if (filtros.vinculada !== undefined) q.where('vinculada', filtros.vinculada)

    /**
     * Por defecto solo las **vigentes**: el panel de piso quiere el estado
     * actual, no el histórico de mesas que alguien tuvo y soltó. Con
     * `activa=false` se consulta el histórico explícitamente.
     */
    q.where('activa', filtros.activa ?? true)
    return q
  }

  async obtener(id: number): Promise<ParticipacionEvento> {
    const p = await ParticipacionEvento.query()
      .where('id_participacion', id)
      .preload('usuario', (u) => u.select('uuid_usuario', 'nombre', 'apellido_paterno', 'apellido_materno', 'correo', 'telefono'))
      .first()
    if (!p) throw errores.noEncontrado('PARTICIPACION_EVENTO', id)
    return p
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
      .then(async (p) => {
        /**
         * El cupo se emite DESPUÉS de que la transacción confirma. Emitir dentro
         * anunciaría un lugar ocupado que un rollback puede deshacer, y los
         * demás meseros verían el cupo lleno sin que nadie lo haya tomado.
         */
        await this.emitirCupo(idEvento)
        emitter.emit('participacion:cambio', {
          idEvento,
          idParticipacion: p.id,
          estado: p.estado,
          checklistOk: p.checklistOk,
        })
        return p
      })
  }

  /**
   * Cuenta el cupo y lo anuncia a la sala del evento.
   *
   * Es lo que evita que diez meseros peleen por dos lugares y ocho se enteren
   * hasta recibir SGEB-4002: la pantalla se actualiza sola conforme se llenan.
   */
  private async emitirCupo(idEvento: number): Promise<void> {
    const evento = await Evento.find(idEvento)
    if (!evento) return

    const [{ count }] = await db
      .from('participacion_evento')
      .where('id_evento', idEvento)
      .whereNot('estado', 'salida')
      .count('* as count')

    const ocupados = Number(count)
    emitter.emit('cupo:actualizado', {
      idEvento,
      cupoMeseros: evento.cupoMeseros,
      ocupados,
      disponibles: Math.max(0, evento.cupoMeseros - ocupados),
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
    let idEventoLiberado: number | null = null

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
      idEventoLiberado = evento.id
      const horas = evento.inicio.diff(DateTime.now(), 'hours').hours

      if (!['aparto', 'seleccionado'].includes(p.estado) || horas < HORAS_CANCELACION) {
        throw new SgebError('SGEB-4020', {
          tecnico:
            `DELETE participacion id=${idParticipacion} rechazado: estado='${p.estado}', ` +
            `faltan ${horas.toFixed(1)} h para inicio (mínimo ${HORAS_CANCELACION} h).`,
        })
      }

      await p.useTransaction(trx).delete()
    }).then(async () => {
      /** El lugar liberado vuelve a estar disponible para los demás. */
      await this.emitirCupo(idEventoLiberado!)
    })
  }

  /** Transición de estado con su sello de fecha (SGEB-4011). */
  /**
   * El mesero confirma que sí va al evento (`seleccionado` → `confirmo_asistencia`).
   *
   * ────────────────────────────────────────────────────────────────────────
   *  POR QUÉ ES UN ENDPOINT PROPIO Y NO `PATCH /estado`
   * ────────────────────────────────────────────────────────────────────────
   * `cambiarEstado` vive en el bloque de capitán y admin, y **debe seguir
   * ahí**: la transición `aparto → seleccionado` es la selección del equipo, y
   * un mesero que pudiera invocarla se seleccionaría a sí mismo.
   *
   * Pero confirmar la asistencia es del mesero: es él quien sabe si va. Antes
   * no tenía forma de hacerlo — la única ruta era la del capitán— y el flujo se
   * quedaba trabado en `seleccionado`.
   *
   * Es el mismo reparto que la confirmación de llegada, que ya tenía su ruta
   * propia con verificación de pertenencia.
   */
  async confirmarAsistencia(idParticipacion: number, uuidUsuario: string) {
    const usuario = await this.identidad.resolverPorUuid(uuidUsuario)

    const r = await db.transaction(async (trx) => {
      const p = await ParticipacionEvento.query({ client: trx })
        .where('id_participacion', idParticipacion)
        .forUpdate()
        .first()

      if (!p) throw errores.noEncontrado('PARTICIPACION_EVENTO', idParticipacion)

      /** Nadie confirma la asistencia de otro: es una declaración personal. */
      if (p.idUsuario !== usuario.id) {
        throw new SgebError('SGEB-1004', {
          tecnico:
            `sub=${uuidUsuario} intentó confirmar la asistencia de la participación ` +
            `${idParticipacion}, que pertenece a id_usuario=${p.idUsuario}.`,
        })
      }

      /**
       * Idempotente: el mesero pulsa dos veces o la red repite la petición, y
       * eso no debe responder error. Solo se rechaza desde un estado del que
       * confirmar no tiene sentido.
       */
      if (p.estado === 'confirmo_asistencia') return { p, idEvento: p.idEvento }

      if (p.estado !== 'seleccionado') {
        throw errores.transicionInvalida(
          'PARTICIPACION_EVENTO', idParticipacion, p.estado, 'confirmo_asistencia'
        )
      }

      const evento = await Evento.findOrFail(p.idEvento, { client: trx })
      if (['finalizado', 'cancelado'].includes(evento.estado)) {
        throw new SgebError('SGEB-4013', {
          tecnico: `EVENTO id=${evento.id} estado='${evento.estado}'. No admite confirmaciones.`,
        })
      }

      p.estado = 'confirmo_asistencia'
      p.fechaConfirmaAsistencia = DateTime.now()
      await p.useTransaction(trx).save()

      return { p, idEvento: p.idEvento }
    })

    emitter.emit('participacion:cambio', {
      idEvento: r.idEvento,
      idParticipacion: r.p.id,
      estado: r.p.estado,
    })

    return r.p
  }

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
    }).then((p) => {
      emitter.emit('participacion:cambio', {
        idEvento: p.idEvento,
        idParticipacion: p.id,
        estado: p.estado,
        checklistOk: p.checklistOk,
      })
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
  /**
   * El capitán asigna una mesa al mesero.
   *
   * Guards, en el orden en que importan:
   *  1. El evento admite operación (ni finalizado ni cancelado)
   *  2. El mesero ya llegó al salón — asignar a quien no ha confirmado llegada
   *     produce un plano de piso que no describe la realidad
   *  3. El checklist está aprobado (SGEB-4005)
   *  4. La mesa es de este evento
   *  5. La mesa no tiene otra asignación **vigente**
   */
  async asignarMesa(idParticipacion: number, idMesa: number): Promise<AsignacionMesa> {
    const r = await db.transaction(async (trx) => {
      const p = await ParticipacionEvento.query({ client: trx })
        .where('id_participacion', idParticipacion)
        .forUpdate()
        .first()

      if (!p) throw errores.noEncontrado('PARTICIPACION_EVENTO', idParticipacion)

      const ev = await Evento.findOrFail(p.idEvento, { client: trx })
      if (['finalizado', 'cancelado'].includes(ev.estado)) {
        throw new SgebError('SGEB-4013', {
          tecnico: `EVENTO id=${ev.id} estado='${ev.estado}'. No admite asignaciones.`,
        })
      }

      /**
       * Estado mínimo. Antes solo se miraba el checklist, así que se podía
       * asignar mesa a alguien que ni siquiera había confirmado asistencia.
       */
      const PERMITIDOS = ['confirmo_llegada', 'asignado', 'vinculo']
      if (!PERMITIDOS.includes(p.estado)) {
        throw new SgebError('SGEB-4011', {
          tecnico:
            `PARTICIPACION id=${idParticipacion} estado='${p.estado}'. ` +
            `Asignar mesa exige uno de: ${PERMITIDOS.join(', ')}.`,
        })
      }

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

      /**
       * Se mira `activa`, no `vinculada`. Antes solo se rechazaba si había una
       * ya vinculada, así que dos meseros podían tener la misma mesa asignada
       * mientras ninguno hubiera llegado a ella.
       */
      const vigente = await AsignacionMesa.query({ client: trx })
        .where('id_mesa', idMesa)
        .where('activa', true)
        .first()

      if (vigente) {
        throw new SgebError('SGEB-4006', {
          tecnico:
            `MESA id=${idMesa} con ASIGNACION_MESA vigente id=${vigente.id} ` +
            `para participacion=${vigente.idParticipacion} (vinculada=${vigente.vinculada}).`,
        })
      }

      const asignacion = await AsignacionMesa.create(
        {
          idParticipacion,
          idMesa,
          vinculada: false,
          activa: true,
          fechaAsignacion: DateTime.now(),
          fechaLiberacion: null,
        },
        { client: trx }
      )

      if (p.estado === 'confirmo_llegada') {
        p.estado = 'asignado'
        await p.useTransaction(trx).save()
      }

      return { asignacion, idEvento: p.idEvento, idParticipacion: p.id, estado: p.estado }
    })

    /**
     * Emitido FUERA de la transacción, como el resto de la familia. Faltaba:
     * el panel de otro capitán no se enteraba de la asignación hasta recargar.
     */
    emitter.emit('mesa:cambio', {
      idEvento: r.idEvento,
      idMesa,
      estado: 'libre',
      idParticipacion: r.idParticipacion,
      vinculada: false,
    })
    emitter.emit('participacion:cambio', {
      idEvento: r.idEvento,
      idParticipacion: r.idParticipacion,
      estado: r.estado,
    })

    return r.asignacion
  }

  /**
   * El mesero vincula la mesa escaneando su QR.
   *
   * Exigir el escaneo y no un botón es lo que da evidencia de presencia física:
   * el código está impreso en la mesa, así que vincular implica haber estado
   * ahí.
   */
  /**
   * El mesero vincula su mesa escaneando el QR.
   *
   * `uuidMesero` es obligatorio: sin él, cualquier mesero con un QR podía
   * vincular la asignación de otro y aparecer como responsable de una mesa que
   * no le tocaba. El QR está impreso en la mesa, a la vista de todos.
   */
  async vincularMesa(
    idAsignacion: number,
    codigoQr: string,
    uuidMesero: string
  ): Promise<AsignacionMesa> {
    const usuario = await this.identidad.resolverPorUuid(uuidMesero)

    return db.transaction(async (trx) => {
      const a = await AsignacionMesa.query({ client: trx })
        .where('id_asignacion', idAsignacion)
        .forUpdate()
        .first()

      if (!a) throw errores.noEncontrado('ASIGNACION_MESA', idAsignacion)

      if (!a.activa) {
        throw new SgebError('SGEB-4011', {
          tecnico: `ASIGNACION_MESA id=${idAsignacion} liberada el ${a.fechaLiberacion?.toISO()}.`,
        })
      }

      const duena = await ParticipacionEvento.findOrFail(a.idParticipacion, { client: trx })
      if (duena.idUsuario !== usuario.id) {
        throw new SgebError('SGEB-1004', {
          tecnico:
            `sub=${uuidMesero} intentó vincular la ASIGNACION_MESA id=${idAsignacion}, ` +
            `que pertenece a la participación ${a.idParticipacion} de otro mesero.`,
        })
      }

      const mesa = await Mesa.findOrFail(a.idMesa, { client: trx })

      if (mesa.codigoQr !== codigoQr) {
        throw new SgebError('SGEB-3003', {
          tecnico:
            `QR escaneado no corresponde a la mesa asignada. ` +
            `Esperado MESA id=${a.idMesa}; el código recibido es de otra mesa o fue regenerado.`,
        })
      }

      /** Idempotente: reescanear el mismo QR no reemite ni cambia nada. */
      if (a.vinculada) {
        const p0 = await ParticipacionEvento.findOrFail(a.idParticipacion, { client: trx })
        return { asignacion: a, idEvento: mesa.idEvento, idParticipacion: p0.id, estado: p0.estado, yaEstaba: true }
      }

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

      return { asignacion: a, idEvento: mesa.idEvento, idParticipacion: p.id, estado: p.estado, yaEstaba: false }
    }).then((r) => {
      if (r.yaEstaba) return r.asignacion
      emitter.emit('mesa:cambio', {
        idEvento: r.idEvento,
        idMesa: r.asignacion.idMesa,
        estado: 'ocupada',
        idParticipacion: r.idParticipacion,
        vinculada: true,
      })
      emitter.emit('participacion:cambio', {
        idEvento: r.idEvento,
        idParticipacion: r.idParticipacion,
        estado: r.estado,
      })
      return r.asignacion
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

      /**
       * `activa = false` y no solo `vinculada = false`: son cosas distintas y
       * confundirlas hacía que una asignación liberada se viera igual que una
       * recién creada.
       */
      a.vinculada = false
      a.activa = false
      a.fechaLiberacion = DateTime.now()
      await a.useTransaction(trx).save()

      await trx.from('mesa').where('id_mesa', a.idMesa).update({ estado: 'libre' })
      const mesa = await Mesa.findOrFail(a.idMesa, { client: trx })

      /**
       * Revertir el estado de la participación. Sin esto el mesero se quedaba
       * en `asignado` o `vinculo` sin mesa: el panel lo mostraba trabajando en
       * una mesa que ya no tenía, y la máquina de estados quedaba mintiendo.
       *
       * Vuelve a `confirmo_llegada`, que es el estado real: llegó al salón y
       * está disponible para otra mesa.
       */
      const p = await ParticipacionEvento.query({ client: trx })
        .where('id_participacion', a.idParticipacion)
        .forUpdate()
        .firstOrFail()

      let estadoParticipacion = p.estado
      if (['asignado', 'vinculo'].includes(p.estado)) {
        const otras = await AsignacionMesa.query({ client: trx })
          .where('id_participacion', a.idParticipacion)
          .where('activa', true)
          .whereNot('id_asignacion', a.id)
          .first()

        /** Solo si no le queda ninguna otra mesa vigente. */
        if (!otras) {
          p.estado = 'confirmo_llegada'
          await p.useTransaction(trx).save()
          estadoParticipacion = p.estado
        }
      }

      return { idEvento: mesa.idEvento, idMesa: mesa.id, idParticipacion: p.id, estadoParticipacion }
    }).then((r) => {
      emitter.emit('mesa:cambio', {
        idEvento: r.idEvento,
        idMesa: r.idMesa,
        estado: 'libre',
        idParticipacion: null,
        vinculada: false,
      })
      emitter.emit('participacion:cambio', {
        idEvento: r.idEvento,
        idParticipacion: r.idParticipacion,
        estado: r.estadoParticipacion,
      })
    })
  }
}
