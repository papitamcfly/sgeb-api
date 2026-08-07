import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'
import Evento from '#modules/eventos/models/evento'
import { errores } from '#shared/errors/sgeb_error'
import { IdentidadService } from '#modules/identidad/identidad_service'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DASHBOARD — agrega lo que los demás módulos producen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Se escribe al final a propósito: no tiene lógica de negocio propia, solo lee
 * lo que otros ya calcularon. Si aquí apareciera una regla —"un mesero cuenta
 * como presente si…"— sería señal de que esa regla le falta a su módulo.
 *
 * Cada sección se calcula por separado y **el fallo de una no tumba el resto**.
 * Un panel donde una tarjeta dice "no disponible" es infinitamente más útil que
 * una pantalla en blanco con un 500, sobre todo a media fiesta. Cuando alguna
 * sección falla, la respuesta lleva SGEB-0004 (éxito parcial).
 */

type Seccion = 'resumen' | 'asistencia' | 'montaje' | 'piso' | 'barra' | 'servicio' | 'alertas'

const TODAS: Seccion[] = ['resumen', 'asistencia', 'montaje', 'piso', 'barra', 'servicio', 'alertas']

@inject()
export class DashboardService {
  constructor(private identidad: IdentidadService) {}

  /**
   * Panel del capitán: sus eventos próximos y el que esté en curso.
   *
   * Es la pantalla de entrada, así que responde rápido y sin detalle: los
   * conteos finos viven en el dashboard del evento.
   */
  async capitan(uuidCapitan: string) {
    const cap = await this.identidad.exigirRol(uuidCapitan, ['capitan', 'admin'])
    const hoy = DateTime.now().toISODate()!

    const eventos = await Evento.query()
      .where('id_capitan', cap.id)
      .whereIn('estado', ['borrador', 'publicado', 'en_curso'])
      .preload('salon')
      .orderBy('fecha')

    const enCurso = eventos.filter((e) => e.estado === 'en_curso')
    const proximos = eventos.filter((e) => e.estado === 'publicado' && e.fecha.toISODate()! >= hoy)

    /**
     * "Por cerrar" son los finalizados sin pagos calculados. Es lo que se le
     * olvida al capitán, porque el evento ya terminó y deja de mirarlo.
     */
    const porCerrar = await Evento.query()
      .where('id_capitan', cap.id)
      .where('estado', 'finalizado')
      .whereNotExists((q) =>
        q
          .from('pago')
          .join('participacion_evento', 'participacion_evento.id_participacion', 'pago.id_participacion')
          .whereRaw('participacion_evento.id_evento = evento.id_evento')
      )
      .orderBy('fecha', 'desc')
      .limit(10)

    return {
      en_curso: enCurso,
      proximos: proximos.slice(0, 10),
      borradores: eventos.filter((e) => e.estado === 'borrador').length,
      por_cerrar: porCerrar,
      totales: {
        en_curso: enCurso.length,
        proximos: proximos.length,
        por_cerrar: porCerrar.length,
      },
    }
  }

  /**
   * Panel del mesero: sus eventos y lo que le toca hacer ahora.
   *
   * `siguiente_accion` es el campo que de verdad usa: en el salón, con el
   * teléfono en una mano y una charola en la otra, nadie navega menús.
   */
  async meseros(uuidUsuario: string) {
    const u = await this.identidad.resolverPorUuid(uuidUsuario)

    const filas = await db
      .from('participacion_evento')
      .join('evento', 'evento.id_evento', 'participacion_evento.id_evento')
      .where('participacion_evento.id_usuario', u.id)
      .whereIn('evento.estado', ['publicado', 'en_curso'])
      .select(
        'participacion_evento.id_participacion',
        'participacion_evento.estado as estado_participacion',
        'participacion_evento.checklist_ok',
        'evento.id_evento',
        'evento.titulo',
        'evento.fecha',
        'evento.inicio',
        'evento.estado as estado_evento',
        'evento.tarifa_por_mesero'
      )
      .orderBy('evento.inicio')

    const eventos = filas.map((f) => ({
      id_participacion: f.id_participacion,
      id_evento: f.id_evento,
      titulo: f.titulo,
      fecha: f.fecha,
      inicio: f.inicio,
      estado_evento: f.estado_evento,
      estado_participacion: f.estado_participacion,
      checklist_ok: f.checklist_ok,
      tarifa: Number(f.tarifa_por_mesero),
      siguiente_accion: this.siguienteAccion(f.estado_participacion, f.checklist_ok),
    }))

    const [{ sinLeer }] = await db
      .from('notificacion')
      .whereIn(
        'id_participacion',
        db.from('participacion_evento').select('id_participacion').where('id_usuario', u.id)
      )
      .where('leida', false)
      .count('* as sinLeer')

    const [{ porCobrar }] = await db
      .from('pago')
      .whereIn(
        'id_participacion',
        db.from('participacion_evento').select('id_participacion').where('id_usuario', u.id)
      )
      .whereIn('estado', ['pendiente', 'fallido'])
      .sum('monto as porCobrar')

    return {
      eventos,
      notificaciones_sin_leer: Number(sinLeer),
      por_cobrar: Number(porCobrar ?? 0),
    }
  }

  /**
   * Dashboard del evento en curso.
   *
   * `secciones` permite pedir solo lo que la pantalla necesita: el panel del
   * capitán en el salón refresca "barra" y "servicio" cada pocos segundos y no
   * tiene por qué recalcular el cierre cada vez.
   */
  async evento(idEvento: number, secciones?: string[]) {
    const evento = await Evento.query().where('id_evento', idEvento).preload('salon').first()
    if (!evento) throw errores.noEncontrado('EVENTO', idEvento)

    const pedidas = (secciones?.length ? secciones : TODAS).filter((s): s is Seccion =>
      TODAS.includes(s as Seccion)
    )

    const data: Record<string, unknown> = {
      id_evento: evento.id,
      titulo: evento.titulo,
      estado: evento.estado,
      fecha: evento.fecha.toISODate(),
      salon: evento.salon.nombre,
    }
    const fallidas: string[] = []

    for (const s of pedidas) {
      try {
        data[s] = await this.seccion(s, evento)
      } catch (error) {
        /**
         * Una sección caída no tumba el panel. Se anota y se sigue: en medio de
         * un evento, media pantalla es infinitamente mejor que ninguna.
         */
        logger.error({ err: error, seccion: s, idEvento }, 'Sección del dashboard falló')
        data[s] = null
        fallidas.push(s)
      }
    }

    return { data, fallidas }
  }

  // ══════════════════════════════════════════════════════════════ secciones

  private async seccion(s: Seccion, evento: Evento): Promise<unknown> {
    const idEvento = evento.id
    const mesas = db.from('mesa').select('id_mesa').where('id_evento', idEvento)
    const parts = db.from('participacion_evento').select('id_participacion').where('id_evento', idEvento)

    switch (s) {
      case 'resumen': {
        const [{ n }] = await db.from('participacion_evento').where('id_evento', idEvento).count('* as n')
        const [{ m }] = await db.from('mesa').where('id_evento', idEvento).count('* as m')
        return {
          cupo_meseros: evento.cupoMeseros,
          inscritos: Number(n),
          disponibles: Math.max(0, evento.cupoMeseros - Number(n)),
          mesas: Number(m),
          tarifa_por_mesero: evento.tarifaPorMesero,
        }
      }

      case 'asistencia': {
        const porEstado = await db
          .from('participacion_evento')
          .where('id_evento', idEvento)
          .groupBy('estado')
          .select('estado')
          .count('* as n')

        /**
         * Las llegadas fallidas se separan de las exitosas: son las que ameritan
         * revisión del capitán, y mezclarlas en un conteo total las escondería.
         */
        const fallidas = await db
          .from('confirmacion_llegada')
          .whereIn('id_participacion', parts)
          .where('resultado', 'fallido')
          .count('* as n')

        return {
          por_estado: Object.fromEntries(porEstado.map((r) => [r.estado, Number(r.n)])),
          llegadas_fallidas: Number(fallidas[0].n),
        }
      }

      case 'montaje': {
        const [{ total }] = await db.from('participacion_evento').where('id_evento', idEvento).count('* as total')
        const [{ ok }] = await db
          .from('participacion_evento')
          .where('id_evento', idEvento)
          .where('checklist_ok', true)
          .count('* as ok')
        const [{ abiertas }] = await db
          .from('checklist_instancia')
          .whereIn('id_participacion', parts)
          .where('completado', false)
          .count('* as abiertas')

        return {
          participaciones: Number(total),
          checklist_aprobado: Number(ok),
          instancias_abiertas: Number(abiertas),
        }
      }

      case 'piso': {
        const porEstado = await db
          .from('mesa')
          .where('id_evento', idEvento)
          .groupBy('estado')
          .select('estado')
          .count('* as n')
        const [{ vinculadas }] = await db
          .from('asignacion_mesa')
          .whereIn('id_mesa', mesas)
          .where('vinculada', true)
          .count('* as vinculadas')

        return {
          mesas_por_estado: Object.fromEntries(porEstado.map((r) => [r.estado, Number(r.n)])),
          asignaciones_vinculadas: Number(vinculadas),
        }
      }

      case 'barra': {
        const porEstado = await db
          .from('orden')
          .whereIn('id_mesa', mesas)
          .groupBy('estado')
          .select('estado')
          .count('* as n')

        const mapa = Object.fromEntries(porEstado.map((r) => [r.estado, Number(r.n)]))
        const dispensados = await db
          .from('dispensado')
          .whereIn(
            'id_detalle',
            db.from('orden_detalle').select('id_detalle').whereIn('id_orden', db.from('orden').select('id_orden').whereIn('id_mesa', mesas))
          )
          .groupBy('estado')
          .select('estado')
          .count('* as n')

        return {
          pendientes: mapa.pendiente ?? 0,
          en_preparacion: mapa.en_preparacion ?? 0,
          dispensando: mapa.dispensando ?? 0,
          pausadas_por_insumo: mapa.pausada_por_insumo ?? 0,
          entregadas: mapa.entregada ?? 0,
          canceladas: mapa.cancelada ?? 0,
          dispensados_por_estado: Object.fromEntries(dispensados.map((r) => [r.estado, Number(r.n)])),
        }
      }

      case 'servicio': {
        const [{ pendientes }] = await db
          .from('solicitud_servicio')
          .whereIn('id_mesa', mesas)
          .where('estado', 'pendiente')
          .count('* as pendientes')

        const calificaciones = await db.from('calificacion').whereIn('id_mesa', mesas).select('puntuacion')
        const promedio = calificaciones.length
          ? Number((calificaciones.reduce((a, c) => a + c.puntuacion, 0) / calificaciones.length).toFixed(2))
          : null

        return {
          solicitudes_pendientes: Number(pendientes),
          calificaciones: calificaciones.length,
          /** null y no 0: un promedio de cero diría que el servicio fue pésimo. */
          promedio_calificacion: promedio,
          calificaciones_bajas: calificaciones.filter((c) => c.puntuacion <= 2).length,
        }
      }

      case 'alertas': {
        const { CubaitorService } = await import('#modules/cubaitor/services/cubaitor_service')
        return new CubaitorService().alertas(idEvento)
      }
    }
  }

  /** Lo que le toca hacer al mesero ahora mismo. */
  private siguienteAccion(estado: string, checklistOk: boolean): string {
    switch (estado) {
      case 'aparto':
        return 'Espera a que el capitán confirme tu lugar'
      case 'seleccionado':
        return 'Confirma tu asistencia'
      case 'confirmo_asistencia':
        return 'Confirma tu llegada al salón'
      case 'confirmo_llegada':
        return checklistOk ? 'Espera la asignación de tu mesa' : 'Completa el checklist de montaje'
      case 'asignado':
        return 'Escanea el QR de tu mesa para vincularla'
      case 'vinculo':
        return 'En servicio'
      case 'salida':
        return 'Turno cerrado'
      default:
        return 'Sin acciones pendientes'
    }
  }
}
