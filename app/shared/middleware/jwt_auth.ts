import env from '#start/env'
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { SgebError } from '#shared/errors/sgeb_error'

/**
 * Validación del access token — el SGEB como SERVIDOR DE RECURSOS.
 *
 * El SGEB no autentica: verifica. Este middleware ejecuta la secuencia de la
 * sección 8.6 del Entorno Tecnológico v0.4 **sin consultar una sola tabla del
 * módulo de identidad**. Esa propiedad es lo que abarata la extracción futura
 * del SSO a un servidor propio: el día que se mude, aquí no cambia nada más
 * que una URL.
 *
 * Errores que emite: SGEB-1002 (expirado) y SGEB-1003 (inválido). El
 * SGEB-1004 (rol) lo emite el middleware de rol, después de este.
 */

/**
 * Caché del documento de llaves. `createRemoteJWKSet` refresca solo cuando
 * aparece un `kid` desconocido, con cooldown para que un token basura no
 * dispare una tormenta de peticiones al proveedor. Es lo que permite rotar la
 * llave de firma sin invalidar las sesiones en curso ni redesplegar la API.
 */
/**
 * ────────────────────────────────────────────────────────────────────────────
 *  DE DÓNDE SALEN LAS LLAVES: la segunda costura de la extracción
 * ────────────────────────────────────────────────────────────────────────────
 * `remoto` es el modo definitivo y el que describe la arquitectura: la API pide
 * el JWKS por HTTP al proveedor, como haría contra Keycloak o Auth0.
 *
 * `local` existe porque HOY el proveedor vive en el mismo proceso, y pedirle el
 * JWKS por HTTP a uno mismo es frágil sin ganar nada: el servidor tendría que
 * estar escuchando para poder validar su primer token, lo que rompe las pruebas
 * y complica el arranque. En modo local se leen las mismas llaves públicas
 * directamente de la base.
 *
 * **Lo que NO cambia entre modos es la validación**: mismo algoritmo, mismo
 * emisor, misma audiencia, misma verificación de firma. Solo cambia el
 * transporte. Al extraer el módulo se pone `SSO_JWKS_MODE=remoto` y ya.
 */
const jwksRemoto = createRemoteJWKSet(new URL(env.get('SSO_JWKS_URL')), {
  cacheMaxAge: 24 * 60 * 60 * 1000,
  cooldownDuration: 30_000,
})

async function llaves(): Promise<Parameters<typeof jwtVerify>[1]> {
  if (env.get('SSO_JWKS_MODE') === 'remoto') return jwksRemoto

  const { LlaveFirmaService } = await import('#modules/identidad/services/llave_firma_service')
  const doc = await new LlaveFirmaService().jwks()
  return createLocalJWKSet(doc as Parameters<typeof createLocalJWKSet>[0])
}

export interface Sujeto {
  /** Claim `sub`. UUID público del usuario. Única fuente de identidad. */
  uuid: string
  rol: 'admin' | 'capitan' | 'mesero'
  /** Identificador de sesión del proveedor, para trazar entre SSO y SGEB. */
  sid?: string
  /** Identificador del token, para deduplicar en bitácora. */
  jti?: string
  scopes: string[]
}

declare module '@adonisjs/core/http' {
  interface HttpContext {
    sujeto: Sujeto
  }
}

export default class JwtAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const encabezado = ctx.request.header('authorization')

    if (!encabezado?.startsWith('Bearer ')) {
      throw new SgebError('SGEB-1003', {
        tecnico:
          `Encabezado Authorization ausente o sin esquema Bearer. ` +
          `Ruta: ${ctx.request.method()} ${ctx.request.url()}.`,
      })
    }

    const token = encabezado.slice(7)

    try {
      const { payload, protectedHeader } = await jwtVerify(token, await llaves(), {
        issuer: env.get('SSO_ISSUER'),
        audience: env.get('SSO_AUDIENCE'),
        /**
         * Lista blanca explícita. NUNCA se acepta el algoritmo que declara el
         * propio token, ni `none`: eso es el ataque de confusión de algoritmo,
         * donde un atacante cambia el header a HS256 y firma con la llave
         * pública, que es pública.
         */
        algorithms: ['RS256', 'ES256'],
        clockTolerance: 30,
      })

      const rol = payload.rol as Sujeto['rol'] | undefined

      // Un token bien firmado pero sin los claims que necesitamos es inválido
      // para esta API, aunque sea perfectamente válido para el proveedor.
      if (typeof payload.sub !== 'string' || !rol) {
        throw new SgebError('SGEB-1003', {
          tecnico:
            `JWT válido pero con claims incompletos: sub=${payload.sub ?? 'ausente'}, ` +
            `rol=${rol ?? 'ausente'}. kid=${protectedHeader.kid}.`,
        })
      }

      ctx.sujeto = {
        uuid: payload.sub,
        rol,
        sid: payload.sid as string | undefined,
        jti: payload.jti,
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
      }

      return next()
    } catch (error) {
      if (error instanceof SgebError) throw error

      /**
       * La distinción entre expirado e inválido no es cosmética: con SGEB-1002
       * el cliente intenta renovar en /token antes de mandar al usuario al
       * login; con SGEB-1003 va directo al login. Colapsar los dos hace que el
       * mesero recapture credenciales cada quince minutos.
       */
      if (error instanceof joseErrors.JWTExpired) {
        throw new SgebError('SGEB-1002', {
          tecnico:
            `JWT expirado. sub=${(error.payload?.sub as string) ?? 'desconocido'}, ` +
            `exp=${(error.payload?.exp as number) ?? '?'}. Ruta: ${ctx.request.method()} ${ctx.request.url()}.`,
          causa: error,
        })
      }

      throw new SgebError('SGEB-1003', {
        tecnico: `JWT inválido: ${(error as Error).name} — ${(error as Error).message}.`,
        causa: error,
      })
    }
  }
}
