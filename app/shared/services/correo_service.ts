import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { SsoError } from '#modules/identidad/errores_sso'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CORREO SALIENTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Clase abstracta y no interfaz, por la misma razón que `IdentidadService`:
 * existe en tiempo de ejecución, sirve como token del contenedor y permite
 * `container.swap()` en pruebas.
 *
 * Dos implementaciones intercambiables por `CORREO_MODO`:
 *
 *   CorreoLog       escribe el mensaje en el log. Desarrollo y pruebas
 *   CorreoMailtrap  envía por SMTP
 *
 * **Lo que no cambia entre modos es el mensaje.** Ambas reciben el mismo objeto
 * y arman el mismo contenido; solo cambia a dónde va. Así el flujo que se prueba
 * en desarrollo es exactamente el que corre en producción, en vez de ser uno
 * simplificado que esconde los errores hasta el despliegue.
 */

export interface MensajeCorreo {
  para: string
  asunto: string
  /** Texto plano. Es lo que se ve en un reloj o en un cliente sin HTML. */
  texto: string
  html?: string
}

export abstract class CorreoService {
  abstract enviar(mensaje: MensajeCorreo): Promise<void>

  // ── Plantillas ──────────────────────────────────────────────────────────
  //
  // Viven aquí y no en cada servicio para que el texto que le llega al usuario
  // se corrija en un solo lugar. Son deliberadamente sobrias: un correo con
  // código de verificación que parece publicidad acaba en la carpeta de spam.

  async codigoVerificacion(para: string, codigo: string): Promise<void> {
    await this.enviar({
      para,
      asunto: `${codigo} es tu código de verificación · SGEB`,
      texto:
        `Tu código de verificación es ${codigo}.\n\n` +
        `Vence en 10 minutos y solo sirve una vez.\n\n` +
        `Si no intentaste iniciar sesión, ignora este mensaje y avisa a tu capitán.`,
      html: this.envoltura(
        'Verifica que eres tú',
        `<p style="font-size:15px;margin:0 0 20px">Tu código de verificación es:</p>
         <p style="font-size:30px;letter-spacing:.35em;font-weight:600;margin:0 0 20px;
            font-variant-numeric:tabular-nums">${this.esc(codigo)}</p>
         <p style="font-size:14px;color:#6b6b66;margin:0">
           Vence en 10 minutos y solo sirve una vez.</p>
         <p style="font-size:14px;color:#6b6b66;margin:16px 0 0">
           Si no intentaste iniciar sesión, ignora este mensaje y avisa a tu capitán.</p>`
      ),
    })
  }

  async invitacion(para: string, nombre: string, deeplink: string): Promise<void> {
    await this.enviar({
      para,
      asunto: 'Completa tu registro · SGEB',
      texto:
        `Hola ${nombre}.\n\n` +
        `Te invitaron a formar parte del equipo. Abre este enlace desde tu teléfono ` +
        `para crear tu cuenta:\n\n${deeplink}\n\n` +
        `El enlace vence en 72 horas y solo funciona una vez.`,
      html: this.envoltura(
        /** Sin `esc` aquí: `envoltura` ya escapa el título. Escaparlo dos veces
         *  haría que el nombre saliera literal como `&lt;script&gt;`. */
        `Hola ${nombre}`,
        `<p style="font-size:15px;margin:0 0 20px">
           Te invitaron a formar parte del equipo. Abre el enlace desde tu teléfono
           para crear tu cuenta.</p>
         ${this.boton(deeplink, 'Crear mi cuenta')}
         <p style="font-size:14px;color:#6b6b66;margin:24px 0 0">
           El enlace vence en 72 horas y solo funciona una vez.</p>`
      ),
    })
  }

  async recuperacion(para: string, enlace: string): Promise<void> {
    await this.enviar({
      para,
      asunto: 'Restablece tu contraseña · SGEB',
      texto:
        `Pediste restablecer tu contraseña. Abre este enlace:\n\n${enlace}\n\n` +
        `Vence en 30 minutos y solo funciona una vez.\n\n` +
        `Si no lo pediste, ignora este mensaje: tu contraseña no cambiará. ` +
        `Al usarlo se cerrarán todas tus sesiones abiertas.`,
      html: this.envoltura(
        'Restablece tu contraseña',
        `<p style="font-size:15px;margin:0 0 20px">
           Pediste restablecer tu contraseña.</p>
         ${this.boton(enlace, 'Crear una nueva contraseña')}
         <p style="font-size:14px;color:#6b6b66;margin:24px 0 0">
           Vence en 30 minutos y solo funciona una vez.</p>
         <p style="font-size:14px;color:#6b6b66;margin:12px 0 0">
           Si no lo pediste, ignora este mensaje: tu contraseña no cambiará.
           Al usarlo se cerrarán todas tus sesiones abiertas.</p>`
      ),
    })
  }

  // ── internos ────────────────────────────────────────────────────────────

  /**
   * Escapa lo que viene de la base. El nombre lo captura el capitán al invitar,
   * así que sin escapar sería inyección de HTML en el correo de otra persona.
   */
  protected esc(v: string): string {
    return v
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /**
   * Estilos en línea, sin hoja externa: los clientes de correo descartan las
   * etiquetas `<style>` con frecuencia y el mensaje llegaría sin formato.
   */
  protected envoltura(titulo: string, cuerpo: string): string {
    return `<!doctype html><html lang="es"><meta charset="utf-8">
<body style="margin:0;padding:24px;background:#f7f6f2;
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2a44">
<div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #d8d8d2;
  border-radius:12px;padding:32px">
<h1 style="font-size:20px;font-weight:500;margin:0 0 20px">${this.esc(titulo)}</h1>
${cuerpo}
<p style="font-size:12px;color:#9a9a94;margin:28px 0 0;border-top:1px solid #e8e8e2;padding-top:16px">
  Sistema de Gestión de Eventos de Banquetes · Mediocres Inc.</p>
</div></body></html>`
  }

  protected boton(url: string, texto: string): string {
    return `<a href="${this.esc(url)}" style="display:inline-block;padding:12px 20px;
      background:#1f2a44;color:#fff;text-decoration:none;border-radius:8px;
      font-size:15px;font-weight:500">${this.esc(texto)}</a>`
  }
}

/**
 * Transporte de desarrollo.
 *
 * Sin esto no habría forma de completar el flujo de login al desarrollar, y la
 * alternativa —desactivar el segundo factor en desarrollo— haría que se probara
 * un flujo distinto del que corre en producción, que es justo donde aparecen los
 * errores de cableado.
 */
export class CorreoLog extends CorreoService {
  async enviar(mensaje: MensajeCorreo): Promise<void> {
    logger.info(
      { para: mensaje.para, asunto: mensaje.asunto },
      `[CORREO-LOG] ${mensaje.asunto}\n${mensaje.texto}`
    )
  }
}

/**
 * Transporte real por SMTP.
 *
 * Un fallo aquí responde SSO-5003 y **el código queda inservible**: no se debe
 * reutilizar uno que el usuario nunca recibió, porque quedaría vivo en la base
 * sin que nadie pueda usarlo y contando contra el tope de reenvíos.
 */
export class CorreoMailtrap extends CorreoService {
  async enviar(mensaje: MensajeCorreo): Promise<void> {
    const faltantes = (['MAIL_HOST', 'MAIL_USERNAME', 'MAIL_PASSWORD'] as const).filter(
      (k) => !env.get(k)
    )

    if (faltantes.length) {
      throw new SsoError('SSO-5003', {
        tecnico:
          `CORREO_MODO=mailtrap pero faltan variables: ${faltantes.join(', ')}. ` +
          `Revisar el .env del servidor.`,
      })
    }

    try {
      /**
       * Importación perezosa, no en el encabezado del módulo.
       *
       * `@adonisjs/mail/services/main` resuelve su binding del contenedor al
       * cargarse, y si el módulo se importa antes de que el proveedor lo
       * registre, el arranque falla con "Cannot resolve binding mail.manager".
       * De paso, en modo `log` el paquete ni siquiera se carga.
       */
      const { default: mail } = await import('@adonisjs/mail/services/main')

      await mail.send((m) => {
        m.to(mensaje.para).subject(mensaje.asunto).text(mensaje.texto)
        if (mensaje.html) m.html(mensaje.html)
      })
    } catch (error) {
      throw new SsoError('SSO-5003', {
        tecnico:
          `Fallo SMTP al enviar a ${mensaje.para} (asunto: ${mensaje.asunto}). ` +
          `Host=${env.get('MAIL_HOST')}. El código o token asociado queda inservible.`,
        causa: error,
      })
    }
  }
}
