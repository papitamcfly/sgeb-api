import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Cubaitor from '#modules/cubaitor/models/cubaitor'
import ConfigDispensado from '#modules/cubaitor/models/config_dispensado'
import { SgebError, errores } from '#shared/errors/sgeb_error'

/** Umbral de heartbeat: sin reporte en este tiempo, el dispositivo se da por caído. */
const SEGUNDOS_SIN_CONEXION = 120

export class CubaitorService {
  async listar() {
    return Cubaitor.query().orderBy('nombre')
  }

  async obtener(id: number): Promise<Cubaitor> {
    const c = await Cubaitor.find(id)
    if (!c) throw errores.noEncontrado('CUBAITOR', id)
    return c
  }

  /**
   * Edita el dispositivo. La MAC no se cambia: es su identidad física y la
   * llave con la que se anuncia en el broker. Cambiarla equivale a otro
   * dispositivo, y los DISPENSADO históricos apuntarían al equipo equivocado.
   */
  async actualizar(
    id: number,
    datos: Partial<{ nombre: string; numPins: number; hostIp: string | null; estado: 'activo' | 'inactivo' | 'mantenimiento' }>
  ): Promise<Cubaitor> {
    const c = await this.obtener(id)
    if (datos.nombre) c.nombre = datos.nombre.trim()
    if (datos.numPins !== undefined) c.numPins = datos.numPins
    if (datos.hostIp !== undefined) c.hostIp = datos.hostIp
    if (datos.estado) c.estado = datos.estado
    await c.save()
    return c
  }

  /**
   * Baja lógica del dispositivo. Se rechaza si tiene pines configurados en
   * eventos vigentes: esas barras se quedarían sin poder servir a media fiesta.
   */
  async desactivar(id: number): Promise<Cubaitor> {
    return db.transaction(async (trx) => {
      const c = await Cubaitor.query({ client: trx }).where('id_cubaitor', id).forUpdate().first()
      if (!c) throw errores.noEncontrado('CUBAITOR', id)
      if (c.estado === 'inactivo') return c

      const [{ count }] = await trx
        .from('config_dispensado')
        .join('evento', 'evento.id_evento', 'config_dispensado.id_evento')
        .where('config_dispensado.id_cubaitor', id)
        .where('config_dispensado.activo', true)
        .whereIn('evento.estado', ['publicado', 'en_curso'])
        .count('* as count')

      if (Number(count) > 0) {
        throw errores.enUso('CUBAITOR', id, 'CONFIG_DISPENSADO de eventos vigentes', Number(count))
      }

      c.estado = 'inactivo'
      await c.useTransaction(trx).save()
      return c
    })
  }

  async registrar(datos: { nombre: string; mac: string; numPins: number; hostIp?: string | null }) {
    return Cubaitor.create({
      nombre: datos.nombre.trim(),
      /** MAC en mayúsculas por convención del Diccionario; es la llave única. */
      mac: datos.mac.toUpperCase(),
      numPins: datos.numPins,
      hostIp: datos.hostIp ?? null,
      estado: 'activo',
      ultimaConexion: null,
    })
  }

  /**
   * Salud del dispositivo, para el semáforo de la barra en el dashboard.
   *
   * Un Cubaitor caído NO bloquea el evento: se habilita el dispensado manual y
   * el servicio continúa (RNF-13). Detener la barra porque un ESP32 dejó de
   * responder sería peor que servir a mano.
   */
  async estado(id: number) {
    const c = await Cubaitor.find(id)
    if (!c) throw errores.noEncontrado('CUBAITOR', id)

    const segundos = c.ultimaConexion
      ? Math.round(DateTime.now().diff(c.ultimaConexion, 'seconds').seconds)
      : null

    const enLinea = segundos !== null && segundos <= SEGUNDOS_SIN_CONEXION

    const [{ pines }] = await db
      .from('config_dispensado')
      .where('id_cubaitor', id)
      .where('activo', true)
      .count('* as pines')

    return {
      id_cubaitor: c.id,
      nombre: c.nombre,
      mac: c.mac,
      en_linea: enLinea,
      ultima_conexion: c.ultimaConexion,
      segundos_sin_reportar: segundos,
      pines_configurados: Number(pines),
    }
  }

  async heartbeat(mac: string) {
    const c = await Cubaitor.query().whereILike('mac', mac).first()
    if (!c) throw errores.noEncontrado('CUBAITOR', mac)

    c.ultimaConexion = DateTime.now()
    if (c.estado === 'inactivo') c.estado = 'activo'
    await c.save()
    return c
  }

  // ══════════════════════════════════════════════════ configuración de pines

  async listarConfig(idEvento: number) {
    return ConfigDispensado.query().where('id_evento', idEvento).where('activo', true).orderBy('pin_gpio')
  }

  /**
   * Recalibra un pin.
   *
   * `caudalMlSeg` es lo que se ajusta en la práctica: la manguera se dobla, la
   * botella baja de nivel y el caudal cambia.
   */
  async actualizarConfig(
    idConfig: number,
    datos: Partial<{ caudalMlSeg: number; pinGpio: number; idInsumo: number; volumenCargadoMl: number }>
  ): Promise<ConfigDispensado> {
    const c = await ConfigDispensado.find(idConfig)
    if (!c) throw errores.noEncontrado('CONFIG_DISPENSADO', idConfig)

    if (datos.caudalMlSeg !== undefined) {
      c.caudalMlSeg = datos.caudalMlSeg
      c.ultimaCalibracion = DateTime.now()
    }
    if (datos.pinGpio !== undefined) c.pinGpio = datos.pinGpio
    if (datos.idInsumo !== undefined) c.idInsumo = datos.idInsumo
    if (datos.volumenCargadoMl !== undefined) {
      // Ajustamos tanto el volumen de carga como el volumen actual si se resetea la botella
      c.volumenCargadoMl = datos.volumenCargadoMl
      c.volumenDisponibleMl = datos.volumenCargadoMl
    }

    try {
      await c.save()
    } catch (error) {
      const e = error as { code?: string; constraint?: string }
      if (e.code === '23505' && e.constraint?.includes('pin_unico')) {
        throw new SgebError('SGEB-4019', {
          tecnico: `pin_gpio=${datos.pinGpio} ya asignado en el mismo cubaitor y evento.`,
          causa: error,
        })
      }
      throw error
    }
    return c
  }

  /**
   * Baja lógica de la configuración de un pin.
   *
   * Se rechaza si hay órdenes vivas que dependen de ese insumo: quedarían
   * pausadas sin que nadie entienda por qué, porque el pin del que dependían
   * dejó de existir para el sistema.
   */
  async desactivarConfig(idConfig: number): Promise<void> {
    return db.transaction(async (trx) => {
      const c = await ConfigDispensado.query({ client: trx })
        .where('id_config', idConfig)
        .forUpdate()
        .first()

      if (!c) throw errores.noEncontrado('CONFIG_DISPENSADO', idConfig)

      const [{ count }] = await trx
        .from('orden_detalle')
        .whereIn('estado', ['pendiente', 'pausada_por_insumo'])
        .whereIn(
          'id_bebida',
          trx.from('receta_ingrediente').select('id_bebida').where('id_insumo', c.idInsumo)
        )
        .count('* as count')

      if (Number(count) > 0) {
        throw errores.enUso('CONFIG_DISPENSADO', idConfig, 'ORDEN_DETALLE en curso', Number(count))
      }

      c.activo = false
      await c.useTransaction(trx).save()
    })
  }

  /**
   * Alertas operativas del evento.
   *
   * No hay tabla de alertas: se derivan del estado actual. Guardarlas obligaría
   * a mantenerlas sincronizadas con la realidad —marcar como resuelta la de una
   * botella que ya se recargó—, y una alerta obsoleta es peor que ninguna.
   */
  async alertas(idEvento: number) {
    const configs = await ConfigDispensado.query()
      .where('id_evento', idEvento)
      .where('activo', true)

    const alertas: Array<Record<string, unknown>> = []

    for (const c of configs) {
      const insumo = await db.from('insumo').where('id_insumo', c.idInsumo).first()
      const porcentaje = c.volumenCargadoMl > 0 ? (c.volumenDisponibleMl / c.volumenCargadoMl) * 100 : 0

      if (c.volumenDisponibleMl <= 0) {
        alertas.push({
          tipo: 'botella_vacia', codigo: 'SGEB-4009', severidad: 'alta',
          id_config: c.id, pin_gpio: c.pinGpio, id_insumo: c.idInsumo,
          insumo: insumo?.nombre, volumen_disponible_ml: c.volumenDisponibleMl,
        })
      } else if (porcentaje <= 15) {
        /** Aviso temprano: a 15 % queda tiempo de cambiar la botella sin pausar nada. */
        alertas.push({
          tipo: 'botella_baja', codigo: 'SGEB-0003', severidad: 'media',
          id_config: c.id, pin_gpio: c.pinGpio, id_insumo: c.idInsumo,
          insumo: insumo?.nombre, volumen_disponible_ml: c.volumenDisponibleMl,
          porcentaje: Number(porcentaje.toFixed(1)),
        })
      }
    }

    const cubaitors = await db
      .from('cubaitor')
      .whereIn('id_cubaitor', configs.map((c) => c.idCubaitor))

    for (const cub of cubaitors) {
      const seg = cub.ultima_conexion
        ? Math.round(DateTime.now().diff(DateTime.fromJSDate(new Date(cub.ultima_conexion)), 'seconds').seconds)
        : null

      if (seg === null || seg > SEGUNDOS_SIN_CONEXION) {
        alertas.push({
          tipo: 'cubaitor_sin_conexion', codigo: 'SGEB-5003', severidad: 'alta',
          id_cubaitor: cub.id_cubaitor, nombre: cub.nombre,
          segundos_sin_reportar: seg,
          nota: 'El evento continúa con dispensado manual (RNF-13).',
        })
      }
    }

    const [{ pausadas }] = await db
      .from('orden')
      .where('estado', 'pausada_por_insumo')
      .whereIn('id_mesa', db.from('mesa').select('id_mesa').where('id_evento', idEvento))
      .count('* as pausadas')

    return {
      alertas,
      total: alertas.length,
      ordenes_pausadas: Number(pausadas),
      severidad_maxima: alertas.some((a) => a.severidad === 'alta')
        ? 'alta'
        : alertas.length > 0
          ? 'media'
          : null,
    }
  }

  async configurarPin(datos: {
    idEvento: number
    idCubaitor: number
    idInsumo: number
    pinGpio: number
    caudalMlSeg: number
    volumenCargadoMl: number
  }) {
    /**
     * ────────────────────────────────────────────────────────────────────
     *  El INSERT va dentro de una transacción anidada (SAVEPOINT).
     * ────────────────────────────────────────────────────────────────────
     * PostgreSQL aborta la transacción COMPLETA ante cualquier error, y toda
     * consulta posterior responde "current transaction is aborted". Atrapar la
     * violación de unicidad y seguir adelante no basta: si esta llamada ocurre
     * dentro de una transacción mayor —otro servicio orquestando varios pasos,
     * o una prueba envuelta en transacción— el `catch` devuelve un error
     * bonito sobre una transacción ya inservible, y lo siguiente falla con un
     * mensaje que no tiene nada que ver.
     *
     * El SAVEPOINT acota el daño: si el INSERT falla se vuelve al punto previo
     * y la transacción del llamador sigue viva.
     *
     * Regla general: **si vas a CAPTURAR una violación de constraint y
     * continuar, tienes que aislarla en un savepoint.**
     */
    try {
      return await db.transaction(async (trx) =>
        ConfigDispensado.create(
          {
            ...datos,
            volumenDisponibleMl: datos.volumenCargadoMl,
            ultimaCalibracion: DateTime.now(),
            activo: true,
          },
          { client: trx }
        )
      )
    } catch (error) {
      const e = error as { code?: string; constraint?: string }
      if (e.code === '23505' && e.constraint?.includes('pin_unico')) {
        /**
         * SGEB-4019. Dos insumos peleando el mismo GPIO significa que una de
         * las bebidas sale con el líquido equivocado, y no hay forma de
         * detectarlo salvo probándola.
         */
        throw new SgebError('SGEB-4019', {
          tecnico:
            `pin_gpio=${datos.pinGpio} ya asignado en CUBAITOR id=${datos.idCubaitor} ` +
            `para el evento ${datos.idEvento}.`,
          causa: error,
        })
      }
      throw error
    }
  }

  /**
   * Registra la recarga de una botella y reanuda lo que estaba pausado.
   *
   * Es la contraparte operativa de SGEB-4009: el capitán cambia la botella
   * física, marca la recarga, y las órdenes que esperaban ese insumo vuelven a
   * la cola sin que el mesero tenga que volver a capturarlas.
   */
  async recargar(idConfig: number, volumenCargadoMl: number, reanudarOrdenes = true) {
    return db.transaction(async (trx) => {
      const config = await ConfigDispensado.query({ client: trx })
        .where('id_config', idConfig)
        .forUpdate()
        .first()

      if (!config) throw errores.noEncontrado('CONFIG_DISPENSADO', idConfig)

      config.volumenCargadoMl = volumenCargadoMl
      config.volumenDisponibleMl = volumenCargadoMl
      await config.useTransaction(trx).save()

      await trx
        .from('insumo')
        .where('id_insumo', config.idInsumo)
        .where('estado', 'agotado')
        .update({ estado: 'disponible' })

      let reanudadas = 0
      if (reanudarOrdenes) {
        const detalles = await trx
          .from('orden_detalle')
          .where('estado', 'pausada_por_insumo')
          .whereIn(
            'id_bebida',
            trx.from('receta_ingrediente').select('id_bebida').where('id_insumo', config.idInsumo)
          )
          .select('id_detalle', 'id_orden')

        if (detalles.length > 0) {
          await trx
            .from('orden_detalle')
            .whereIn('id_detalle', detalles.map((d) => d.id_detalle))
            .update({ estado: 'pendiente' })

          await trx
            .from('orden')
            .whereIn('id_orden', detalles.map((d) => d.id_orden))
            .where('estado', 'pausada_por_insumo')
            .update({ estado: 'pendiente' })

          reanudadas = detalles.length
        }
      }

      return { config, detallesReanudados: reanudadas }
    })
  }
}
