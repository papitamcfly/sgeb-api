import vine from '@vinejs/vine'

export const cubaitorValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(2).maxLength(40),
    /** Seis octetos hexadecimales. Es la llave única del dispositivo. */
    mac: vine.string().trim().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/),
    /** Rango físico sugerido del ESP32: 1–16. */
    numPins: vine.number().min(1).max(16),
    hostIp: vine
      .string()
      .trim()
      .regex(/^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/)
      .nullable()
      .optional(),
  })
)

export const configPinValidator = vine.compile(
  vine.object({
    idCubaitor: vine.number().positive(),
    idInsumo: vine.number().positive(),
    /** GPIO válido del ESP32. */
    pinGpio: vine.number().min(0).max(39),
    /** Resultado de calibración; debe ser > 0 o la división del tiempo revienta. */
    caudalMlSeg: vine.number().min(0.01).max(999.99),
    volumenCargadoMl: vine.number().min(1).max(65535),
  })
)

export const recargaValidator = vine.compile(
  vine.object({
    volumenCargadoMl: vine.number().min(1).max(65535),
    reanudarOrdenes: vine.boolean().optional(),
  })
)

export const heartbeatValidator = vine.compile(
  vine.object({ mac: vine.string().trim().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/) })
)
