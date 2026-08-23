import mqtt, { MqttClient } from 'mqtt'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

/**
 * Servicio MQTT para comunicación directa con el hardware (Cubaitor).
 */
export class MqttService {
  private client: MqttClient | null = null

  public connect() {
    if (this.client) return

    const url = env.get('MQTT_URL')
    const username = env.get('MQTT_USERNAME')
    const password = env.get('MQTT_PASSWORD')

    if (!url) {
      logger.warn('MQTT_URL no está definido. Cliente MQTT deshabilitado.')
      return
    }

    this.client = mqtt.connect(url, {
      username,
      password,
      reconnectPeriod: 5000,
    })

    this.client.on('connect', () => {
      logger.info(`Conectado al broker MQTT en ${url}`)
      // Suscribirse a telemetría de válvulas y latido de gateways
      this.client?.subscribe(['sgeb/+/+/telemetria', 'sgeb/+/gateway/status', 'sgeb/+/heartbeat'], { qos: 1 }, (err) => {
        if (err) logger.error({ err }, 'Error suscribiendo a MQTT')
        else logger.info('Suscrito a telemetría y status MQTT (sgeb/+/+/telemetria, sgeb/+/gateway/status)')
      })
    })

    this.client.on('error', (err) => {
      logger.error({ err }, 'Error en conexión MQTT')
    })

    this.client.on('message', async (topic, payload) => {
      try {
        // 1. Manejo de heartbeat o status del Gateway
        if (topic.includes('/gateway/status') || topic.includes('/heartbeat')) {
          const partes = topic.split('/')
          const mac = partes[1] // ej: "barra1"
          if (mac) {
            const { CubaitorService } = await import('#modules/cubaitor/services/cubaitor_service')
            const cubService = new CubaitorService()
            await cubService.heartbeat(mac)
            logger.debug({ mac, topic }, 'Heartbeat de Cubaitor actualizado vía MQTT')
          }
          return
        }

        const data = JSON.parse(payload.toString())
        
        // 2. El dispositivo reporta estado cerrada al terminar de dispensar
        // {"tipo": "estado", "estado": "cerrada", "causa": "auto_cierre", "ts_ms": 95028, "id": 1042, "ts_apertura_ms": 90026}
        if (data.tipo === 'estado' && data.estado === 'cerrada' && data.id) {
          const segundosReal = (data.ts_ms - data.ts_apertura_ms) / 1000

          // Evitamos importar OrdenService globalmente para evitar dependencias circulares, lo instanciamos del contenedor
          const { default: app } = await import('@adonisjs/core/services/app')
          const { OrdenService } = await import('#modules/ordenes/services/orden_service')
          
          if (app.container.hasBinding(OrdenService)) {
            const ordenes = await app.container.make(OrdenService)
            await ordenes.reportarDispensado(data.id, segundosReal)
            logger.info({ id: data.id, segundosReal }, 'Dispensado reportado vía MQTT exitosamente')
          }
        }
      } catch (e) {
        logger.error({ e, topic }, 'Error procesando mensaje MQTT entrante')
      }
    })
  }

  public disconnect() {
    if (this.client) {
      this.client.end()
      this.client = null
    }
  }

  /**
   * Publica las instrucciones a la máquina correspondiente.
   * MAC suele ser el identificador del gateway (ej: "barra1").
   */
  public publicarInstrucciones(mac: string, instrucciones: any[]) {
    if (!this.client || !this.client.connected) {
      logger.warn('MQTT desconectado. No se publicaron las instrucciones.')
      return
    }

    for (const inst of instrucciones) {
      // Tópico: sgeb/barra1/valvula1/comando
      const topic = `sgeb/${mac}/valvula${inst.pin_gpio}/comando`
      const payload = {
        cmd: 'pulso',
        ms: Math.round(inst.segundos * 1000), // ESP32 espera milisegundos
        id: inst.id_dispensado
      }
      this.client.publish(topic, JSON.stringify(payload), { qos: 1 })
      logger.info({ topic, payload }, 'Comando publicado al ESP32 vía MQTT')
    }
  }
}

// Exportamos un singleton
export const mqttService = new MqttService()
