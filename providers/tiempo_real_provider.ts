import type { ApplicationService } from '@adonisjs/core/types'
import { TiempoRealService } from '#shared/services/tiempo_real_service'

/**
 * Monta el canal de tiempo real sobre el servidor HTTP de AdonisJS.
 *
 * Se hace en `ready()` porque antes de ese punto el servidor Node todavía no
 * existe: `getNodeServer()` devolvería undefined y socket.io quedaría colgado
 * de nada, sin error visible hasta que un cliente intentara conectarse.
 *
 * No se levanta un servidor aparte a propósito. Reutilizar el mismo proceso
 * significa que Nginx solo necesita habilitar el upgrade de conexión, sin un
 * puerto ni un bloque `server` adicionales (Entorno Tecnológico §10.5).
 */
export default class TiempoRealProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(TiempoRealService, () => new TiempoRealService())
  }

  async ready() {
    /**
     * En pruebas unitarias no hay servidor HTTP y no hace falta canal. Las
     * pruebas funcionales sí lo montan, porque levantan el servidor de verdad.
     */
    if (this.app.getEnvironment() === 'console' || this.app.getEnvironment() === 'repl') return

    const server = await this.app.container.make('server')
    const nodeServer = server.getNodeServer()
    if (!nodeServer) return

    const tiempoReal = await this.app.container.make(TiempoRealService)
    tiempoReal.montar(nodeServer)
  }

  async shutdown() {
    const tiempoReal = await this.app.container.make(TiempoRealService)
    await tiempoReal.cerrar()
  }
}
