import type { ApplicationService } from '@adonisjs/core/types'
import { IdentidadService } from '#modules/identidad/identidad_service'

/**
 * Enlace de IdentidadService con su implementación.
 *
 * Este archivo es EL punto de conmutación de la extracción del SSO. Cuando el
 * módulo se mude a un servidor propio, se cambia `IdentidadLocal` por
 * `IdentidadRemota` aquí y en ningún otro lugar: todo el dominio pide la clase
 * abstracta por inyección, así que ni se entera.
 *
 * Es también lo que permite inyectar un doble en las pruebas sin base de datos:
 *   app.container.swap(IdentidadService, () => new IdentidadFalsa())
 */
export default class AppProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(IdentidadService, async () => {
      const { IdentidadLocal } = await import('#modules/identidad/identidad_service')
      return new IdentidadLocal()
    })
  }
}
