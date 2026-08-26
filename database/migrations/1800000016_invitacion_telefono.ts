import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * INVITACION: teléfono del invitado.
 *
 * El capitán ya conoce el teléfono cuando invita —es como consiguió a la
 * persona— y sin este campo la cuenta se creaba sin él. El mesero tenía que
 * capturarlo después desde su perfil, cosa que nadie hace hasta que alguien
 * necesita llamarle en medio de un evento.
 *
 * Es **opcional**: hay meseros que se invitan solo por correo, y exigirlo
 * bloquearía el alta por un dato que puede completarse luego.
 *
 * **Pendiente documental:** agregar el campo a la tabla 6 del Diccionario del
 * módulo de identidad.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.withSchema('auth').alterTable('invitacion', (table) => {
      table.string('telefono', 15).nullable()
    })
  }

  async down() {
    this.schema.withSchema('auth').alterTable('invitacion', (table) => {
      table.dropColumn('telefono')
    })
  }
}
