import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Ensancha `usuario.password_hash` de CHAR(60) a VARCHAR(100).
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  DISCREPANCIA #7 CON EL DICCIONARIO DE DATOS
 * ────────────────────────────────────────────────────────────────────────────
 * El Diccionario define CHAR(60), que es la longitud exacta de un hash Bcrypt
 * crudo: `$2b$10$` + 22 de sal + 31 de digest.
 *
 * AdonisJS no guarda el hash crudo: lo envuelve en formato PHC, que antepone el
 * algoritmo y sus parámetros —`$bcrypt$v=98$r=10$sal$digest`— y llega a ~72
 * caracteres. El INSERT del primer usuario falla con "value too long for type
 * character(60)".
 *
 * Se ensancha la columna en vez de pelear con el framework, porque el formato
 * PHC compra algo concreto: `hash.needsReHash()` puede detectar contraseñas
 * guardadas con parámetros viejos y rehashearlas **en el siguiente login de
 * cada usuario**, sin pedirle a nadie que la cambie. Con el hash crudo no hay
 * dónde leer los parámetros, y subir el costo de Bcrypt o migrar a argon2
 * obligaría a un restablecimiento masivo.
 *
 * VARCHAR(100) y no CHAR: PHC es de longitud variable, y CHAR rellena con
 * espacios hasta el ancho fijo, lo que rompería la comparación.
 *
 * **Pendiente documental:** actualizar el Diccionario de Datos, tabla 2, a
 * `password_hash VARCHAR(100)` con la nota del formato PHC.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      ALTER TABLE usuario
      ALTER COLUMN password_hash TYPE varchar(100)
    `)

    /** Mismo motivo: el código 2FA también se guarda con Bcrypt en formato PHC. */
    this.schema.raw(`
      ALTER TABLE auth.codigo_verificacion
      ALTER COLUMN codigo_hash TYPE varchar(100)
    `)
  }

  async down() {
    /**
     * La vuelta atrás trunca cualquier hash de más de 60 caracteres, lo que
     * dejaría a esos usuarios sin poder entrar. Se convierte a NULL para que el
     * fallo sea evidente y obligue a un restablecimiento, en vez de producir
     * hashes corruptos que fallan en silencio como "contraseña incorrecta".
     */
    this.schema.raw(`UPDATE usuario SET password_hash = '' WHERE length(password_hash) > 60`)
    this.schema.raw(`ALTER TABLE usuario ALTER COLUMN password_hash TYPE char(60)`)
    this.schema.raw(`UPDATE auth.codigo_verificacion SET usado = true`)
    this.schema.raw(`ALTER TABLE auth.codigo_verificacion ALTER COLUMN codigo_hash TYPE char(60)`)
  }
}
