import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import { inject } from '@adonisjs/core'
import Orden from '#modules/ordenes/models/orden'
import OrdenDetalle from '#modules/ordenes/models/orden_detalle'
import Dispensado from '#modules/ordenes/models/dispensado'
import Bebida from '#modules/menu/models/bebida'
import Envase from '#modules/menu/models/envase'
import Mesa from '#modules/eventos/models/mesa'
import ParticipacionEvento from '#modules/participaciones/models/participacion_evento'
import ConfigDispensado from '#modules/cubaitor/models/config_dispensado'
import { RecetaCalculo } from '#modules/menu/services/receta_calculo'
import { SgebError, errores } from '#shared/errors/sgeb_error'

/**
 * Órdenes y dispensado automático.
 *
 * El camino completo: el mesero levanta la ORDEN, cada renglón es un
 * ORDEN_DETALLE, y cada apertura de electroválvula deja un DISPENSADO que
 * permite auditar cuánto líquido salió de verdad contra cuánto se pidió.
 */

/** Tope de negocio del Diccionario: 50 unidades por renglón. */
const MAX_CANTIDAD = 50

export interface LineaOrden {
  idBebida: number
  idEnvase: number
  cantidad: number
}

@inject()
export class OrdenService {
  constructor(private receta: RecetaCalculo) {}

  async listarPorEvento(idEvento: number, filtros: { estado?: string; idMesa?: number } = {}) {
    const q = Orden.query()
      .whereIn('id_mesa', db.from('mesa').select('id_mesa').where('id_evento', idEvento))
      /**
       * Los dispensados vienen anidados para que el tablero se rehidrate con
       * UNA consulta. Sin esto, tras recargar la página el frontend perdía qué
       * dispensados esperaban confirmación, y la alternativa era un GET por
       * cada detalle: N+1 peticiones en la pantalla que más se refresca.
       */
      .preload('detalles', (d) => d.preload('dispensados'))
      .orderBy('creada_en', 'desc')

    if (filtros.estado) q.where('estado', filtros.estado)
    if (filtros.idMesa) q.where('id_mesa', filtros.idMesa)
    return q
  }

  async obtener(id: number): Promise<Orden> {
    const orden = await Orden.query()
      .where('id_orden', id)
      .preload('detalles', (d) => d.preload('dispensados'))
      .first()
    if (!orden) throw errores.noEncontrado('ORDEN', id)
    return orden
  }

  /**
   * El mesero levanta una orden desde la mesa.
   *
   * El `volumen_total_ml` se congela aquí. Si después alguien corrige el volumen
   * del envase en el catálogo, esta orden conserva el que se usó: de lo
   * contrario cambiaría el consumo histórico de insumos de eventos ya cerrados.
   */
  async crear(datos: {
    idMesa: number
    idParticipacion: number
    lineas: LineaOrden[]
  }): Promise<Orden> {
    if (datos.lineas.length === 0) {
      throw new SgebError('SGEB-2001', { tecnico: 'ORDEN sin líneas de detalle.' })
    }

    return db.transaction(async (trx) => {
      const mesa = await Mesa.query({ client: trx })
        .where('id_mesa', datos.idMesa)
        .preload('evento')
        .first()

      if (!mesa) throw errores.noEncontrado('MESA', datos.idMesa)

      if (mesa.evento.estado !== 'en_curso') {
        throw new SgebError('SGEB-4013', {
          tecnico:
            `EVENTO id=${mesa.evento.id} estado='${mesa.evento.estado}'. ` +
            `Levantar órdenes requiere 'en_curso'.`,
        })
      }

      const p = await ParticipacionEvento.query({ client: trx })
        .where('id_participacion', datos.idParticipacion)
        .first()

      if (!p) throw errores.noEncontrado('PARTICIPACION_EVENTO', datos.idParticipacion)

      if (p.idEvento !== mesa.idEvento) {
        throw new SgebError('SGEB-3002', {
          tecnico:
            `PARTICIPACION id=${p.id} es del evento ${p.idEvento}, ` +
            `pero la MESA ${mesa.id} es del evento ${mesa.idEvento}.`,
        })
      }

      const orden = await Orden.create(
        { idMesa: datos.idMesa, idParticipacion: datos.idParticipacion, estado: 'pendiente' },
        { client: trx }
      )

      for (const linea of datos.lineas) {
        if (linea.cantidad < 1 || linea.cantidad > MAX_CANTIDAD) {
          throw new SgebError('SGEB-2012', {
            tecnico: `cantidad=${linea.cantidad} fuera del tope de negocio [1, ${MAX_CANTIDAD}].`,
          })
        }

        const bebida = await Bebida.find(linea.idBebida, { client: trx })
        if (!bebida) {
          throw new SgebError('SGEB-3002', {
            tecnico: `id_bebida=${linea.idBebida} no existe en BEBIDA.`,
          })
        }
        if (!bebida.activo) throw errores.desactivado('BEBIDA', bebida.id)

        const envase = await Envase.find(linea.idEnvase, { client: trx })
        if (!envase) {
          throw new SgebError('SGEB-3002', {
            tecnico: `id_envase=${linea.idEnvase} no existe en ENVASE.`,
          })
        }
        if (!envase.activo) throw errores.desactivado('ENVASE', envase.id)

        await OrdenDetalle.create(
          {
            idOrden: orden.id,
            idBebida: linea.idBebida,
            idEnvase: linea.idEnvase,
            cantidad: linea.cantidad,
            volumenTotalMl: envase.volumenMl * linea.cantidad,
            estado: 'pendiente',
          },
          { client: trx }
        )
      }

      await orden.load('detalles')
      return { orden, idEvento: mesa.idEvento }
    }).then((r) => {
      emitter.emit('orden:cambio', {
        idEvento: r.idEvento,
        idOrden: r.orden.id,
        idMesa: r.orden.idMesa,
        estado: r.orden.estado,
      })
      return r.orden
    })
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  PROCESAR UN RENGLÓN: receta → mililitros → segundos de válvula
   * ═══════════════════════════════════════════════════════════════════════
   *
   * El descuento de volumen y la verificación de botella vacía van DENTRO de la
   * transacción, con bloqueo de la configuración del pin. Dos meseros pidiendo
   * cubas a la vez leerían ambos "quedan 200 ml" y el segundo serviría de una
   * botella ya agotada.
   *
   * Si algún insumo no alcanza, **nada se dispensa**: la orden entera se pausa
   * (SGEB-4008/4009) en vez de servir medio vaso y dejar al comensal con una
   * bebida a medias que igual hay que tirar.
   */
  async procesarDetalle(idDetalle: number) {
    /**
     * La pausa tiene que SOBREVIVIR al throw. Hacerla dentro de la transacción
     * la desharía el rollback que provoca la excepción, y la orden quedaría en
     * 'pendiente': el mesero vería el error, volvería a intentar, y el sistema
     * nunca registraría que hay una botella vacía esperando al capitán.
     *
     * Mismo patrón que la revocación por reúso de token en el módulo de
     * identidad. Regla general: si un efecto debe sobrevivir al `throw`, no
     * puede vivir en la transacción que el `throw` revierte.
     */
    let pausar: {
      idOrden: number
      idDetalle: number
      idEvento: number
      idMesa: number
      idInsumo: number
      nombreInsumo: string
      motivo: 'botella_vacia' | 'sin_configuracion'
      codigo: 'SGEB-4008' | 'SGEB-4009'
    } | null = null

    try {
      return await db.transaction(async (trx) => {
      const detalle = await OrdenDetalle.query({ client: trx })
        .where('id_detalle', idDetalle)
        .forUpdate()
        .first()

      if (!detalle) throw errores.noEncontrado('ORDEN_DETALLE', idDetalle)

      if (detalle.estado !== 'pendiente') {
        throw errores.transicionInvalida('ORDEN_DETALLE', idDetalle, detalle.estado, 'dispensada')
      }

      const orden = await Orden.findOrFail(detalle.idOrden, { client: trx })
      const mesa = await Mesa.findOrFail(orden.idMesa, { client: trx })

      const bebida = await Bebida.query({ client: trx })
        .where('id_bebida', detalle.idBebida)
        .preload('receta')
        .firstOrFail()

      const envase = await Envase.findOrFail(detalle.idEnvase, { client: trx })

      // ── 1. Receta → mililitros por insumo ─────────────────────────────
      const vertidos = this.receta.calcular(bebida.receta, envase.volumenMl)

      // ── 2. Verificar TODOS los insumos antes de tocar ninguno ─────────
      const planes: Array<{ config: ConfigDispensado; ml: number; segundos: number }> = []

      for (const v of vertidos) {
        const mlTotal = v.ml * detalle.cantidad

        const config = await ConfigDispensado.query({ client: trx })
          .where('id_evento', mesa.idEvento)
          .where('id_insumo', v.idInsumo)
          .where('activo', true)
          .forUpdate()
          .first()

        if (!config) {
          /**
           * El insumo existe en la receta pero nadie lo cargó en un pin para
           * este evento. Se pausa igual que si estuviera agotado: el resultado
           * para el comensal es el mismo, y el capitán tiene que actuar.
           */
          const ins = await trx.from('insumo').where('id_insumo', v.idInsumo).first()
          pausar = {
            idOrden: orden.id, idDetalle: detalle.id, idEvento: mesa.idEvento,
            idMesa: orden.idMesa, idInsumo: v.idInsumo,
            nombreInsumo: ins?.nombre ?? `insumo ${v.idInsumo}`,
            motivo: 'sin_configuracion', codigo: 'SGEB-4008',
          }
          throw new SgebError('SGEB-4008', {
            tecnico:
              `INSUMO id=${v.idInsumo} sin CONFIG_DISPENSADO activa en evento ${mesa.idEvento}. ` +
              `ORDEN id=${orden.id} → pausada_por_insumo.`,
          })
        }

        // ── SGEB-4009: umbral matemático de botella vacía ───────────────
        if (config.volumenDisponibleMl < mlTotal) {
          const ins2 = await trx.from('insumo').where('id_insumo', v.idInsumo).first()
          pausar = {
            idOrden: orden.id, idDetalle: detalle.id, idEvento: mesa.idEvento,
            idMesa: orden.idMesa, idInsumo: v.idInsumo,
            nombreInsumo: ins2?.nombre ?? `insumo ${v.idInsumo}`,
            motivo: 'botella_vacia', codigo: 'SGEB-4009',
          }
          throw new SgebError('SGEB-4009', {
            tecnico:
              `volumen_solicitado_ml=${mlTotal} > volumen_disponible_ml=` +
              `${config.volumenDisponibleMl} en CONFIG_DISPENSADO id=${config.id}, ` +
              `pin=${config.pinGpio}. Válvula NO abierta. Dispara ALERTA_BOTELLA_VACIA.`,
          })
        }

        planes.push({ config, ml: mlTotal, segundos: this.receta.segundos(mlTotal, config.caudalMlSeg) })
      }

      // ── 3. Ahora sí: registrar dispensados y descontar volumen ────────
      const dispensados: Dispensado[] = []

      for (const plan of planes) {
        dispensados.push(
          await Dispensado.create(
            {
              idDetalle: detalle.id,
              idConfig: plan.config.id,
              volumenSolicitadoMl: plan.ml,
              segundosCalculado: plan.segundos,
              segundosReal: null,
              volumenRealEstimadoMl: null,
              estado: 'ok',
            },
            { client: trx }
          )
        )

        plan.config.volumenDisponibleMl -= plan.ml
        await plan.config.useTransaction(trx).save()
      }

      detalle.estado = 'dispensada'
      await detalle.useTransaction(trx).save()

      if (orden.estado === 'pendiente') {
        orden.estado = 'en_preparacion'
        await orden.useTransaction(trx).save()
      }

      return {
        id_detalle: detalle.id,
        idEvento: mesa.idEvento,
        idOrden: orden.id,
        idMesa: orden.idMesa,
        estadoOrden: orden.estado,
        instrucciones: dispensados.map((d, i) => ({
          id_dispensado: d.id,
          pin_gpio: planes[i].config.pinGpio,
          volumen_ml: planes[i].ml,
          segundos: planes[i].segundos,
        })),
      }
      })
    } finally {
      if (pausar !== null) {
        const p = pausar as {
          idOrden: number
          idDetalle: number
          idEvento: number
          idMesa: number
          idInsumo: number
          nombreInsumo: string
          motivo: 'botella_vacia' | 'sin_configuracion'
          codigo: 'SGEB-4008' | 'SGEB-4009'
        }
        await db.from('orden_detalle').where('id_detalle', p.idDetalle).update({ estado: 'pausada_por_insumo' })
        await db.from('orden').where('id_orden', p.idOrden).update({ estado: 'pausada_por_insumo' })

        /**
         * La alerta que más importa del canal: sin tiempo real, el capitán se
         * entera de la botella vacía cuando un mesero se lo dice, y para
         * entonces hay órdenes acumuladas en pausa.
         */
        const [{ pausadas }] = await db
          .from('orden')
          .where('estado', 'pausada_por_insumo')
          .whereIn('id_mesa', db.from('mesa').select('id_mesa').where('id_evento', p.idEvento))
          .count('* as pausadas')

        emitter.emit('orden:cambio', {
          idEvento: p.idEvento,
          idOrden: p.idOrden,
          idMesa: p.idMesa,
          estado: 'pausada_por_insumo',
        })
        emitter.emit('alerta:insumo', {
          idEvento: p.idEvento,
          idInsumo: p.idInsumo,
          nombreInsumo: p.nombreInsumo,
          motivo: p.motivo,
          codigo: p.codigo,
          ordenesPausadas: Number(pausadas),
        })
      }
    }
  }

  /**
   * El Cubaitor reporta cuánto estuvo abierta la válvula.
   *
   * La diferencia entre lo calculado y lo real es lo que delata una calibración
   * desviada antes de que se note en el inventario. Se guarda tal cual, sin
   * corregirla: el volumen ya descontado fue el teórico, y ajustarlo aquí
   * mezclaría dos fuentes de verdad.
   */
  async reportarDispensado(idDispensado: number, segundosReal: number | null) {
    const d = await Dispensado.find(idDispensado)
    if (!d) throw errores.noEncontrado('DISPENSADO', idDispensado)

    if (segundosReal === null) {
      d.estado = 'error'
      await d.save()
      throw new SgebError('SGEB-5006', {
        tecnico:
          `Timeout: segundos_real no reportado (segundos_calculado=${d.segundosCalculado}). ` +
          `DISPENSADO id=${d.id} → error. Válvula forzada a cierre.`,
      })
    }

    const config = await ConfigDispensado.findOrFail(d.idConfig)
    const real = Math.round(segundosReal * config.caudalMlSeg)

    d.segundosReal = segundosReal
    d.volumenRealEstimadoMl = real

    /**
     * Tolerancia del 10 %. Por debajo se marca `parcial`: la bebida salió
     * incompleta y el mesero tiene que verla antes de llevarla a la mesa.
     */
    d.estado = real >= d.volumenSolicitadoMl * 0.9 ? 'ok' : 'parcial'
    await d.save()

    const ctx = await db
      .from('orden_detalle')
      .join('orden', 'orden.id_orden', 'orden_detalle.id_orden')
      .join('mesa', 'mesa.id_mesa', 'orden.id_mesa')
      .where('orden_detalle.id_detalle', d.idDetalle)
      .select('mesa.id_evento')
      .first()

    if (ctx) {
      emitter.emit('dispensado:cambio', {
        idEvento: ctx.id_evento,
        idDispensado: d.id,
        idDetalle: d.idDetalle,
        pinGpio: config.pinGpio,
        estado: d.estado,
        volumenMl: real,
        segundos: segundosReal,
      })
    }
    return d
  }

  /** Cambia el estado de la orden respetando la máquina del Diccionario. */
  async cambiarEstado(id: number, nuevo: Orden['estado']): Promise<Orden> {
    const permitidas: Record<string, string[]> = {
      pendiente: ['en_preparacion', 'cancelada'],
      en_preparacion: ['dispensando', 'entregada', 'pausada_por_insumo', 'cancelada'],
      dispensando: ['entregada', 'pausada_por_insumo', 'cancelada'],
      pausada_por_insumo: ['en_preparacion', 'cancelada'],
      entregada: [],
      cancelada: [],
    }

    return db.transaction(async (trx) => {
      const orden = await Orden.query({ client: trx }).where('id_orden', id).forUpdate().first()
      if (!orden) throw errores.noEncontrado('ORDEN', id)

      if (!permitidas[orden.estado].includes(nuevo)) {
        throw errores.transicionInvalida('ORDEN', id, orden.estado, nuevo)
      }

      if (nuevo === 'entregada') {
        const pendientes = await OrdenDetalle.query({ client: trx })
          .where('id_orden', id)
          .whereIn('estado', ['pendiente', 'pausada_por_insumo'])

        if (pendientes.length > 0) {
          throw new SgebError('SGEB-4011', {
            tecnico:
              `ORDEN id=${id} con ${pendientes.length} detalles sin dispensar. ` +
              `No se puede entregar una orden incompleta.`,
          })
        }
        orden.entregadaEn = DateTime.now()
      }

      orden.estado = nuevo
      await orden.useTransaction(trx).save()
      const mesa = await Mesa.findOrFail(orden.idMesa, { client: trx })
      return { orden, idEvento: mesa.idEvento }
    }).then((r) => {
      emitter.emit('orden:cambio', {
        idEvento: r.idEvento,
        idOrden: r.orden.id,
        idMesa: r.orden.idMesa,
        estado: r.orden.estado,
      })
      return r.orden
    })
  }
}
