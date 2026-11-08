# agents.md — Reglas del proyecto

Proyecto: tienda web de licor mayorista y minorista (solo Antioquia, Colombia), con POS físico e inventario compartido.
Este archivo se lee en cada sesión. Si algo no está aquí ni en la memoria, **pregunta; no inventes**.

## 1. Memoria (obligatorio)

- Fichero de memoria: **`docs/memoria.md`**. Léelo al iniciar cada sesión, antes de planear o escribir código.
- Cada decisión importante (tecnología, regla de negocio, convención, cambio de alcance) se registra allí **en el mismo cambio** en que se toma, con fecha, decisión, motivo y alternativas descartadas.
- Si el código contradice la memoria, detente y pregunta cuál manda. No resuelvas la contradicción por tu cuenta.
- Los supuestos tuyos se marcan como `PENDIENTE DE CONFIRMAR`, nunca como decisión.

## 2. Stack (cerrado)

| Capa | Tecnología |
|---|---|
| Frontend | Next.js (App Router) + TypeScript estricto + Tailwind |
| Backend | Monolito modular dentro de Next.js (Route Handlers / Server Actions) |
| Datos | Supabase: Postgres, Auth, RLS, funciones SQL |
| Cola | Cola en Postgres (Supabase Queues/pgmq) + workers (Edge Functions o Route Handlers invocados por pg_cron) |
| Pagos | Wompi (tarjeta, PSE y los demás medios que ofrezca) |
| Facturación | Factus (factura electrónica DIAN) |
| Animación | Motion (solo interfaz; ver sección 8) |

No cambies, sustituyas ni agregues tecnologías o dependencias sin preguntar y registrar la decisión en la memoria.

## 3. Estructura

```
src/app/                 rutas, layouts, Route Handlers (finos: validan y delegan)
src/modules/<modulo>/    lógica de negocio por módulo
  domain/                tipos, reglas puras (sin I/O)
  server/                acceso a datos, casos de uso, workers
  ui/                    componentes del módulo
src/shared/              ActionButton, utilidades, clientes (supabase, wompi, factus)
supabase/migrations/     migraciones SQL (solo se agregan, nunca se editan)
docs/memoria.md          memoria de decisiones
.claude/skills/          skills del proyecto
```

Módulos: `catalog`, `pricing`, `customers`, `cart`, `orders`, `payments`, `invoicing`, `inventory`, `pos`, `delivery`, `compliance`.
Un módulo solo importa de otro a través de su `index.ts` público. Nada de importar archivos internos de otro módulo.

## 4. Convenciones de nombres

- **Código, tablas, columnas, rutas y commits: inglés.** **Textos de interfaz y mensajes al usuario: español (Colombia).**
- Archivos y carpetas: `kebab-case`. Componentes React: `PascalCase`. Funciones y variables: `camelCase`. Constantes: `UPPER_SNAKE_CASE`. Tipos: `PascalCase`.
- Tablas: `snake_case` plural (`orders`, `inventory_movements`). Columnas: `snake_case`. Claves primarias: `id uuid`. Claves foráneas: `<tabla_singular>_id`.
- Fechas: `timestamptz` en UTC; se muestran en `America/Bogota`.
- Dinero: enteros en pesos colombianos, columnas con sufijo `_cop` (`total_cop`). Para Wompi se convierte a centavos solo en el borde de la integración. Nunca `float`.
- Enums en Postgres con valores `snake_case`. Estados de pedido: `draft`, `awaiting_payment`, `paid`, `preparing`, `out_for_delivery`, `delivered`, `cancelled`, `refunded`. Estado de factura (columna aparte): `pending`, `sent`, `accepted`, `rejected`.
- Tipos de cliente: `retail` y `wholesale`. Origen de producto: `national` e `imported`.
- Seguimiento: el **ID de seguimiento** es `tracking_id` (uuid, es el `id` de la tabla `actions`); la clave de idempotencia es `idempotency_key`.
- Migraciones: `YYYYMMDDHHMMSS_descripcion_corta.sql`.

## 5. Reglas no negociables

1. **Precios siempre en el servidor.** Nunca se calculan ni se confían desde el navegador.
2. **Botones de acción congelados.** Todo botón que pague o genere una acción usa `ActionButton` (`src/shared`). Se bloquea al primer clic y se libera solo cuando el servidor devuelve el `tracking_id` (acciones rápidas) o cuando la acción termina (pagos). Prohibido usar `<button>` suelto para acciones.
3. **Idempotencia en tres capas:** botón bloqueado, `idempotency_key` enviada por el cliente y restricción `UNIQUE` en base de datos.
4. **Aceptar rápido, procesar después.** Los endpoints que disparan trabajo pesado guardan la acción, la encolan y responden `202` con `tracking_id`. Facturación, correos y conciliaciones corren en workers, no en la petición.
5. **Webhooks:** verifica la firma, guarda el evento crudo de forma idempotente y procesa en cola. La fuente de verdad del pago es el webhook de Wompi, no la redirección del navegador.
6. **Factura solo con pago aprobado.** Referencia única por pedido hacia Factus; reintentos con backoff; rechazos de la DIAN visibles para el administrador.
7. **Inventario solo por movimientos.** El stock cambia únicamente insertando en `inventory_movements`. Descuento atómico condicionado a stock suficiente. Reservas con vencimiento para pedidos web pendientes.
8. **RLS activa en toda tabla** del esquema público. El rol del usuario vive en `app_metadata` del JWT, nunca en `user_metadata`.
9. **Cumplimiento de licor:** aviso de mayoría de edad visible de forma permanente, fecha de nacimiento verificada (≥18) en el registro, prueba de entrega con cédula y firma, y bloqueos configurables de venta por municipio, fecha y hora.
10. **No inventes APIs.** Para Wompi y Factus usa su documentación oficial y su sandbox. Si no la puedes consultar, dilo y pregunta.

## 6. Prohibido tocar sin aprobación expresa

- Migraciones ya existentes en `supabase/migrations/` (se crean nuevas).
- Archivos `.env*` y cualquier secreto. Nunca los leas, imprimas ni los subas al repositorio. La `service_role` solo se usa en servidor.
- `src/modules/compliance/legal-copy.ts` y cualquier texto legal (aviso 18+, términos, advertencias). Su redacción es exacta y la aprueba una persona.
- El código de verificación de firmas de webhooks (`src/modules/payments/server/verify-signature.ts`) salvo con revisión.
- Datos de producción. Las pruebas usan sandbox de Wompi y Factus.

## 7. Flujo de trabajo

1. Lee `docs/memoria.md`. 2. Si el cambio toca más de un archivo, presenta un plan corto y espera confirmación. 3. Implementa con la skill correspondiente (sección 9). 4. Ejecuta `typecheck`, `lint` y pruebas. 5. Registra decisiones nuevas en la memoria. 6. Informa en pocas líneas qué cambió y qué quedó pendiente.

Definición de terminado: compila, pasa lint y pruebas, no deja secretos, tiene RLS si hay tablas nuevas y la memoria está al día.

## 8. Herramientas externas y su alcance

- **Motion AI Kit** (skill `/motion` + MCP, versión gratuita): solo para animación de interfaz. Nunca oculta el estado bloqueado de `ActionButton`, respeta `prefers-reduced-motion`, y no se anima nada en checkout ni en la pantalla del POS. Preferir CSS para lo simple.
- **context-mode** (servidor MCP): permitido para ahorrar contexto. Migraciones, políticas RLS y webhooks se leen **completos**, no resumidos. `.env*` queda denegado en los permisos. Versión fijada y código revisado antes de instalar.
- **antislop** (skill): solo para textos comerciales y descripciones de producto. Nunca sobre código ni sobre textos legales.
- **web-design-guidelines** (skill de Vercel, copia fijada en `.claude/skills/`) y **accessibility** (skill WCAG 2.2 de Addy Osmani, copia fijada): **solo auditoría**. Reportan hallazgos; nada se corrige sin aprobación. No descargan reglas ni instalan herramientas (Lighthouse, axe) sin aprobación. Las reglas de este archivo y de la memoria mandan sobre sus pautas (español sin Title Case, botón congelado sin spinner, movimiento limitado). Ver D-061.
- **thermos** (revisión con dos subagentes en paralelo, seguridad/bugs y calidad): solo a mano, antes de fusionar a la rama principal. Sus hallazgos se reportan; no se aplican sin aprobación. No debe proponer cambiar el monolito modular ni el stack.

## 9. Skills del proyecto (`.claude/skills/`)

| Skill | Úsala cuando |
|---|---|
| `supabase-migration` | Creas o cambias tablas, políticas RLS o funciones |
| `async-action` | Un botón o endpoint dispara una acción con cola y `tracking_id` |
| `wompi-webhook` | Tocas pagos, firmas, estados o conciliación |
| `factus-invoice` | Emites facturas, notas crédito o reintentas rechazos |
| `pricing-by-customer-type` | Muestras o calculas precios, cajas o mínimos |
| `age-gate-compliance` | Tocas aviso 18+, registro o textos legales |
| `pos-sale` | Registras una venta física |
| `inventory-adjustment` | Ajustes, conteos cíclicos, mermas o reservas |
| `block-sales-rule` | Reglas de bloqueo por municipio, fecha u hora |
| `delivery-proof` | Cargos de domicilio, entrega y prueba con cédula |
| `pre-deploy-checklist` | Antes de desplegar a producción |
