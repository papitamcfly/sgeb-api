import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Usuario from '#modules/identidad/models/usuario'
import { randomUUID } from 'node:crypto'
import hash from '@adonisjs/core/services/hash'

export default class extends BaseSeeder {
  async run() {
    console.log('Creando usuario de prueba directo...')
    const u = await Usuario.create({
      uuidUsuario: randomUUID(),
      idRol: 3, // mesero
      nombre: 'Prueba',
      apellidoPaterno: 'Directa',
      correo: 'mesero2@sgeb.mx',
      passwordHash: await hash.make('Prueba1234'),
      biometriaHabilitada: false,
      activo: true,
    })
    console.log('Usuario mesero2@sgeb.mx creado exitosamente con contraseña Prueba1234.')
  }
}
