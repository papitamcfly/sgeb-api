import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ComandaEvento extends BaseModel {
  static table = 'comanda_evento'

  @column({ isPrimary: true, columnName: 'id_comanda', serializeAs: 'id_comanda' })
  declare id: number

  @column({ columnName: 'id_evento', serializeAs: 'id_evento' })
  declare idEvento: number

  /**
   * Clave del objeto en el bucket. **No se serializa**: exponerla permitiría
   * construir peticiones directas al almacenamiento saltándose la verificación
   * de permisos que hace el backend.
   */
  @column({ columnName: 'clave_objeto', serializeAs: null })
  declare claveObjeto: string

  @column({ columnName: 'nombre_original', serializeAs: 'nombre_original' })
  declare nombreOriginal: string

  @column({ columnName: 'tipo_mime', serializeAs: 'tipo_mime' })
  declare tipoMime: string

  @column({ columnName: 'tamano_bytes', serializeAs: 'tamano_bytes' })
  declare tamanoBytes: number

  /** Entero interno; el servicio lo traduce a UUID al responder. */
  @column({ columnName: 'id_subido_por', serializeAs: null })
  declare idSubidoPor: number

  @column()
  declare activo: boolean

  @column.dateTime({ autoCreate: true, columnName: 'creado_en', serializeAs: 'creado_en' })
  declare creadoEn: DateTime
}
