import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'

/**
 * Correo saliente — Mailtrap por SMTP.
 *
 * Mailtrap ofrece dos hosts con el mismo protocolo, así que **el mismo código
 * sirve para los dos entornos** y solo cambia una variable:
 *
 *   sandbox.smtp.mailtrap.io   captura todo sin entregarlo. Desarrollo y staging
 *   live.smtp.mailtrap.io      entrega de verdad. Producción
 *
 * Se eligió SMTP sobre la API de Mailtrap a propósito: si algún día se cambia de
 * proveedor —SendGrid, SES, el SMTP de un dominio propio— basta con reemplazar
 * host, puerto y credenciales. Con la API habría que reescribir el cliente.
 *
 * El puerto 2525 es el que Mailtrap recomienda porque el 25 y el 587 suelen
 * estar bloqueados por los proveedores de nube.
 */
const mailConfig = defineConfig({
  default: 'smtp',

  /**
   * Los valores por defecto permiten que la aplicación arranque en modo `log`
   * sin las variables de Mailtrap. `CorreoMailtrap` valida que existan antes de
   * intentar enviar y responde SSO-5003 si faltan, con el nombre de las que
   * faltan: es un error de configuración del servidor, no del usuario.
   */
  from: {
    address: env.get('MAIL_FROM_ADDRESS') ?? 'no-responder@sgeb.mediocres.mx',
    name: env.get('MAIL_FROM_NAME') ?? 'SGEB',
  },

  mailers: {
    smtp: transports.smtp({
      host: env.get('MAIL_HOST') ?? 'sandbox.smtp.mailtrap.io',
      port: Number(env.get('MAIL_PORT') ?? 2525),
      auth: {
        type: 'login',
        user: env.get('MAIL_USERNAME') ?? '',
        pass: env.get('MAIL_PASSWORD') ?? '',
      },
    }),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
