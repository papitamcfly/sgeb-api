import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class LlaveFirma extends BaseModel {
  static table = 'auth.llave_firma'

  @column({ isPrimary: true, columnName: 'id_llave', serializeAs: null })
  declare id: number

  /** Viaja en el header del JWT. Es lo que permite rotar sin invalidar sesiones. */
  @column()
  declare kid: string

  @column()
  declare algoritmo: 'RS256' | 'ES256'

  @column({ columnName: 'llave_publica', serializeAs: 'llave_publica' })
  declare llavePublica: string

  /**
   * Cifrada con AES-256-GCM. NUNCA se serializa: aunque esté cifrada, exponerla
   * le da al atacante el material para trabajar sin conexión.
   */
  @column({ columnName: 'llave_privada_cifrada', serializeAs: null })
  declare llavePrivadaCifrada: string

  @column()
  declare estado: 'activa' | 'retirada' | 'revocada'

  @column.dateTime({ autoCreate: true, columnName: 'creado_en', serializeAs: 'creado_en' })
  declare creadoEn: DateTime

  @column.dateTime({ columnName: 'retirada_en', serializeAs: 'retirada_en' })
  declare retiradaEn: DateTime | null
}
