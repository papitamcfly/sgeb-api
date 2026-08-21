import vine from '@vinejs/vine'

export const cubaitorValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(2).maxLength(40),
    /** Seis octetos hexadecimales. Es la llave única del dispositivo. */
    mac: vine.string().trim().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/),
    /** Rango físico sugerido del ESP32: 1–16. */
    num_pins: vine.number().min(1).max(16),
    host_ip: vine
      .string()
      .trim()
      .regex(/^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/)
      .nullable()
      .optional(),
  })
)

export const configPinValidator = vine.compile(
  vine.object({
    id_cubaitor: vine.number().positive(),
    id_insumo: vine.number().positive(),
    /** GPIO válido del ESP32. */
    pin_gpio: vine.number().min(0).max(39),
    /** Resultado de calibración; debe ser > 0 o la división del tiempo revienta. */
    caudal_ml_seg: vine.number().min(0.01).max(999.99),
    volumen_cargado_ml: vine.number().min(1).max(65535),
  })
)

export const recargaValidator = vine.compile(
  vine.object({
    volumen_cargado_ml: vine.number().min(1).max(65535),
    reanudar_ordenes: vine.boolean().optional(),
  })
)

export const heartbeatValidator = vine.compile(
  vine.object({ mac: vine.string().trim().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/) })
)

/** La MAC no está aquí: es la identidad física del dispositivo y no se edita. */
export const cubaitorParcialValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().minLength(2).maxLength(40).optional(),
    num_pins: vine.number().min(1).max(16).optional(),
    host_ip: vine
      .string()
      .trim()
      .regex(/^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/)
      .nullable()
      .optional(),
    estado: vine.enum(['activo', 'inactivo', 'mantenimiento'] as const).optional(),
  })
)

/**
 * Recalibración. Ahora también acepta id_insumo y volumen_cargado_ml silenciosamente.
 */
export const configParcialValidator = vine.compile(
  vine.object({
    caudal_ml_seg: vine.number().min(0.01).max(999.99).optional(),
    pin_gpio: vine.number().min(0).max(39).optional(),
    id_insumo: vine.number().positive().optional(),
    volumen_cargado_ml: vine.number().min(1).max(65535).optional(),
  })
)
