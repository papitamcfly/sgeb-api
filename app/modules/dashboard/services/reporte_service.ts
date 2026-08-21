import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import { SgebError } from '#shared/errors/sgeb_error'
import { IdentidadService } from '#modules/identidad/identidad_service'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DESEMPEÑO HISTÓRICO DE MESEROS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reporte agregado por persona, en un rango de fechas. Alimenta la pantalla de
 * personal: a quién conviene volver a llamar, quién falla, quién recibe quejas.
 *
 * **Sustituye a `/dashboard/meseros`**, que es self-service —lo que le toca
 * hacer AHORA a quien pregunta— y nunca fue este reporte. Confundirlos venía
 * del OpenAPI, que documentaba aquí algo que se implementó allá.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  QUÉ SE PUEDE MEDIR Y QUÉ NO
 * ────────────────────────────────────────────────────────────────────────────
 * Todo lo que sale de aquí se calcula con datos que el sistema ya registra. Lo
 * que no se puede calcular honestamente se devuelve como `null`, no como cero:
 * un cero dice "midió cero", y `null` dice "no hay dato". La diferencia importa
 * cuando de esto dependen decisiones sobre el trabajo de una persona.
 */

/** Tope del rango, para que una pantalla no tumbe la base. */
const MAX_DIAS = 366

/** Una calificación de 1 o 2 estrellas amerita revisión del capitán. */
const UMBRAL_BAJA = 2

export interface FiltrosDesempeno {
  fechaDesde: string
  fechaHasta: string
  uuidMesero?: string
  page?: number
  pageSize?: number
}

@inject()
export class ReporteService {
  constructor(private identidad: IdentidadService) {}

  async desempenoMeseros(f: FiltrosDesempeno) {
    const dias = DateTime.fromISO(f.fechaHasta).diff(DateTime.fromISO(f.fechaDesde), 'days').days

    if (Number.isNaN(dias) || dias < 0) {
      throw new SgebError('SGEB-2009', {
        tecnico: `Rango inválido: fecha_desde=${f.fechaDesde}, fecha_hasta=${f.fechaHasta}.`,
      })
    }
    if (dias > MAX_DIAS) {
      throw new SgebError('SGEB-2015', {
        tecnico: `Rango solicitado=${Math.round(dias)} días > máximo=${MAX_DIAS}.`,
      })
    }

    let idMesero: number | null = null
    if (f.uuidMesero) idMesero = (await this.identidad.resolverPorUuid(f.uuidMesero)).id

    const page = Math.max(1, f.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 25))

    /**
     * Base: participaciones de eventos cuya FECHA cae en el rango. Se filtra
     * por `evento.fecha` y no por `participacion.fecha_aparto` porque el
     * capitán piensa en "los eventos de marzo", no en cuándo se apuntó la gente.
     *
     * Se excluyen los eventos cancelados: nadie trabajó en ellos, y contarlos
     * como falta castigaría al mesero por una decisión del cliente.
     */
    const base = db
      .from('participacion_evento as pe')
      .join('evento as e', 'e.id_evento', 'pe.id_evento')
      .join('usuario as u', 'u.id_usuario', 'pe.id_usuario')
      .whereBetween('e.fecha', [f.fechaDesde, f.fechaHasta])
      .whereNot('e.estado', 'cancelado')

    if (idMesero) base.where('pe.id_usuario', idMesero)

    const totalFilas = await base.clone().countDistinct('pe.id_usuario as n')
    const total = Number(totalFilas[0]?.n ?? 0)

    const meseros = await base
      .clone()
      .groupBy('u.id_usuario', 'u.uuid_usuario', 'u.nombre', 'u.apellido_paterno', 'u.apellido_materno')
      .select(
        'u.id_usuario',
        'u.uuid_usuario',
        'u.nombre',
        'u.apellido_paterno',
        'u.apellido_materno'
      )
      /**
       * Los agregados van como `raw` completo: concatenar un `raw` con una
       * cadena lo convierte en "[object Object]" y PostgreSQL responde que la
       * columna no existe.
       *
       * Asistió = llegó al salón (`confirmo_llegada` en adelante), porque a
       * partir de ahí hay evidencia de presencia física verificada.
       *
       * Falta = fue seleccionado y no llegó. `aparto` no cuenta: apartar es
       * mostrar interés, y no ser elegido no es una falta.
       */
      .select(
        db.raw('count(*)::int as eventos_trabajados'),
        db.raw(
          `count(distinct case when pe.estado in
             ('confirmo_llegada','asignado','vinculo','salida')
             then pe.id_participacion end)::int as asistencias`
        ),
        db.raw(
          `count(distinct case when pe.estado in
             ('seleccionado','confirmo_asistencia')
             then pe.id_participacion end)::int as faltas`
        )
      )
      .orderBy('u.nombre')
      .offset((page - 1) * pageSize)
      .limit(pageSize)

    const filas = []
    for (const m of meseros) {
      const idsPart = db
        .from('participacion_evento as pe')
        .join('evento as e', 'e.id_evento', 'pe.id_evento')
        .where('pe.id_usuario', m.id_usuario)
        .whereBetween('e.fecha', [f.fechaDesde, f.fechaHasta])
        .whereNot('e.estado', 'cancelado')
        .select('pe.id_participacion')

      const [pagos] = await db
        .from('pago')
        .whereIn('id_participacion', idsPart.clone())
        .where('estado', 'pagado')
        .sum('monto as pagado')
        .count('* as n')

      const [pendiente] = await db
        .from('pago')
        .whereIn('id_participacion', idsPart.clone())
        .whereIn('estado', ['pendiente', 'fallido'])
        .sum('monto as por_cobrar')

      const calificaciones = await db
        .from('calificacion')
        .whereIn('id_participacion', idsPart.clone())
        .select('puntuacion')

      const solicitudes = await db
        .from('solicitud_servicio')
        .whereIn('id_participacion', idsPart.clone())
        .where('estado', 'atendida')
        .whereNotNull('atendida_en')
        .select('creada_en', 'atendida_en')

      filas.push({
        uuid_usuario: m.uuid_usuario,
        nombre: m.nombre,
        apellido_paterno: m.apellido_paterno,
        apellido_materno: m.apellido_materno,

        eventos_trabajados: Number(m.eventos_trabajados),
        asistencias: Number(m.asistencias),
        faltas: Number(m.faltas),

        pagos_acumulados: Number(pagos?.pagado ?? 0),
        pagos_recibidos: Number(pagos?.n ?? 0),
        por_cobrar: Number(pendiente?.por_cobrar ?? 0),

        calificaciones_recibidas: calificaciones.length,
        /** `null` y no 0: un promedio de cero diría que el servicio fue pésimo. */
        promedio_calificacion: calificaciones.length
          ? Number(
              (
                calificaciones.reduce((a, c) => a + c.puntuacion, 0) / calificaciones.length
              ).toFixed(2)
            )
          : null,
        calificaciones_bajas: calificaciones.filter((c) => c.puntuacion <= UMBRAL_BAJA).length,

        solicitudes_atendidas: solicitudes.length,
        segundos_respuesta_promedio: this.promedioRespuesta(solicitudes),

        /**
         * **Puntualidad: no se puede calcular honestamente hoy.**
         *
         * Haría falta comparar la hora de llegada con `hora_presentacion`, y
         * `CONFIRMACION_LLEGADA` guarda la marca del intento exitoso — pero el
         * mesero puede estar en el salón media hora antes de que el capitán le
         * pida confirmar, o confirmar tarde porque no había señal.
         *
         * Devolver un número inventado sería peor que no devolverlo: de esto
         * dependen decisiones sobre a quién se vuelve a llamar. Ver la nota del
         * documento de respuestas para lo que haría falta medirlo de verdad.
         */
        puntualidad: null,
      })
    }

    return {
      filas,
      periodo: { desde: f.fechaDesde, hasta: f.fechaHasta },
      meta: {
        page,
        page_size: pageSize,
        total,
        last_page: Math.max(1, Math.ceil(total / pageSize)),
      },
    }
  }

  /**
   * Segundos entre que el comensal pide y el mesero marca atendida.
   *
   * Mide el tiempo hasta que **se marca** atendida, no hasta que el mesero
   * llega a la mesa: es lo único que el sistema observa. Un mesero que atiende
   * rápido y marca tarde sale mal medido, así que el número sirve para comparar
   * entre personas, no como cifra absoluta.
   */
  private promedioRespuesta(
    solicitudes: Array<{ creada_en: Date | string; atendida_en: Date | string }>
  ): number | null {
    if (solicitudes.length === 0) return null

    const segundos = solicitudes.map(
      (s) => (new Date(s.atendida_en).getTime() - new Date(s.creada_en).getTime()) / 1000
    )
    const validos = segundos.filter((s) => s >= 0)
    if (validos.length === 0) return null

    return Math.round(validos.reduce((a, b) => a + b, 0) / validos.length)
  }
}
