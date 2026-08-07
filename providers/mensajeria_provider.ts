import type { ApplicationService } from '@adonisjs/core/types'
import env from '#start/env'
import { CorreoService, CorreoLog, CorreoMailtrap } from '#shared/services/correo_service'
import { PushService, PushLog, PushFirebase } from '#shared/services/push_service'
import { AlmacenService, AlmacenLocal, AlmacenS3 } from '#shared/services/almacen_service'

/**
 * Elige el transporte de correo, push y almacenamiento según `CORREO_MODO`,
 * `PUSH_MODO` y `ALMACEN_MODO`.
 *
 * Es el punto de conmutación: los servicios de dominio piden `CorreoService` o
 * `PushService` y no saben —ni deben— si detrás hay SMTP, Firebase o un log.
 *
 * Mismo patrón que `identidad_provider.ts` con `IdentidadLocal` /
 * `IdentidadRemota`: activar el envío real es cambiar una variable de entorno,
 * no tocar código.
 */
export default class MensajeriaProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(CorreoService, () =>
      env.get('CORREO_MODO') === 'mailtrap' ? new CorreoMailtrap() : new CorreoLog()
    )

    this.app.container.singleton(PushService, () =>
      env.get('PUSH_MODO') === 'firebase' ? new PushFirebase() : new PushLog()
    )

    this.app.container.singleton(AlmacenService, () =>
      env.get('ALMACEN_MODO') === 's3' ? new AlmacenS3() : new AlmacenLocal()
    )
  }
}
