# SGEB — API (AdonisJS 7)

Backend del Sistema de Gestión de Eventos de Banquetes. Monolito modular: un solo despliegue con módulos aislados, diseñado para que el módulo de identidad pueda extraerse después sin migración de datos.

Este proyecto se generó con `create-adonisjs` (starter kit oficial de API para v7) y se adaptó al SGEB. **No es un esqueleto suelto**: trae `ace.js`, `bin/`, `config/`, `tsconfig.json` y todo el andamiaje del framework.

**Verificado en Node 24.12.0:** `npm install` sin `ERESOLVE` · `npm run typecheck` sin errores · servidor arrancando y respondiendo con el envelope.

---

## Instalación

```bash
node -v          # DEBE ser >= 24. Adonis 7 no arranca con Node 22.
npm install
cp .env.example .env
node ace generate:key
```

Luego llena `.env`. **Todas las variables sin valor por defecto son obligatorias**: la validación de `start/env.ts` falla al arrancar, no en la primera petición. Es deliberado — un servidor que levanta sin `SSO_JWKS_URL` funciona hasta que alguien intenta autenticarse, y para entonces el síntoma aparece lejos de la causa.

```bash
npm run dev      # http://localhost:3333
```

Para desarrollo local sin acceso a los VPS, levanta PostgreSQL con Docker y apunta `DB_HOST=127.0.0.1`:

```bash
docker run -d --name sgeb-db -p 5432:5432 \
  -e POSTGRES_USER=sgeb -e POSTGRES_PASSWORD=devlocal -e POSTGRES_DB=sgeb postgres:16
```

---

## Contratos que este código implementa

Son la fuente de verdad; viven fuera del repo.

| Documento | Qué define |
|---|---|
| `openapi-sgeb.yaml` v1.3 | 104 operaciones en 66 rutas |
| `openapi-sso.yaml` v2.1 | Proveedor de identidad, OAuth 2.1 + PKCE |
| `diccionario-errores-sgeb.md` v1.3 | 65 códigos vigentes |
| `diccionario-errores-sso.md` v2.1 | Serie SSO-xxxx |
| `Diccionario_Datos_Auth_SGEB_v3.md` | 29 tablas de dominio + 9 de identidad |
| `Entorno_Tecnologico_Framework_SGEB_v0_4.docx` | Patrones por capa; §8 = SSO |

---

## Qué se quitó del starter kit y por qué

El kit oficial de API viene con autenticación propia. Nada de eso aplica aquí:

| Paquete | Motivo |
|---|---|
| `@adonisjs/auth` + access tokens | La identidad la emite el proveedor SSO. Esta API es **servidor de recursos**: valida firmas, no emite tokens |
| `@adonisjs/session` | API sin estado, con Bearer. No hay cookies de sesión |
| `@adonisjs/shield` | Protege contra CSRF, que aplica a formularios con cookies |
| `@tuyau/core` | Cliente RPC tipado para frontends Adonis. Los nuestros son React y Swift contra OpenAPI |
| `better-sqlite3` | La base es PostgreSQL en el VPS 3 |
| `providers/api_provider.ts` | Envolvía respuestas en `data`. **Chocaba con nuestro envelope**: habría producido `{data:{result,data}}` |

Ese último punto merece atención: si algún día se adopta la API de Transformers de v7, tiene que ser con `serialize.withoutWrapping`, o cada respuesta sale con doble envoltura.

Se agregaron `pg`, `jose` (validación de JWT contra JWKS) y `mqtt` (Cubaitor vía el broker del VPS 4).

---

## Estructura

```
app/
├── exceptions/handler.ts         Manejador global → envelope
├── shared/                       Infraestructura transversal
│   ├── envelope.ts               El envelope result/data
│   ├── responder.ts              Respuestas de éxito
│   ├── errors/
│   │   ├── catalogo.ts           Los 65 códigos, traducidos del diccionario
│   │   └── sgeb_error.ts         La excepción de dominio
│   └── middleware/
│       ├── trace_id.ts           Trace-Id por petición
│       ├── jwt_auth.ts           Validación de firma contra JWKS
│       ├── resolver_sujeto.ts    UUID → usuario interno, una vez por petición
│       └── rol.ts                Autorización por rol
└── modules/
    ├── identidad/                AISLADO. Ver regla de oro.
    ├── eventos/                  Salones, eventos, mesas, cronograma
    ├── participaciones/          Ciclo del mesero, llegada, asignaciones
    ├── menu/                     Insumos, bebidas, envases
    ├── ordenes/                  Órdenes y dispensado
    ├── cubaitor/                 IoT: dispositivos y configuración de pines
    ├── cierre/                   Mermas y pagos
    └── dashboard/                Agregados de solo lectura
```

Cada módulo lleva `controllers/`, `services/`, `models/` y `validators/`. Los alias `#shared/*` y `#modules/*` están en `package.json`.

---

## Las cinco reglas

### 1. El envelope no es negociable

Toda respuesta —éxito o error, cualquier estatus HTTP— sale como `{ result, data }`. El frontend nunca lee el estatus para decidir lógica: lee `result.code`.

Éxitos vía `responder`; fallos vía `throw new SgebError(...)`. **Un controlador nunca construye un envelope de error a mano.**

```ts
// ✅
return responder.creado(ctx, salon)
throw new SgebError('SGEB-4016', { tecnico: `... ${n} filas en EVENTO.` })

// ❌
return ctx.response.status(409).send({ result: { code: 'SGEB-4016', ... } })
```

### 2. Los servicios no conocen HTTP

Un servicio recibe datos y devuelve datos o lanza. No recibe `ctx`, no toca `response`, no sabe qué estatus saldrá. Eso lo hace probable sin levantar un servidor y reutilizable desde una tarea programada.

### 3. Toda baja es lógica

Ningún `DELETE` borra físicamente un registro con historia operativa: marca `activo = 0`. Si el borrado rompería historia, responde **SGEB-4016** y ofrece desactivar. Consultar después ese recurso devuelve **SGEB-3004** ("ya no está disponible"), no SGEB-3001 ("no existe") — el usuario necesita distinguirlos.

### 4. El entero de usuario no sale del backend

`USUARIO` es la única entidad con identificador público UUID. `id_usuario` es llave de JOIN y nada más.

La traducción ocurre **una vez por petición** en `resolver_sujeto.ts`. Además, `Usuario.id` lleva `serializeAs: null`: el entero no se escapa aunque alguien serialice el modelo completo por descuido en una relación anidada.

El resto del dominio (evento, orden, mesa, salón…) conserva enteros. No sobrecorregir.

### 5. Regla de oro: el dominio no toca identidad

Ningún módulo de negocio importa modelos de identidad ni consulta sus tablas. Todo pasa por `IdentidadService`.

```ts
// ❌ Esto mata la extracción del SSO
const filas = await Usuario.query().join('evento', ...)

// ✅
const perfiles = await this.identidad.perfiles(uuids)
```

`IdentidadService` es una **clase abstracta**, no una interfaz: una interfaz de TypeScript desaparece al compilar y no puede servir de llave en el contenedor. Así se inyecta por tipo y se puede sustituir en pruebas con `container.swap(IdentidadService, ...)`.

`providers/identidad_provider.ts` es el punto de conmutación: el día de la extracción se cambia `IdentidadLocal` por `IdentidadRemota` ahí y en ningún otro lugar.

Vale la pena una regla de ESLint que prohíba importar `#modules/identidad/models/*` desde otros módulos.

---

## Cómo se atiende una petición

```
Petición
  └─ trace_id          X-Trace-Id (existe aunque no haya ruta)
  └─ cors
  └─ jwt_auth          Firma vs JWKS → ctx.sujeto {uuid, rol}   [1002/1003]
  └─ resolver_sujeto   UUID → interno → ctx.usuario {id}
  └─ rol               ctx.sujeto.rol vs permitidos             [1004]
  └─ controlador       valida (VineJS) → llama servicio → responder
       └─ servicio     lógica; lanza SgebError
                            ↓ cualquier excepción
                       exceptions/handler.ts → envelope
```

**El orden de los middleware no es intercambiable.** `resolver_sujeto` sin `jwt_auth` truena en tiempo de ejecución.

---

## Traducción de excepciones

`app/exceptions/handler.ts` es el único lugar donde una excepción de infraestructura se convierte en código de negocio:

| Origen | Código |
|---|---|
| `SgebError` | El suyo |
| VineJS `required` | SGEB-2001 |
| VineJS `minLength` / `maxLength` | SGEB-2003 |
| VineJS `enum` / `in` | SGEB-2004 |
| VineJS (otras) | SGEB-2002 |
| PostgreSQL `23505` sobre correo | SGEB-2006 |
| PostgreSQL `23505` (otros únicos) | SGEB-2013 |
| PostgreSQL `23503` (FK) | SGEB-3002 |
| `ECONNREFUSED` / `ETIMEDOUT` | SGEB-5002 |
| Ruta inexistente | SGEB-3001 |
| Cualquier otra | SGEB-5001 + Trace-Id |

Solo se traducen los constraints con equivalente de negocio. Una violación que no previmos es defecto nuestro, no algo que el usuario pueda corregir: cae en 5001/5002.

---

## Comportamiento verificado

```bash
$ curl localhost:3333/v1/no-existe
{"result":{"code":"SGEB-3001","message":"No encontramos la información solicitada.",
 "technical_message":"Ruta no registrada: GET /v1/no-existe."},"data":null}

$ curl localhost:3333/v1/usuarios/me                        # HTTP 401
{"result":{"code":"SGEB-1003","message":"No pudimos validar tu sesión. Inicia sesión nuevamente.",
 "technical_message":"Encabezado Authorization ausente o sin esquema Bearer. Ruta: GET /v1/usuarios/me."},"data":null}

$ curl -H "X-Trace-Id: mi-traza-123" localhost:3333/v1/no-existe -D -
x-trace-id: mi-traza-123                                    # se respeta el del cliente
```

En producción `technical_message` no sale: lo filtra `limpiarParaCliente`.

---

## Reglas de logging

- `technical_message` **nunca** llega al cliente en producción.
- Nunca loguear contraseñas, tokens completos (solo prefijo `a3f9…`) ni CLABEs sin enmascarar (`0120…8903`).
- Los 5xx se registran completos; los 4xx en `debug`. Un capitán intentando borrar un salón en uso no es un incidente.
- El `technical_message` referencia usuarios por **UUID**, no por entero: es lo único que permite cruzar un incidente con los logs del SSO.

---

## Gobernanza de códigos

1. Un código **nunca** cambia de significado.
2. Los retirados **no se reciclan** (ver `RETIRADOS` en `catalogo.ts`).
3. Un código nuevo se documenta en el diccionario **antes** de usarse en código.
4. `catalogo.ts` y el `.md` se mantienen sincronizados. Conviene un test que compare ambos y falle en CI si divergen.

---

## Lo que falta

Este proyecto cubre la capa transversal y un módulo de referencia (`salones`). Pendiente, en orden sugerido:

1. **Migraciones y modelos** — 38 tablas. Esquema `auth` separado desde el primer día, sin FK cruzadas.
2. **Módulo de identidad** — proveedor OAuth 2.1 + PKCE (Entorno v0.4 §8.4). El más largo.
3. **Módulos de dominio** — eventos → participaciones → menú → órdenes → cierre.
4. **Cubaitor** — cliente MQTT suscrito al broker del VPS 4.
5. **Dashboard** — al final: agrega lo que los demás producen.
6. **Pruebas** — funcionales por endpoint. `@japa/openapi-assertions` permite validar las respuestas contra `openapi-sgeb.yaml` directamente.

---

## Notas de v7

- **Node 24 obligatorio.** Aplica también a los VPS de DigitalOcean y a CI.
- TypeScript ~6.0, ESLint 10, `@poppinss/ts-exec` en lugar de `ts-node`.
- `indexEntities()` en `adonisrc.ts` es obligatorio.
- `Request` / `Response` se renombraron a `HttpRequest` / `HttpResponse`.
- Globs de test: `*.spec.{ts,js}`, no `*.spec(.ts|.js)`.
- Al instalar paquetes de Japa, usar las versiones de v7: `@japa/plugin-adonisjs@^5.2.0` (el 4.x tiene peer `core@^6.17` y rompe `npm install`). Si sale `ERESOLVE`, **no taparlo con `--legacy-peer-deps` ni `--force`**: instala un árbol inconsistente y el fallo reaparece en ejecución.
