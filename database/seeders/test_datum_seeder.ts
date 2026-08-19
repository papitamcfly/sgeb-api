import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Usuario from '#modules/identidad/models/usuario'
import { randomUUID } from 'node:crypto'
import hash from '@adonisjs/core/services/hash'
import app from '@adonisjs/core/services/app'
import { InvitacionService } from '#modules/identidad/services/invitacion_service'

export default class extends BaseSeeder {
  async run() {
    console.log('Creando usuario admin inicial...')
    const admin = await Usuario.create({
      uuidUsuario: randomUUID(),
      idRol: 1, // 1 es admin
      nombre: 'Fehane',
      apellidoPaterno: 'Prueba',
      correo: 'fehane91@gmail.com',
      passwordHash: await hash.make('Admin1234'),
      biometriaHabilitada: false,
      activo: true,
    })

    console.log('Generando invitación para mesero...')
    const invitaciones = await app.container.make(InvitacionService)
    const inv = await invitaciones.invitar({
      idEmisor: admin.id,
      idRolDestino: 3, // mesero
      nombre: 'Mesero',
      apellidoPaterno: 'SGEB',
      correo: 'emilianoa.aguilar17@gmail.com'
    })

    console.log('\n==========================================================')
    console.log('🎉 ¡Invitación lista!')
    console.log('👉 Entra a esta URL en tu navegador (asegúrate de tener el SSO corriendo en el 4321):')
    console.log(`http://localhost:4321/registro?token=${inv.token}`)
    console.log('==========================================================\n')
  }
}