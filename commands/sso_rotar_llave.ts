import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Rota la llave de firma del proveedor de identidad.
 *
 *   node ace sso:rotar-llave
 *   node ace sso:rotar-llave --algoritmo=ES256
 *
 * La llave anterior pasa a "retirada": deja de firmar pero SIGUE publicándose
 * en el JWKS, así que los tokens ya emitidos se validan hasta expirar. Sin ese
 * solapamiento, rotar cerraría todas las sesiones vivas de golpe.
 *
 * Debe correrse al menos una vez antes del primer login, o el proveedor no
 * tiene con qué firmar y responde SSO-5001.
 */
export default class SsoRotarLlave extends BaseCommand {
  static commandName = 'sso:rotar-llave'
  static description = 'Genera una llave de firma nueva y retira la anterior'
  static options: CommandOptions = { startApp: true }

  @flags.string({ description: 'RS256 o ES256', default: 'RS256' })
  declare algoritmo: string

  async run() {
    const { LlaveFirmaService } = await import('#modules/identidad/services/llave_firma_service')
    const servicio = new LlaveFirmaService()

    if (!['RS256', 'ES256'].includes(this.algoritmo)) {
      this.logger.error(`Algoritmo no soportado: ${this.algoritmo}. Use RS256 o ES256.`)
      return
    }

    const llave = await servicio.rotar(this.algoritmo as 'RS256' | 'ES256')

    this.logger.success(`Llave activa: kid=${llave.kid} (${llave.algoritmo})`)
    this.logger.info('La anterior quedó en estado "retirada"; sus tokens siguen validando hasta expirar.')
  }
}
