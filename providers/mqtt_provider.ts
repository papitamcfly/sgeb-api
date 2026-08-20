import type { ApplicationService } from '@adonisjs/core/types'

export default class MqttProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    // No iniciamos MQTT en entornos de consola/pruebas
    if (this.app.getEnvironment() === 'console' || this.app.getEnvironment() === 'repl') return

    const { mqttService } = await import('#shared/services/mqtt_service')
    mqttService.connect()
  }

  async shutdown() {
    const { mqttService } = await import('#shared/services/mqtt_service')
    mqttService.disconnect()
  }
}
