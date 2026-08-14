import { createReadStream, createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import env from '#start/env'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { SgebError } from '#shared/errors/sgeb_error'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ALMACENAMIENTO DE ARCHIVOS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mismo patrón que correo y push: clase abstracta, dos implementaciones, y
 * `ALMACEN_MODO` decide cuál se inyecta.
 *
 *   AlmacenLocal  disco del contenedor. Desarrollo y pruebas
 *   AlmacenS3     Supabase Storage por su API compatible con S3
 *
 * Se usa el SDK de S3 y no el cliente propio de Supabase a propósito: si algún
 * día se cambia a Spaces, R2 o al S3 real, basta con reemplazar endpoint y
 * credenciales. Con el cliente propio habría que reescribirlo.
 */

export interface ArchivoSubido {
  clave: string
  tamanoBytes: number
}

export abstract class AlmacenService {
  abstract subir(clave: string, ruta: string, tipoMime: string): Promise<ArchivoSubido>

  /**
   * URL temporal para descargar el archivo.
   *
   * Se firma en cada petición en vez de guardarse: una URL firmada caduca, así
   * que persistirla sería persistir algo que deja de servir. La clave del objeto
   * sí es estable y es lo que vive en la base.
   */
  abstract urlFirmada(clave: string, segundos?: number): Promise<string>

  abstract eliminar(clave: string): Promise<void>

  /** Devuelve el contenido, para cuando el backend sirve el archivo él mismo. */
  abstract leer(clave: string): Promise<Buffer>
}

/**
 * Disco local. Solo desarrollo y pruebas.
 *
 * No es apto para producción: el disco del VPS no entra en el respaldo de la
 * base, así que un restore devolvería los registros sin los archivos.
 */
export class AlmacenLocal extends AlmacenService {
  private base = app.tmpPath('almacen')

  private ruta(clave: string): string {
    return join(this.base, clave)
  }

  async subir(clave: string, ruta: string, _tipoMime: string): Promise<ArchivoSubido> {
    const destino = this.ruta(clave)
    mkdirSync(dirname(destino), { recursive: true })
    await pipeline(createReadStream(ruta), createWriteStream(destino))

    const datos = await readFile(destino)
    return { clave, tamanoBytes: datos.byteLength }
  }

  async urlFirmada(clave: string): Promise<string> {
    /** En local no hay firma: el backend sirve el archivo directamente. */
    return `local://${clave}`
  }

  async eliminar(clave: string): Promise<void> {
    const destino = this.ruta(clave)
    if (existsSync(destino)) unlinkSync(destino)
  }

  async leer(clave: string): Promise<Buffer> {
    const destino = this.ruta(clave)
    if (!existsSync(destino)) {
      throw new SgebError('SGEB-3001', { tecnico: `Archivo local ausente: ${clave}.` })
    }
    return readFile(destino)
  }
}

/**
 * Supabase Storage por su API compatible con S3.
 *
 * `forcePathStyle: true` es obligatorio: Supabase no soporta el estilo de host
 * virtual (`bucket.dominio`) que el SDK usa por defecto contra AWS. Sin esto,
 * cada petición falla con un error de DNS que no menciona la causa.
 */
export class AlmacenS3 extends AlmacenService {
  private cliente: unknown = null

  private bucket(): string {
    const b = env.get('S3_BUCKET')
    if (!b) {
      throw new SgebError('SGEB-5001', {
        tecnico: 'ALMACEN_MODO=s3 pero falta S3_BUCKET.',
      })
    }
    return b
  }

  private async s3() {
    const { S3Client } = await import('@aws-sdk/client-s3')

    if (!this.cliente) {
      const faltantes = (['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET'] as const)
        .filter((k) => !env.get(k))

      if (faltantes.length) {
        throw new SgebError('SGEB-5001', {
          tecnico: `ALMACEN_MODO=s3 pero faltan variables: ${faltantes.join(', ')}.`,
        })
      }

      this.cliente = new S3Client({
        endpoint: env.get('S3_ENDPOINT'),
        region: env.get('S3_REGION') ?? 'us-east-1',
        /** Obligatorio con Supabase. Ver la nota del encabezado. */
        forcePathStyle: true,
        credentials: {
          accessKeyId: env.get('S3_ACCESS_KEY_ID')!,
          secretAccessKey: env.get('S3_SECRET_ACCESS_KEY')!,
        },
      })
    }
    return this.cliente as InstanceType<typeof S3Client>
  }

  async subir(clave: string, ruta: string, tipoMime: string): Promise<ArchivoSubido> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const cuerpo = await readFile(ruta)

    try {
      await (await this.s3()).send(
        new PutObjectCommand({
          Bucket: this.bucket(),
          Key: clave,
          Body: cuerpo,
          ContentType: tipoMime,
          /**
           * El bucket debe ser PRIVADO. Se sirve solo por URL firmada: una clave
           * adivinable dejaría ver la comanda de cualquier evento.
           */
          ACL: 'private',
        })
      )
    } catch (error) {
      throw new SgebError('SGEB-5002', {
        tecnico: `Fallo al subir '${clave}' a S3 (${env.get('S3_ENDPOINT')}).`,
        causa: error,
      })
    }

    return { clave, tamanoBytes: cuerpo.byteLength }
  }

  /**
   * URL firmada, 15 minutos por defecto.
   *
   * Suficiente para abrir el documento y leerlo, y corta para que un enlace
   * reenviado por WhatsApp deje de servir enseguida.
   */
  async urlFirmada(clave: string, segundos = 900): Promise<string> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

    return getSignedUrl(
      await this.s3(),
      new GetObjectCommand({ Bucket: this.bucket(), Key: clave }),
      { expiresIn: segundos }
    )
  }

  async eliminar(clave: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    try {
      await (await this.s3()).send(
        new DeleteObjectCommand({ Bucket: this.bucket(), Key: clave })
      )
    } catch (error) {
      /**
       * No relanza: un archivo huérfano en el bucket es molesto, pero fallar la
       * operación que lo generó es peor. Se registra para limpiarlo después.
       */
      logger.error({ err: error, clave }, 'No se pudo eliminar el objeto de S3')
    }
  }

  async leer(clave: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')

    try {
      const r = await (await this.s3()).send(
        new GetObjectCommand({ Bucket: this.bucket(), Key: clave })
      )
      const trozos: Buffer[] = []
      for await (const t of r.Body as Readable) trozos.push(Buffer.from(t))
      return Buffer.concat(trozos)
    } catch (error) {
      throw new SgebError('SGEB-3001', {
        tecnico: `Objeto '${clave}' no encontrado en el bucket.`,
        causa: error,
      })
    }
  }
}
