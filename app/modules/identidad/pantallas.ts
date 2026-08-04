/**
 * Pantallas del proveedor de identidad (wireframes S1–S7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  POR QUÉ VIVEN AQUÍ Y NO EN EL PANEL REACT NI EN LA APP iOS
 * ────────────────────────────────────────────────────────────────────────────
 * Al adoptar el flujo de código de autorización, estas pantallas dejan de ser
 * de cada aplicación y pasan a ser del proveedor. Es la consecuencia
 * organizativa de la decisión (Entorno v0.4 §8.12), y tiene un beneficio
 * concreto: una corrección en la política de contraseña o en el mensaje de
 * bloqueo se aplica UNA vez y llega a las dos plataformas, sin publicar una
 * versión nueva en la App Store.
 *
 * Se sirven como HTML plano generado en el servidor, sin framework de plantillas
 * ni bundle de frontend. No es minimalismo por pereza: son siete formularios sin
 * estado que se abren en el navegador del sistema. Meter React aquí añadiría un
 * pipeline de build, un despliegue y una superficie de dependencias a cambio de
 * nada, y estas pantallas tienen que cargar rápido en el WiFi de un salón.
 *
 * `ticket` viaja en un campo oculto en todas: es lo que ata cada pantalla a la
 * solicitud /authorize que la originó. Sin él, el formulario no sabría a qué
 * cliente ni a qué URL devolver al usuario.
 */

interface OpcionesPantalla {
  titulo: string
  subtitulo?: string
  cuerpo: string
  error?: string | null
  /** Código del diccionario, visible en pantalla para que soporte lo pueda pedir. */
  codigo?: string | null
}

/**
 * Escapa lo que venga de fuera. Todo valor interpolado en el HTML pasa por
 * aquí: el correo precargado y los mensajes de error vienen de la petición, y
 * sin escapar serían un XSS en el origen del proveedor — justo donde vive la
 * cookie de sesión.
 */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function marco(o: OpcionesPantalla): string {
  const error = o.error
    ? `<div class="err" role="alert"><span>${esc(o.error)}</span>${
        o.codigo ? `<small>${esc(o.codigo)}</small>` : ''
      }</div>`
    : ''

  return `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.titulo)} · SGEB</title>
<style>
:root{--tinta:#1f2a44;--borde:#d8d8d2;--fondo:#f7f6f2;--err:#a32d2d}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--fondo);
  font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--tinta);padding:24px}
.caja{width:100%;max-width:380px;background:#fff;border:1px solid var(--borde);border-radius:12px;padding:32px}
h1{font-size:22px;font-weight:500;margin:0 0 4px}
p.sub{margin:0 0 24px;color:#6b6b66;font-size:14px}
label{display:block;font-size:14px;margin:16px 0 6px}
input{width:100%;padding:11px 12px;font-size:16px;border:1px solid var(--borde);border-radius:8px;background:#fff}
input:focus{outline:2px solid var(--tinta);outline-offset:-1px}
button{width:100%;margin-top:24px;padding:12px;font-size:16px;font-weight:500;color:#fff;
  background:var(--tinta);border:0;border-radius:8px;cursor:pointer}
button:hover{opacity:.92}
.err{margin:0 0 20px;padding:11px 12px;border:1px solid var(--err);border-radius:8px;
  color:var(--err);font-size:14px;display:flex;justify-content:space-between;gap:12px}
.err small{opacity:.7;font-size:12px;white-space:nowrap}
.pie{margin-top:20px;text-align:center;font-size:14px}
a{color:var(--tinta)}
.codigo{letter-spacing:.4em;text-align:center;font-size:22px;font-variant-numeric:tabular-nums}
</style>
<div class="caja">
<h1>${esc(o.titulo)}</h1>
${o.subtitulo ? `<p class="sub">${esc(o.subtitulo)}</p>` : ''}
${error}
${o.cuerpo}
</div>
</html>`
}

/** S1 — Iniciar sesión. */
export function pantallaLogin(d: {
  ticket: string
  correo?: string
  error?: string | null
  codigo?: string | null
}): string {
  return marco({
    titulo: 'Iniciar sesión',
    subtitulo: 'Sistema de Gestión de Eventos de Banquetes',
    error: d.error,
    codigo: d.codigo,
    cuerpo: `<form method="post" action="/interno/login">
<input type="hidden" name="ticket" value="${esc(d.ticket)}">
<label for="correo">Correo</label>
<input id="correo" name="correo" type="email" autocomplete="username" required
  autocapitalize="off" spellcheck="false" value="${esc(d.correo ?? '')}">
<label for="password">Contraseña</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Entrar</button>
</form>
<p class="pie"><a href="/interno/recuperar?ticket=${encodeURIComponent(d.ticket)}">¿Olvidaste tu contraseña?</a></p>`,
  })
}

/** S3 — Verificación en dos pasos. */
export function pantallaVerificacion(d: {
  ticket: string
  correo: string
  error?: string | null
  codigo?: string | null
}): string {
  /** El correo se muestra parcialmente enmascarado: confirma sin exponerlo entero. */
  const [usuario, dominio] = d.correo.split('@')
  const pista = `${(usuario ?? '').slice(0, 2)}${'•'.repeat(Math.max(1, (usuario ?? '').length - 2))}@${dominio ?? ''}`

  return marco({
    titulo: 'Verifica que eres tú',
    subtitulo: `Enviamos un código de 6 dígitos a ${pista}`,
    error: d.error,
    codigo: d.codigo,
    cuerpo: `<form method="post" action="/interno/verificacion">
<input type="hidden" name="ticket" value="${esc(d.ticket)}">
<label for="codigo">Código</label>
<input id="codigo" name="codigo" class="codigo" inputmode="numeric" autocomplete="one-time-code"
  pattern="[0-9]{6}" maxlength="6" required autofocus>
<label style="display:flex;gap:8px;align-items:center;margin-top:20px">
  <input type="checkbox" name="confiar" value="1" style="width:auto;margin:0">
  <span>Confiar en este equipo por 30 días</span>
</label>
<button type="submit">Verificar</button>
</form>
<p class="pie">
  <a href="/interno/verificacion/reenviar?ticket=${encodeURIComponent(d.ticket)}">Reenviar código</a>
</p>`,
  })
}

/** S4 — Completar registro por invitación. */
export function pantallaRegistro(d: {
  token: string
  nombre: string
  correo: string
  error?: string | null
  codigo?: string | null
}): string {
  return marco({
    titulo: 'Completa tu registro',
    subtitulo: `Hola ${d.nombre}. Tu cuenta se creará con ${d.correo}`,
    error: d.error,
    codigo: d.codigo,
    cuerpo: `<form method="post" action="/interno/registro">
<input type="hidden" name="token" value="${esc(d.token)}">
<label for="password">Contraseña</label>
<input id="password" name="password" type="password" autocomplete="new-password" required
  minlength="8" aria-describedby="reglas">
<p id="reglas" style="font-size:13px;color:#6b6b66;margin:6px 0 0">
  Mínimo 8 caracteres, con una mayúscula y un número.</p>
<label for="password2">Repite la contraseña</label>
<input id="password2" name="password2" type="password" autocomplete="new-password" required>
<label for="clabe">CLABE interbancaria</label>
<input id="clabe" name="clabe" inputmode="numeric" pattern="[0-9]{18}" maxlength="18" required>
<label for="banco">Banco</label>
<input id="banco" name="banco" required maxlength="30">
<label for="titular">Titular de la cuenta</label>
<input id="titular" name="titular" required maxlength="50">
<label style="display:flex;gap:8px;align-items:flex-start;margin-top:20px">
  <input type="checkbox" name="privacidad" value="1" required style="width:auto;margin:4px 0 0">
  <span style="font-size:14px">Acepto el aviso de privacidad</span>
</label>
<button type="submit">Crear mi cuenta</button>
</form>`,
  })
}

/** S5 — Recuperar acceso. */
export function pantallaRecuperar(d: { ticket?: string; enviado?: boolean }): string {
  if (d.enviado) {
    return marco({
      titulo: 'Revisa tu correo',
      /**
       * Mensaje idéntico exista o no la cuenta (SSO-0002). Distinguirlos
       * convertiría esta pantalla en un enumerador de cuentas.
       */
      subtitulo: 'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña.',
      cuerpo: `<p class="pie"><a href="/interno/login?ticket=${encodeURIComponent(d.ticket ?? '')}">Volver</a></p>`,
    })
  }

  return marco({
    titulo: 'Recuperar acceso',
    subtitulo: 'Te enviaremos un enlace para crear una contraseña nueva.',
    cuerpo: `<form method="post" action="/interno/recuperar">
<input type="hidden" name="ticket" value="${esc(d.ticket ?? '')}">
<label for="correo">Correo</label>
<input id="correo" name="correo" type="email" required autocapitalize="off" spellcheck="false">
<button type="submit">Enviar enlace</button>
</form>
<p class="pie"><a href="/interno/login?ticket=${encodeURIComponent(d.ticket ?? '')}">Volver</a></p>`,
  })
}

/** S6 — Nueva contraseña. */
export function pantallaNuevaPassword(d: {
  token: string
  error?: string | null
  codigo?: string | null
}): string {
  return marco({
    titulo: 'Crea una nueva contraseña',
    error: d.error,
    codigo: d.codigo,
    cuerpo: `<form method="post" action="/interno/recuperar/confirmar">
<input type="hidden" name="token" value="${esc(d.token)}">
<label for="password">Nueva contraseña</label>
<input id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
<label for="password2">Repítela</label>
<input id="password2" name="password2" type="password" autocomplete="new-password" required>
<button type="submit">Guardar</button>
</form>`,
  })
}

/**
 * S7 — Error no redirigible.
 *
 * Se usa cuando `client_id` o `redirect_uri` no se pudieron verificar. NO se
 * redirige: mandar al usuario a una URL no verificada convertiría al proveedor
 * en un redirector abierto.
 */
export function pantallaError(d: { mensaje: string; codigo: string }): string {
  return marco({
    titulo: 'No pudimos iniciar sesión',
    error: d.mensaje,
    codigo: d.codigo,
    cuerpo: `<p style="font-size:14px;color:#6b6b66">
  Cierra esta ventana y vuelve a intentarlo desde la aplicación.
  Si el problema continúa, comparte el código de arriba con tu capitán.</p>`,
  })
}

/** Pantalla de cierre de sesión. */
export function pantallaSesionCerrada(): string {
  return marco({
    titulo: 'Sesión cerrada',
    cuerpo: `<p style="font-size:14px;color:#6b6b66">Ya puedes cerrar esta ventana.</p>`,
  })
}
