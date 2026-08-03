# SGEB — API (AdonisJS 7)

Backend del Sistema de Gestión de Eventos de Banquetes. Monolito modular: un solo despliegue con módulos aislados, diseñado para que el módulo de identidad pueda extraerse después sin migración de datos.

Este proyecto se generó con `create-adonisjs` (starter kit oficial de API para v7) y se adaptó al SGEB. **No es un esqueleto suelto**: trae `ace.js`, `bin/`, `config/`, `tsconfig.json` y todo el andamiaje del framework.

**Verificado en Node 24.12.0 y PostgreSQL 16:** `npm install` sin `ERESOLVE` · `npm run typecheck` sin errores · servidor arrancando y respondiendo con el envelope · 37 tablas migradas, revertidas y re-aplicadas sin residuos · 19 pruebas en verde.

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

## Base de datos

**37 tablas**: las 29 del Diccionario de Datos en `public` y las 8 del módulo de identidad en `auth`. Seis migraciones, probadas contra PostgreSQL 16: aplicadas, revertidas y re-aplicadas sin dejar tablas ni tipos ENUM huérfanos.

| Migración | Contenido |
|---|---|
| `…001_create_usuarios_y_roles` | ROL (con los 3 roles precargados), USUARIO, DATOS_BANCARIOS |
| `…002_create_auth_module_tables` | Esquema `auth` + sus 8 tablas |
| `…003_create_eventos_core` | SALON, EVENTO, MESA, PARTICIPACION_EVENTO, CONFIRMACION_LLEGADA, ASIGNACION_MESA |
| `…004_create_checklists_y_menu` | CHECKLIST y sus 3 tablas, INSUMO, BEBIDA, RECETA_INGREDIENTE, ENVASE |
| `…005_create_iot_y_ordenes` | CUBAITOR, CONFIG_DISPENSADO, ORDEN, ORDEN_DETALLE, DISPENSADO |
| `…006_create_comunicacion_y_cierre` | CRONOGRAMA_EVENTO, SOLICITUD_SERVICIO, NOTIFICACION, CALIFICACION, PAGO, REPORTE_MERMA, MERMA_DETALLE |

Del módulo de identidad son 8 y no 9: `CREDENCIAL_BIOMETRICA` no se crea, porque la decisión v0.4 retiró la biometría como método de autenticación y la confirmación de llegada usa atestación local.

### Dónde vive USUARIO, y por qué

En `public`, no en `auth`. Es la tabla más referenciada del sistema —EVENTO la apunta dos veces, más PARTICIPACION_EVENTO, REPORTE_MERMA y DATOS_BANCARIOS—; ponerla en `auth` obligaría a cinco tablas de dominio a apuntar hacia afuera, o a renunciar a esas llaves foráneas.

**Es una tabla de dominio que además guarda credenciales**, no al revés. El esquema `auth` aloja solo las 8 tablas que existen únicamente para autenticar y que se mudan completas el día de la extracción.

Por eso las FK cruzan en una sola dirección: `auth.*` → `public.usuario`, nunca al revés. Verificado por consulta y fijado por una prueba automatizada:

```
FKs public → auth: 0
```

Al extraer el módulo, sus tablas viajan con una proyección de USUARIO que se convierte en CUENTA con `uuid_usuario` como PK (Anexo D del Diccionario v3). Del lado del SGEB, USUARIO queda como copia sombra sin `password_hash`. **Ninguna tabla de dominio se ve afectada**, que es exactamente el objetivo.

### Discrepancias encontradas en el Diccionario de Datos

Se resolvieron al implementar. Conviene corregirlas también en el documento para que no reaparezcan.

| # | Tabla | Discrepancia | Resolución |
|---|---|---|---|
| 1 | CONFIRMACION_LLEGADA | `longitud DECIMAL(10,8)` solo admite **dos** dígitos enteros (máx. 99.99999999). Torreón está en −103.4 | **DECIMAL(11,8)**, igual que en SALON |
| 2 | SALON | Tipo `VARCHAR(30)` para `nombre`, pero las reglas permiten 80 | VARCHAR(80) |
| 3 | EVENTO | Tipo `VARCHAR(40)` para `titulo`, pero las reglas permiten 120 | VARCHAR(120) |
| 4 | DATOS_BANCARIOS | `titular_cuenta VARCHAR(50)` con regex `{3,500}` | VARCHAR(50); el regex es errata |
| 5 | NOTIFICACION | `mensaje VARCHAR(100)` pero la sanitización dice "truncar a 255" | VARCHAR(100) |
| 6 | ORDEN | El enumerado usa `entregada`; `openapi-sgeb.yaml` usa `servida` | Se adopta el Diccionario; **falta alinear el OpenAPI** |

**La #1 es la grave.** No es un detalle de estilo: `DECIMAL(10,8)` provoca `numeric field overflow` al guardar cualquier longitud de tres dígitos, así que **toda confirmación de llegada fallaría en la sede del propio negocio**. Reproducido en PostgreSQL:

```
ERROR: numeric field overflow
DETAIL: A field with precision 10, scale 8 must round to an absolute value less than 10^2.
```

La #6 sigue abierta: hay que decidir si el OpenAPI cambia a `entregada` o el Diccionario a `servida`, pero los dos no pueden convivir.

### Invariantes que impone la base, no la aplicación

Están en la base porque una regla que solo vive en el código se salta desde una consola de `psql`, desde un script de migración de datos o desde un endpoint que alguien escriba sin conocerla. Cada uno tiene su prueba en `tests/unit/esquema_invariantes.spec.ts`.

| Restricción | Qué impide |
|---|---|
| `datos_bancarios_una_activa_por_usuario` | Dos CLABEs activas del mismo mesero → ambigüedad al dispersar el pago |
| `llave_firma_una_activa` | Dos llaves de firma activas → los tokens se firman de forma no determinista |
| `invitacion_una_pendiente_por_correo` | Dos capitanes invitando a la misma persona → cuenta duplicada |
| `participacion_evento (id_evento, id_usuario)` | Doble toque en la app → dos lugares del cupo consumidos |
| `mesa (id_evento, etiqueta)` | Dos "Mesa 1" en el mismo evento. Entre eventos sí se permite |
| `config_dispensado_pin_unico_por_evento` | Dos insumos en el mismo GPIO (SGEB-4019) → la bebida sale con el líquido equivocado |
| `calificacion.token_comensal UNIQUE` | Segunda calificación del mismo comensal (SGEB-4010); es lo único que deduplica, porque el comensal es anónimo |
| `CHECK evento_fin_posterior_a_inicio` | Eventos que terminan antes de empezar |
| `CHECK evento_geocerca_valida` | Radios fuera de 10–1000 m |
| `CHECK config_disponible_no_excede_cargado` | Más líquido disponible que cargado |

Los índices parciales (los tres primeros) no se pueden hacer con un `UNIQUE` ordinario: hay que permitir muchas filas inactivas y solo una activa. Eso es exactamente un índice parcial con `WHERE`.

### Base de pruebas

```bash
createdb sgeb_test
NODE_ENV=test node ace migration:run
node ace test unit          # 19 pruebas
```

Cada prueba corre en una transacción que se revierte al terminar, así el orden de ejecución no importa.

**Detalle que muerde al probar restricciones:** PostgreSQL aborta la transacción completa al primer error, y toda consulta posterior responde `current transaction is aborted`. Por eso las violaciones esperadas se envuelven en un `SAVEPOINT` (helper `debeFallar`). Es el mismo patrón que necesita la aplicación cuando quiere intentar un `INSERT` y reaccionar al duplicado sin abortar toda la operación.

---

## Lo que falta

1. **Modelos Lucid del dominio** — hay tres (`Usuario`, `Rol`, `Salon`); faltan 26.
2. **Módulo de identidad** — proveedor OAuth 2.1 + PKCE (Entorno v0.4 §8.4). El más largo.
3. **Módulos de dominio** — eventos → participaciones → menú → órdenes → cierre.
4. **Cubaitor** — cliente MQTT suscrito al broker del VPS 4.
5. **Dashboard** — al final: agrega lo que los demás producen.
6. **Pruebas funcionales** por endpoint. `@japa/openapi-assertions` permite validar las respuestas contra `openapi-sgeb.yaml` directamente.
7. **Alinear la discrepancia #6** (`entregada` vs `servida`) entre Diccionario y OpenAPI.

---

## Notas de v7

- **Node 24 obligatorio.** Aplica también a los VPS de DigitalOcean y a CI.
- TypeScript ~6.0, ESLint 10, `@poppinss/ts-exec` en lugar de `ts-node`.
- `indexEntities()` en `adonisrc.ts` es obligatorio.
- `Request` / `Response` se renombraron a `HttpRequest` / `HttpResponse`.
- Globs de test: `*.spec.{ts,js}`, no `*.spec(.ts|.js)`.
- Al instalar paquetes de Japa, usar las versiones de v7: `@japa/plugin-adonisjs@^5.2.0` (el 4.x tiene peer `core@^6.17` y rompe `npm install`). Si sale `ERESOLVE`, **no taparlo con `--legacy-peer-deps` ni `--force`**: instala un árbol inconsistente y el fallo reaparece en ejecución.
