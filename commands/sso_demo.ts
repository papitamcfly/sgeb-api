import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Siembra un capitán y un mesero de prueba, y emite un código 2FA conocido.
 * Solo para desarrollo local; no debe existir en producción.
 */
export default class SsoDemo extends BaseCommand {
  static commandName = 'sso:demo'
  static description = 'Siembra usuarios de prueba y emite un código 2FA'
  static options: CommandOptions = { startApp: true }

  async run() {
    const db = (await import('@adonisjs/lucid/services/db')).default
    const { InvitacionService } = await import('#modules/identidad/services/invitacion_service')
    const { CredencialesService } = await import('#modules/identidad/services/credenciales_service')
    const Usuario = (await import('#modules/identidad/models/usuario')).default

    let cap = await Usuario.query().where('correo', 'cap@x.mx').first()
    if (!cap) {
      const hash = (await import('@adonisjs/core/services/hash')).default
      const { randomUUID } = await import('node:crypto')
      cap = await Usuario.create({
        uuidUsuario: randomUUID(), idRol: 2, nombre: 'Isaac', apellidoPaterno: 'Velasquez',
        apellidoMaterno: null, correo: 'cap@x.mx', telefono: null,
        passwordHash: await hash.make('Capitan2026'), biometriaHabilitada: false, activo: true,
      })
    }

    let mesero = await Usuario.query().where('correo', 'juan@x.mx').preload('rol').first()
    if (!mesero) {
      const inv = await this.app.container.make(InvitacionService)
      const { token } = await inv.invitar({
        idEmisor: cap.id, idRolDestino: 3, nombre: 'Juan', apellidoPaterno: 'Perez', correo: 'juan@x.mx',
      })
      mesero = await inv.registrar({
        token, password: 'Mesero2026', password2: 'Mesero2026',
        clabe: '012180012345678909', banco: 'BBVA', titular: 'Juan Perez', aceptaPrivacidad: true,
      })
      await mesero.load('rol')
    }

    await db.from('auth.bloqueo_cuenta').update({ activo: false })
    const credenciales = await this.app.container.make(CredencialesService)
    const codigo = await credenciales.emitirCodigo(mesero, 'login')
    this.logger.info(`mesero: juan@x.mx / Mesero2026`)
    this.logger.success(`CODIGO=${codigo}`)
  }
}
