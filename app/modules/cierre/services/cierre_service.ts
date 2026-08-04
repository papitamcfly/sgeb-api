import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import Evento from '#modules/eventos/models/evento'
import ParticipacionEvento from '#modules/participaciones/models/participacion_evento'
import ReporteMerma from '#modules/cierre/models/reporte_merma'
import MermaDetalle from '#modules/cierre/models/merma_detalle'
import Pago from '#modules/cierre/models/pago'
import { SgebError, errores } from '#shared/errors/sgeb_error'
import { IdentidadService } from '#modules/identidad/identidad_service'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CIERRE DEL EVENTO — mermas y pagos
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Aquí se mueve dinero, así que las reglas son más duras que en el resto del
 * dominio: nada se calcula sobre un evento a medio cerrar, y ningún importe se
 * recalcula después de dispersarse.
 */

export interface LineaMerma {
  tipo: 'vaso_roto' | 'plato_roto' | 'copa_rota' | 'comida_desperdiciada' | 'otro'
  descripcion?: string | null
  cantidad: number
  costoEstimado?: number | null
}

@inject()
export class CierreService {
  constructor(private identidad: IdentidadService) {}

  // ══════════════════════════════════════════════════════════════ mermas

  async listarMermas(idEvento: number) {
    const reportes = await ReporteMerma.query()
      .where('id_evento', idEvento)
      .preload('detalles')
      .orderBy('fecha', 'desc')

    /**
     * El costo estimado es opcional: el capitán no siempre puede valorar un
     * plato roto en el momento. Los nulos cuentan como cero para que el total
     * sea un número y no `null`, pero se reporta cuántos faltan por valorar:
     * un total de $0 con doce piezas sin costear diría algo falso.
     */
    let total = 0
    let sinCosto = 0

    for (const r of reportes) {
      for (const d of r.detalles) {
        if (d.costoEstimado === null) sinCosto += 1
        else total += Number(d.costoEstimado)
      }
    }

    return { reportes, costo_total: Number(total.toFixed(2)), piezas_sin_costear: sinCosto }
  }

  /**
   * Registra el reporte de merma del evento (RF-31).
   *
   * No exige que el evento esté finalizado: las piezas se rompen durante el
   * servicio y el capitán las va anotando. Sí exige que haya arrancado, porque
   * en borrador no hay nada que romper.
   */
  async registrarMerma(
    idEvento: number,
    uuidCapitan: string,
    datos: { observaciones?: string | null; detalles: LineaMerma[] }
  ): Promise<ReporteMerma> {
    const capitan = await this.identidad.resolverPorUuid(uuidCapitan)
    const evento = await Evento.find(idEvento)
    if (!evento) throw errores.noEncontrado('EVENTO', idEvento)

    if (!['en_curso', 'finalizado'].includes(evento.estado)) {
      throw new SgebError('SGEB-4013', {
        tecnico:
          `EVENTO id=${idEvento} estado='${evento.estado}'. ` +
          `Registrar merma requiere en_curso|finalizado.`,
      })
    }

    if (datos.detalles.length === 0) {
      throw new SgebError('SGEB-2001', { tecnico: 'REPORTE_MERMA sin líneas de detalle.' })
    }

    return db.transaction(async (trx) => {
      const reporte = await ReporteMerma.create(
        {
          idEvento,
          idGeneradoPor: capitan.id,
          observaciones: datos.observaciones ?? null,
          fecha: DateTime.now(),
        },
        { client: trx }
      )

      for (const d of datos.detalles) {
        await MermaDetalle.create(
          {
            idReporte: reporte.id,
            tipo: d.tipo,
            descripcion: d.descripcion ?? null,
            cantidad: d.cantidad,
            costoEstimado: d.costoEstimado ?? null,
          },
          { client: trx }
        )
      }

      await reporte.load('detalles')
      return reporte
    })
  }

  // ══════════════════════════════════════════════════════════════ pagos

  /**
   * Revisa si el evento está listo para calcular pagos, SIN calcular nada.
   *
   * Existe aparte del cálculo porque el capitán necesita ver qué le falta antes
   * de intentarlo: recibir un error tras pulsar "pagar" es peor que ver la lista
   * de pendientes en la pantalla de cierre.
   */
  async verificarCierre(idEvento: number) {
    const evento = await Evento.find(idEvento)
    if (!evento) throw errores.noEncontrado('EVENTO', idEvento)

    const participaciones = await ParticipacionEvento.query().where('id_evento', idEvento)
    const sinSalida = participaciones.filter((p) => p.estado !== 'salida')

    /** Un mesero sin CLABE vigente bloquea la dispersión (SGEB-4012). */
    const uuidsSinClabe: number[] = []
    for (const p of participaciones) {
      const cuenta = await db
        .from('datos_bancarios')
        .where('id_usuario', p.idUsuario)
        .where('activo', true)
        .first()
      if (!cuenta) uuidsSinClabe.push(p.id)
    }

    return {
      evento_finalizado: evento.estado === 'finalizado',
      participaciones_total: participaciones.length,
      participaciones_sin_salida: sinSalida.length,
      meseros_sin_clabe_vigente: uuidsSinClabe.length,
      listo: evento.estado === 'finalizado' && sinSalida.length === 0 && uuidsSinClabe.length === 0,
    }
  }

  /**
   * Calcula los pagos del evento (RF-32, RF-33, RF-37).
   *
   * Tres bloqueos, en este orden:
   *
   *   1. El evento debe estar finalizado. Calcular sobre uno en curso produce
   *      importes que después hay que corregir a mano.
   *   2. Ninguna participación sin salida verificada (SGEB-4015). Un mesero que
   *      no registró salida puede haberse ido antes de tiempo, y de eso depende
   *      si se le paga completo.
   *   3. Todos con CLABE vigente (SGEB-4012). Sin cuenta no hay a dónde
   *      transferir, y descubrirlo al dispersar deja pagos a medias.
   *
   * Es idempotente: volver a llamarlo no duplica pagos ni recalcula los que ya
   * se dispersaron. El importe de un pago ya `pagado` es historia, no un valor
   * derivado.
   */
  async calcularPagos(idEvento: number) {
    return db.transaction(async (trx) => {
      const evento = await Evento.query({ client: trx })
        .where('id_evento', idEvento)
        .forUpdate()
        .first()

      if (!evento) throw errores.noEncontrado('EVENTO', idEvento)

      if (evento.estado !== 'finalizado') {
        throw new SgebError('SGEB-4013', {
          tecnico:
            `EVENTO id=${idEvento} estado='${evento.estado}'. ` +
            `Calcular pagos requiere 'finalizado'.`,
        })
      }

      const participaciones = await ParticipacionEvento.query({ client: trx }).where(
        'id_evento',
        idEvento
      )

      const sinSalida = participaciones.filter((p) => p.estado !== 'salida')
      if (sinSalida.length > 0) {
        throw new SgebError('SGEB-4015', {
          tecnico:
            `${sinSalida.length} PARTICIPACION con estado != salida ` +
            `(ids: ${sinSalida.slice(0, 5).map((p) => p.id).join(', ')}). ` +
            `Bloqueo de cálculo de pagos (RF-32, RF-33).`,
        })
      }

      const creados: Pago[] = []
      let yaPagados = 0

      for (const p of participaciones) {
        const existente = await Pago.query({ client: trx })
          .where('id_participacion', p.id)
          .forUpdate()
          .first()

        /** Un pago ya dispersado es historia: no se recalcula. */
        if (existente && existente.estado === 'pagado') {
          yaPagados += 1
          continue
        }

        const cuenta = await trx
          .from('datos_bancarios')
          .where('id_usuario', p.idUsuario)
          .where('activo', true)
          .first()

        if (!cuenta) {
          throw new SgebError('SGEB-4012', {
            tecnico:
              `DATOS_BANCARIOS de id_usuario=${p.idUsuario}: sin cuenta activa. ` +
              `PARTICIPACION id=${p.id}. Bloqueo de dispersión (RF-37).`,
          })
        }

        if (existente) {
          /**
           * Un pago pendiente o fallido sí se actualiza: puede que la tarifa
           * cambiara o que el mesero corrigiera su CLABE tras un fallo.
           */
          existente.monto = evento.tarifaPorMesero
          existente.clabeDestino = cuenta.clabe
          existente.estado = 'pendiente'
          await existente.useTransaction(trx).save()
          creados.push(existente)
          continue
        }

        creados.push(
          await Pago.create(
            {
              idParticipacion: p.id,
              monto: evento.tarifaPorMesero,
              /** Snapshot: si el mesero cambia de cuenta, este registro dice a dónde se fue el dinero. */
              clabeDestino: cuenta.clabe,
              estado: 'pendiente',
            },
            { client: trx }
          )
        )
      }

      return {
        pagos: creados,
        total: Number(creados.reduce((a, p) => a + Number(p.monto), 0).toFixed(2)),
        ya_pagados: yaPagados,
      }
    })
  }

  async listarPagos(idEvento: number) {
    return Pago.query()
      .whereIn(
        'id_participacion',
        db.from('participacion_evento').select('id_participacion').where('id_evento', idEvento)
      )
      .orderBy('id_pago')
  }

  /**
   * Marca un pago como dispersado (RF-36).
   *
   * El pago se hace por transferencia manual, sin integración con banca. Este
   * endpoint solo registra que ocurrió, con su referencia. Por eso la
   * transición `pagado` es terminal: no hay a quién preguntarle si de verdad
   * llegó, así que revertirla dejaría el registro contradiciendo al banco.
   */
  async marcarPagado(idPago: number, referencia: string) {
    return db.transaction(async (trx) => {
      const pago = await Pago.query({ client: trx }).where('id_pago', idPago).forUpdate().first()
      if (!pago) throw errores.noEncontrado('PAGO', idPago)

      if (pago.estado === 'pagado') {
        throw new SgebError('SGEB-4011', {
          tecnico: `PAGO id=${idPago} ya está en estado 'pagado' desde ${pago.fechaPago?.toISO()}.`,
        })
      }

      if (pago.estado === 'cancelado') {
        throw errores.transicionInvalida('PAGO', idPago, 'cancelado', 'pagado')
      }

      pago.estado = 'pagado'
      pago.referencia = referencia.trim().toUpperCase()
      pago.fechaPago = DateTime.now()
      await pago.useTransaction(trx).save()
      return pago
    })
  }

  /** Registra que la transferencia falló, para reintentarla (SGEB-5004). */
  async marcarFallido(idPago: number, motivo: string) {
    const pago = await Pago.find(idPago)
    if (!pago) throw errores.noEncontrado('PAGO', idPago)

    if (pago.estado === 'pagado') {
      throw new SgebError('SGEB-4011', {
        tecnico: `PAGO id=${idPago} ya dispersado; no puede marcarse fallido.`,
      })
    }

    pago.estado = 'fallido'
    await pago.save()

    throw new SgebError('SGEB-5004', {
      tecnico:
        `Error al registrar transferencia por CLABE=` +
        `${pago.clabeDestino.slice(0, 4)}…${pago.clabeDestino.slice(-4)}. ` +
        `PAGO id=${idPago} → estado=fallido. Motivo: ${motivo}.`,
    })
  }
}
