import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Usuario from '#modules/identidad/models/usuario'
import { randomUUID } from 'node:crypto'
import hash from '@adonisjs/core/services/hash'

export default class extends BaseSeeder {
  async run() {
    console.log('Creando usuarios iniciales...')
    const passwordHash = await hash.make('17Nov2002!')

    await Usuario.createMany([
      {
        uuidUsuario: randomUUID(),
        idRol: 1, // admin
        nombre: 'Admin',
        apellidoPaterno: 'Fehane',
        correo: 'fehane91@gmail.com',
        passwordHash,
        biometriaHabilitada: false,
        activo: true,
      },
      {
        uuidUsuario: randomUUID(),
        idRol: 2, // capitan
        nombre: 'Capitan',
        apellidoPaterno: 'Emijoker',
        correo: 'emijoker17@gmail.com',
        passwordHash,
        biometriaHabilitada: false,
        activo: true,
      },
      {
        uuidUsuario: randomUUID(),
        idRol: 3, // mesero
        nombre: 'Mesero',
        apellidoPaterno: 'Emiliano',
        correo: 'emilianoa.aguilar17@gmail.com',
        passwordHash,
        biometriaHabilitada: false,
        activo: true,
      },
    ])

    console.log('✅ 3 usuarios creados exitosamente.')
  }
}