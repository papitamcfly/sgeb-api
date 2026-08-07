import { DateTime } from 'luxon'
import MovimientoBitacora from '#modules/admin/models/movimiento_bitacora'
import { SgebError } from '#shared/errors/sgeb_error'

/** Tope del rango de consulta, para que una pantalla no tumbe la base. */
const MAX_DIAS = 366

export class BitacoraService {
  /**
   * Registra un movimiento auditable.
   *
   * **Nunca lanza.** Un fallo al escribir la bitacora no debe tumbar la
   * operacion que la genero: si el capitan desactiva una cuenta y la bitacora
   * falla, la cuenta debe quedar desactivada igual. Perder el registro es malo;
   * dejar la cuenta activa es peor.
   *
   * Se registran los cambios que alguien podria necesitar auditar despues —
   * altas y bajas, cambios de rol, ediciones de CLABE, cancelaciones de evento.
   * NO cada lectura ni cada operacion de servicio: una bitacora que registra
   * todo se vuelve ilegible y nadie la consulta.
   */
  async registrar(datos: {
    tipoEntidad: string
    idEntidad?: number | null
    accion: MovimientoBitacora['accion']
    uuidResponsable?: string | null
    detalle?: string | null
    ip?: string | null
  }): Promise<void> {
    try {
      await MovimientoBitacora.create({
        tipoEntidad: datos.tipoEntidad,
        idEntidad: datos.idEntidad ?? null,
        accion: datos.accion,
        uuidUsuarioResponsable: datos.uuidResponsable ?? null,
        detalle: datos.detalle?.slice(0, 500) ?? null,
        ip: datos.ip ?? null,
      })
    } catch {
      /** Silencioso a proposito. Ver la nota de arriba. */
    }
  }

  async listar(filtros: {
    tipoEntidad?: string
    accion?: string
    uuidResponsable?: string
    fechaDesde?: string
    fechaHasta?: string
    page?: number
    pageSize?: number
  }) {
    if (filtros.fechaDesde && filtros.fechaHasta) {
      const dias = DateTime.fromISO(filtros.fechaHasta).diff(
        DateTime.fromISO(filtros.fechaDesde),
        'days'
      ).days

      if (dias > MAX_DIAS) {
        throw new SgebError('SGEB-2015', {
          tecnico: `Rango solicitado=${Math.round(dias)} dias > maximo=${MAX_DIAS}.`,
        })
      }
    }

    const q = MovimientoBitacora.query().orderBy('timestamp', 'desc')

    if (filtros.tipoEntidad) q.where('tipo_entidad', filtros.tipoEntidad)
    if (filtros.accion) q.where('accion', filtros.accion)
    if (filtros.uuidResponsable) q.where('uuid_usuario_responsable', filtros.uuidResponsable)
    if (filtros.fechaDesde) q.where('timestamp', '>=', filtros.fechaDesde)
    if (filtros.fechaHasta) q.where('timestamp', '<=', `${filtros.fechaHasta} 23:59:59`)

    return q.paginate(filtros.page ?? 1, Math.min(filtros.pageSize ?? 50, 100))
  }
}
