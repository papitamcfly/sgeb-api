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
    const c = await Cubaitor.query().where('mac', mac.toUpperCase()).first()
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
