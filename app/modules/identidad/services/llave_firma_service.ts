import { DateTime } from 'luxon'
import { randomUUID, generateKeyPairSync, createCipheriv, createDecipheriv, randomBytes, createPublicKey } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import LlaveFirma from '#modules/identidad/models/llave_firma'
import { SsoError } from '#modules/identidad/errores_sso'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LLAVES DE FIRMA — la pieza de la que depende toda la seguridad del sistema.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Quien tenga la llave privada puede emitir tokens válidos para cualquier
 * usuario y cualquier rol. De ahí las tres decisiones de este archivo:
 *
 * 1. **Firma asimétrica (RS256/ES256), no HMAC.** La API de SGEB valida con la
 *    llave PÚBLICA. Si compartiera un secreto con el proveedor, cualquiera que
 *    comprometiera la API podría además *emitir* tokens, no solo validarlos —
 *    y la extracción futura del módulo dejaría de ser posible sin tocar ambos
 *    lados.
 *
 * 2. **Llave privada cifrada en reposo (AES-256-GCM) con llave maestra FUERA de
 *    la base de datos.** Si ambas vivieran en el mismo lugar, un volcado de la
 *    base bastaría para firmar tokens arbitrarios. GCM y no CBC porque es
 *    autenticado: detecta manipulación del texto cifrado en vez de devolver
 *    basura que parece una llave.
 *
 * 3. **Rotación con periodo de gracia.** La llave nueva empieza a firmar
 *    mientras la anterior sigue publicándose para validación, hasta que expire
 *    el último token emitido con ella. Sin ese solapamiento, rotar invalidaría
 *    todas las sesiones vivas de golpe.
 */

const ALGORITMO_CIFRADO = 'aes-256-gcm'

export class LlaveFirmaService {
  /**
   * Llave maestra de 32 bytes en hexadecimal, desde variable de entorno.
   *
   * Se lee en cada operación y no se cachea en un módulo: así una rotación de
   * la maestra surte efecto al reiniciar el proceso sin dejar copias vivas en
   * memoria de trabajos de larga duración.
   */
  private llaveMaestra(): Buffer {
    const hex = env.get('SSO_MASTER_KEY')
    const buf = Buffer.from(hex, 'hex')
    if (buf.length !== 32) {
      throw new SsoError('SSO-5001', {
        tecnico:
          `SSO_MASTER_KEY debe ser de 32 bytes (64 caracteres hex); recibidos ${buf.length}. ` +
          `Generar con: openssl rand -hex 32`,
      })
    }
    return buf
  }

  /**
   * Formato: iv(12 bytes) : tag(16 bytes) : cifrado, todo en base64.
   *
   * El IV es aleatorio por operación y se guarda junto al texto cifrado: no es
   * secreto, pero **jamás debe repetirse** con la misma llave. Reutilizarlo en
   * GCM permite recuperar el texto en claro comparando dos cifrados.
   */
  private cifrar(claro: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITMO_CIFRADO, this.llaveMaestra(), iv)
    const cifrado = Buffer.concat([cipher.update(claro, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [iv.toString('base64'), tag.toString('base64'), cifrado.toString('base64')].join(':')
  }

  private descifrar(paquete: string): string {
    const partes = paquete.split(':')
    if (partes.length !== 3) {
      throw new SsoError('SSO-5001', { tecnico: 'Paquete cifrado con formato inválido.' })
    }
    const [ivB64, tagB64, datosB64] = partes as [string, string, string]
    try {
      const decipher = createDecipheriv(
        ALGORITMO_CIFRADO,
        this.llaveMaestra(),
        Buffer.from(ivB64, 'base64')
      )
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(datosB64, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    } catch (error) {
      /**
       * GCM falla aquí si el texto cifrado fue manipulado o si la llave maestra
       * cambió. Ambas cosas son incidentes, no errores de usuario.
       */
      throw new SsoError('SSO-5001', {
        tecnico:
          'Fallo al descifrar la llave privada: texto manipulado o SSO_MASTER_KEY incorrecta. ' +
          'NO reintentar; revisar la variable de entorno del VPS 2.',
        causa: error,
      })
    }
  }

  /**
   * Genera un par nuevo y lo deja como la única llave activa.
   *
   * Todo dentro de una transacción: el índice parcial `llave_firma_una_activa`
   * garantiza que no haya dos activas, así que retirar la anterior e insertar
   * la nueva tienen que ocurrir juntas o ninguna.
   */
  async rotar(algoritmo: 'RS256' | 'ES256' = 'RS256'): Promise<LlaveFirma> {
    const { publicKey, privateKey } =
      algoritmo === 'RS256'
        ? generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          })
        : generateKeyPairSync('ec', {
            namedCurve: 'P-256',
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          })

    return db.transaction(async (trx) => {
      await LlaveFirma.query({ client: trx })
        .where('estado', 'activa')
        .update({ estado: 'retirada', retirada_en: DateTime.now().toSQL() })

      return LlaveFirma.create(
        {
          kid: randomUUID(),
          algoritmo,
          llavePublica: publicKey,
          llavePrivadaCifrada: this.cifrar(privateKey),
          estado: 'activa',
        },
        { client: trx }
      )
    })
  }

  /** La llave con la que se firma ahora mismo. */
  async activa(): Promise<{ kid: string; algoritmo: 'RS256' | 'ES256'; privadaPem: string }> {
    const llave = await LlaveFirma.query().where('estado', 'activa').first()
    if (!llave) {
      throw new SsoError('SSO-5001', {
        tecnico:
          'No hay LLAVE_FIRMA en estado activa. El proveedor no puede emitir tokens. ' +
          'Ejecutar: node ace sso:rotar-llave',
      })
    }
    return {
      kid: llave.kid,
      algoritmo: llave.algoritmo,
      privadaPem: this.descifrar(llave.llavePrivadaCifrada),
    }
  }

  /**
   * Documento JWKS: llaves activas y retiradas, nunca las revocadas.
   *
   * La distinción importa. "Retirada" significa que ya no firma pero sus tokens
   * siguen siendo válidos hasta expirar; sacarla del documento invalidaría esas
   * sesiones. "Revocada" significa que la llave se comprometió: sus tokens
   * deben dejar de validar de inmediato, y por eso desaparece.
   */
  async jwks(): Promise<{ keys: Record<string, unknown>[] }> {
    const llaves = await LlaveFirma.query().whereIn('estado', ['activa', 'retirada'])

    const keys = llaves.map((l) => {
      const jwk = createPublicKey(l.llavePublica).export({ format: 'jwk' })
      return { ...jwk, kid: l.kid, alg: l.algoritmo, use: 'sig' }
    })

    return { keys }
  }
}
