import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CUBAITOR:SIMULAR — el dispositivo que todavía no está conectado
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node ace cubaitor:simular --evento=3
 *   node ace cubaitor:simular --evento=3 --fallar=20
 *   node ace cubaitor:simular --evento=3 --latido
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  PARA QUÉ SIRVE
 * ────────────────────────────────────────────────────────────────────────────
 * El seeder deja fotos fijas: una orden entregada, otra parcial, una botella
 * vacía. Sirve para ver cada pantalla, pero **no para probar el transcurso**.
 *
 * En el evento real pasa esto: el mesero pide, el servidor calcula, el
 * dispositivo abre la válvula, y **segundos después** reporta cuánto duró. Ese
 * hueco temporal es donde vive todo lo interesante — el tablero mostrando
 * "dispensando", el canal empujando `dispensado:cambio`, la botella bajando de
 * nivel hasta agotarse.
 *
 * Este comando hace de dispositivo: recorre los dispensados pendientes del
 * evento y los reporta como lo haría el ESP32, con su latencia y su margen de
 * error. Es el sustituto del cliente MQTT mientras no exista.
 *
 * **Nada de lo que hace es especial**: llama a `reportarDispensado`, el mismo
 * método que llamará el puente MQTT. Si esto funciona, aquello funcionará.
 */

/** Margen del caudal real frente al calibrado. El hardware nunca es exacto. */
const VARIACION = 0.04

export default class CubaitorSimular extends BaseCommand {
  static commandName = 'cubaitor:simular'
  static description = 'Simula al Cubaitor reportando los dispensados pendientes'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Evento a atender', required: true })
  declare evento: number

  @flags.number({
    description: 'Porcentaje de dispensados que saldrán cortos o sin reportar (0-100)',
    default: 0,
  })
  declare fallar: number

  @flags.boolean({ description: 'Solo enviar el latido de los dispositivos del evento' })
  declare latido: boolean

  @flags.boolean({ description: 'Repetir cada 3 segundos hasta interrumpir' })
  declare seguir: boolean

  async run() {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const { OrdenService } = await import('#modules/ordenes/services/orden_service')
    const { CubaitorService } = await import('#modules/cubaitor/services/cubaitor_service')

    if (this.app.inProduction) {
      this.logger.error('El simulador no corre en producción. Abortado.')
      return
    }

    const ordenes = await this.app.container.make(OrdenService)
    const cub = new CubaitorService()

    const evento = await db.from('evento').where('id_evento', this.evento).first()
    if (!evento) {
      this.logger.error(`No existe el evento ${this.evento}.`)
      return
    }
    this.logger.info(`Evento ${evento.id_evento}: ${evento.titulo} (${evento.estado})`)

    do {
      await this.latir(db, cub)
      if (!this.latido) await this.reportar(db, ordenes)
      if (this.seguir) await new Promise((r) => setTimeout(r, 3000))
    } while (this.seguir)
  }

  /**
   * Latido de los dispositivos del evento.
   *
   * Se envía siempre, incluso al reportar: un dispositivo que sirve bebidas
   * evidentemente está vivo, y sin el latido el dashboard lo marcaría fuera de
   * línea mientras trabaja.
   */
  private async latir(
    db: Awaited<typeof import('@adonisjs/lucid/services/db')>['default'],
    cub: InstanceType<typeof import('#modules/cubaitor/services/cubaitor_service').CubaitorService>
  ) {
    const dispositivos = await db
      .from('cubaitor')
      .whereIn(
        'id_cubaitor',
        db.from('config_dispensado').select('id_cubaitor').where('id_evento', this.evento)
      )
      .select('mac', 'nombre')

    for (const d of dispositivos) {
      await cub.heartbeat(d.mac)
      this.logger.info(`  ♥ ${d.nombre} (${d.mac})`)
    }
    if (dispositivos.length === 0) {
      this.logger.warning('  Sin dispositivos configurados en este evento.')
    }
  }

  /**
   * Reporta los dispensados que esperan confirmación.
   *
   * Un dispensado pendiente es una válvula abierta: el servidor ya descontó el
   * volumen y espera saber cuánto salió de verdad. Mientras no llegue el
   * reporte, la orden no avanza.
   */
  private async reportar(
    db: Awaited<typeof import('@adonisjs/lucid/services/db')>['default'],
    ordenes: InstanceType<typeof import('#modules/ordenes/services/orden_service').OrdenService>
  ) {
    const pendientes = await db
      .from('dispensado as d')
      .join('orden_detalle as od', 'od.id_detalle', 'd.id_detalle')
      .join('orden as o', 'o.id_orden', 'od.id_orden')
      .join('mesa as m', 'm.id_mesa', 'o.id_mesa')
      .where('m.id_evento', this.evento)
      /**
       * **No existe un estado `pendiente` en DISPENSADO.** La espera se
       * identifica por `segundos_real IS NULL`: la fila se crea con el tiempo
       * calculado y el real llega cuando el dispositivo reporta.
       *
       * Se excluyen los que ya tienen un desenlace: un `error` es una válvula
       * que se dio por cerrada, y volver a reportarlo reescribiría historia.
       */
      .whereNull('d.segundos_real')
      .whereNotIn('d.estado', ['error', 'pausado_por_insumo'])
      .select('d.id_dispensado', 'd.segundos_calculado', 'd.volumen_solicitado_ml', 'm.etiqueta')

    if (pendientes.length === 0) {
      if (!this.seguir) this.logger.info('  Sin dispensados pendientes.')
      return
    }

    for (const p of pendientes) {
      const calculado = Number(p.segundos_calculado)
      const falla = Math.random() * 100 < this.fallar

      /**
       * Tres desenlaces, con la proporción del hardware real:
       *
       *  · normal — ±4 % del tiempo calculado. El caudal nunca es exacto: la
       *    manguera se dobla, la botella baja de nivel.
       *  · corto  — 60-85 %. Queda `parcial` y el mesero debe ver la bebida.
       *  · mudo   — no reporta. Queda `error` (SGEB-5006).
       */
      let real: number | null
      let etiqueta: string

      if (!falla) {
        const factor = 1 + (Math.random() * 2 - 1) * VARIACION
        real = Number((calculado * factor).toFixed(2))
        etiqueta = 'ok'
      } else if (Math.random() < 0.7) {
        real = Number((calculado * (0.6 + Math.random() * 0.25)).toFixed(2))
        etiqueta = 'corto'
      } else {
        real = null
        etiqueta = 'sin reportar'
      }

      /**
       * La latencia importa: sin ella todos los reportes llegan en el mismo
       * milisegundo y el tablero nunca muestra el estado intermedio, que es
       * justo lo que hay que poder ver.
       */
      await new Promise((r) => setTimeout(r, Math.min(calculado * 1000, 2500)))

      try {
        await ordenes.reportarDispensado(p.id_dispensado, real)
      } catch (error) {
        /**
         * Con `real = null` el servicio marca el dispensado en `error` y
         * **luego lanza** SGEB-5006, para que quien reporta sepa que la válvula
         * quedó forzada a cierre. El efecto ya ocurrió; el simulador solo tiene
         * que no morirse por la señal.
         *
         * Cualquier otro error sí se propaga: sería un fallo de verdad.
         */
        const e = error as { codigo?: string }
        if (e.codigo !== 'SGEB-5006') throw error
      }

      const marca = etiqueta === 'ok' ? '✓' : etiqueta === 'corto' ? '~' : '✗'
      this.logger.info(
        `  ${marca} #${p.id_dispensado} ${p.etiqueta.padEnd(8)} ` +
          `${calculado}s → ${real === null ? '—' : real + 's'} (${etiqueta})`
      )
    }

    this.logger.success(`  ${pendientes.length} dispensados reportados.`)
  }
}
