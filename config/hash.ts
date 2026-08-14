import { defineConfig, drivers } from '@adonisjs/core/hash'

/**
 * Hashing de contraseñas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  POR QUÉ BCRYPT Y NO EL SCRYPT QUE TRAE EL STARTER KIT
 * ────────────────────────────────────────────────────────────────────────────
 * El Diccionario de Datos define `USUARIO.password_hash` como CHAR(60), que es
 * la longitud exacta de un hash Bcrypt. El scrypt de AdonisJS produce una
 * cadena en formato PHC bastante más larga, así que el INSERT falla con
 * "value too long for type character(60)" — y falla en el registro del primer
 * usuario, no en una prueba de carga.
 *
 * Se podría ensanchar la columna a VARCHAR(255) y usar scrypt, que es más
 * resistente a ataques con GPU. Se optó por Bcrypt para respetar el
 * Diccionario, que ya está aprobado y del que dependen los tres clientes y la
 * documentación de validación. Si el equipo decide migrar a scrypt o argon2,
 * hay que actualizar el Diccionario, ensanchar la columna y rehashear en el
 * siguiente login de cada usuario (`hash.needsReHash`).
 *
 * `rounds: 10` da ~100 ms por verificación en el VPS de 1 GB. Subirlo encarece
 * la fuerza bruta pero también cada login legítimo; conviene medirlo en el
 * servidor real antes de moverlo.
 */
const hashConfig = defineConfig({
  default: 'bcrypt',

  list: {
    bcrypt: drivers.bcrypt({ rounds: 10 }),
  },
})

export default hashConfig

declare module '@adonisjs/core/types' {
  export interface HashersList extends InferHashers<typeof hashConfig> {}
}
