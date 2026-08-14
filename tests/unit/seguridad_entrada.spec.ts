import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  CaptchaService,
  CaptchaLog,
  type ResultadoCaptcha,
} from '#shared/services/captcha_service'
import { LimitePeticionesService } from '#shared/services/limite_peticiones_service'
import type { SgebError } from '#shared/errors/sgeb_error'

async function codigo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_FALLO'
  } catch (e) {
    return (e as SgebError).codigo ?? 'SIN_CODIGO'
  }
}

/** Simula a Google devolviendo una puntuación fija. */
class CaptchaFalso extends CaptchaService {
  constructor(
    private score: number,
    private accionDevuelta?: string
  ) {
    super()
  }
  protected get exigeToken() {
    return true
  }
  async verificar(_t: string, accion: string): Promise<ResultadoCaptcha> {
    const dev = this.accionDevuelta ?? accion
    if (dev !== accion) {
      return { exito: false, puntuacion: this.score, accion: dev, motivo: 'acción no coincide' }
    }
    return { exito: this.score >= 0.5, puntuacion: this.score, accion: dev }
  }
}

test.group('reCAPTCHA', () => {
  test('el modo log acepta incluso sin token', async ({ assert }) => {
    /**
     * Las pruebas automatizadas y las herramientas de línea de comandos no
     * ejecutan JavaScript de navegador y no pueden producir un token. Sin esto
     * no habría forma de recorrer el flujo de login al desarrollar.
     */
    await new CaptchaLog().exigir(undefined, 'login')
    await new CaptchaLog().exigir('lo-que-sea', 'login')
    assert.isTrue(true)
  })

  test('SSO-4008: en producción el token ausente se rechaza', async ({ assert }) => {
    /**
     * Si fuera opcional, saltárselo sería tan fácil como no enviarlo y la
     * defensa no existiría.
     */
    assert.equal(await codigo(() => new CaptchaFalso(0.9).exigir(undefined, 'login')), 'SSO-4008')
  })

  test('una puntuación baja se rechaza', async ({ assert }) => {
    assert.equal(await codigo(() => new CaptchaFalso(0.1).exigir('tok', 'login')), 'SSO-4008')
    await new CaptchaFalso(0.9).exigir('tok', 'login')
  })

  test('la acción debe coincidir', async ({ assert }) => {
    /**
     * Sin esta comprobación, un token obtenido en una página pública de bajo
     * riesgo serviría para pasar el login, que es donde la puntuación importa.
     */
    const c = new CaptchaFalso(0.9, 'contacto')
    assert.equal(await codigo(() => c.exigir('tok', 'login')), 'SSO-4008')
  })

  test('el error no revela la puntuación al usuario', async ({ assert }) => {
    try {
      await new CaptchaFalso(0.1).exigir('tok', 'login')
      assert.fail('debió lanzar')
    } catch (e) {
      const err = e as SgebError & { message: string }
      /**
       * Revelarla le diría al atacante qué tan cerca está del umbral, que es
       * información para calibrar el siguiente intento. El detalle va al log.
       */
      assert.notInclude(err.message, '0.1')
      assert.notInclude(err.message.toLowerCase(), 'punt')
    }
  })
})

test.group('Límite por IP', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const IP = '187.190.10.5'

  test('permite hasta el tope y luego responde SSO-4009', async ({ assert }) => {
    const s = new LimitePeticionesService()

    /** `recuperacion` es el más estricto: 5 en 60 minutos. */
    for (let i = 0; i < 5; i++) await s.exigir('recuperacion', IP)

    assert.equal(await codigo(() => s.exigir('recuperacion', IP)), 'SSO-4009')
  })

  test('el límite es por IP: otra dirección no se ve afectada', async ({ assert }) => {
    const s = new LimitePeticionesService()
    for (let i = 0; i < 5; i++) await s.exigir('recuperacion', IP)

    await s.exigir('recuperacion', '201.140.3.9')
    assert.equal(await s.restantes('recuperacion', '201.140.3.9'), 4)
  })

  test('el límite es por acción: agotar una no bloquea otra', async ({ assert }) => {
    const s = new LimitePeticionesService()
    for (let i = 0; i < 5; i++) await s.exigir('recuperacion', IP)

    /** Un capitán que pidió recuperación no debe quedarse sin poder entrar. */
    await s.exigir('login', IP)
    assert.equal(await s.restantes('login', IP), 19)
  })

  test('los registros fuera de la ventana no cuentan', async ({ assert }) => {
    const s = new LimitePeticionesService()
    for (let i = 0; i < 5; i++) await s.exigir('recuperacion', IP)

    await db
      .from('auth.peticion_ip')
      .where('ip', IP)
      .update({ creado_en: DateTime.now().minus({ hours: 2 }).toSQL() })

    /** La ventana de `recuperacion` es de 60 minutos: dos horas después ya pasó. */
    await s.exigir('recuperacion', IP)
    assert.isTrue(true)
  })

  test('sin IP no se aplica el límite', async ({ assert }) => {
    const s = new LimitePeticionesService()
    for (let i = 0; i < 20; i++) await s.exigir('recuperacion', null)

    /** Peticiones internas o de prueba sin IP no deben quedar bloqueadas. */
    assert.lengthOf(await db.from('auth.peticion_ip'), 0)
  })

  test('una acción sin límite configurado no registra nada', async ({ assert }) => {
    const s = new LimitePeticionesService()
    await s.exigir('accion_inventada', IP)
    assert.lengthOf(await db.from('auth.peticion_ip'), 0)
  })

  test('el login tolera varias personas tras el mismo NAT', async ({ assert }) => {
    const s = new LimitePeticionesService()

    /**
     * El WiFi de un salón comparte IP entre todos los meseros. 20 intentos en
     * 15 minutos deja margen para varias personas equivocándose de contraseña,
     * sin abrir la puerta a un ataque que necesitaría miles.
     */
    for (let i = 0; i < 20; i++) await s.exigir('login', IP)
    assert.equal(await codigo(() => s.exigir('login', IP)), 'SSO-4009')
  })

  test('la purga limpia lo que ya no cuenta para ninguna ventana', async ({ assert }) => {
    const s = new LimitePeticionesService()
    await s.exigir('login', IP)
    await s.exigir('recuperacion', IP)

    /** Nada vencido todavía: la purga no debe tocar lo vigente. */
    assert.equal(await s.purgar(), 0)
    assert.lengthOf(await db.from('auth.peticion_ip'), 2)

    await db
      .from('auth.peticion_ip')
      .update({ creado_en: DateTime.now().minus({ days: 1 }).toSQL() })

    assert.equal(await s.purgar(), 2)
    assert.lengthOf(await db.from('auth.peticion_ip'), 0)
  })

  test('cuenta antes de procesar, no solo los fallos', async ({ assert }) => {
    const s = new LimitePeticionesService()

    /**
     * Contar solo los fallidos dejaría pasar un ataque que acierta de vez en
     * cuando; el registro entra siempre, con independencia del resultado.
     */
    await s.exigir('login', IP)
    assert.lengthOf(await db.from('auth.peticion_ip').where('ip', IP), 1)
  })
})
