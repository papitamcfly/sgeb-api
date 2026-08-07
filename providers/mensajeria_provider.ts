import type { ApplicationService } from '@adonisjs/core/types'
import env from '#start/env'
import { CorreoService, CorreoLog, CorreoMailtrap } from '#shared/services/correo_service'
import { PushService, PushLog, PushFirebase } from '#shared/services/push_service'

/**
 * Elige el transporte de correo y de push según `CORREO_MODO` y `PUSH_MODO`.
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
  }
}
