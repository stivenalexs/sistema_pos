# La Cava · sistema_pos

Tienda web de licores **mayorista y minorista** para Antioquia (Colombia), con **punto de venta físico (POS)** e **inventario compartido**. Una botella vendida en la caja deja de estar disponible en la web al instante, y al revés.

> **Proyecto de demostración.** No está pensado para vender de verdad: usa solo los sandbox de Wompi y Factus, y los textos legales están en borrador.
> Demo: **https://sistema-pos-woad.vercel.app** (datos de prueba).

## Qué hace

| Área | Funcionalidad |
|---|---|
| **Catálogo y precios** | Precios por tipo de cliente (minorista por unidad, mayorista por caja), listas especiales, importados solo para mayoristas aprobados. El precio siempre se calcula en el servidor. |
| **Cumplimiento** | Aviso 18+ permanente, fecha de nacimiento verificada en el registro con auditoría, bloqueos de venta por municipio, fecha y hora (ley seca). |
| **Pedidos y pagos** | Carrito en la base de datos, reservas de stock con vencimiento, pago con **Wompi** (tarjeta, PSE…) confirmado por webhook firmado y conciliación automática. |
| **Facturación** | Factura electrónica DIAN con **Factus**, desglose de IVA e impuesto al consumo de licores, notas crédito totales y parciales. |
| **Domicilios** | Tarifa por distancia (PostGIS) en el Valle de Aburrá, mensajeros propios o terceros, prueba de entrega con cédula y firma, manejo de entregas fallidas. |
| **Recogida en tienda** | El cliente confirma la recogida con su cédula (solo se guarda una huella HMAC) o el NIT de su empresa. |
| **POS** | Venta en caja con el mismo motor de precios, efectivo y cambio, cliente opcional y factura automática. |
| **Panel de administración** | Bandeja de tareas, personal por invitación, aprobación de mayoristas, inventario, facturas, reembolsos, cola de trabajos, domicilios, zonas, tarifas y bloqueos. |

## Stack

- **Next.js 16** (App Router) · **TypeScript** estricto · **Tailwind CSS 4**
- **Supabase**: Postgres, Auth, RLS en todas las tablas, Storage, `pgmq` (cola), `pg_cron`, `pg_net` y PostGIS
- **Wompi** (pagos) · **Factus** (factura electrónica) · **nodemailer** (correo SMTP) · **Leaflet** (mapas)
- **Vitest** y **pgTAP** para las pruebas · desplegado en **Vercel**

## Arquitectura

Monolito modular dentro de Next.js. La lógica crítica (precios, stock, pagos, permisos) vive en **funciones SQL** que la base de datos garantiza de forma atómica.

```
src/app/              rutas, layouts y Route Handlers (delgados: validan y delegan)
src/modules/<módulo>/ lógica de negocio
  domain/             tipos y reglas puras
  server/             acceso a datos, casos de uso y workers
  ui/                 componentes
  index.ts            API pública (servidor)
  client.ts           API segura para el navegador
src/shared/           ActionButton, clientes de Supabase, utilidades
supabase/migrations/  migraciones SQL (solo se agregan)
supabase/tests/       pruebas pgTAP
```

Módulos: `catalog`, `pricing`, `customers`, `cart`, `orders`, `payments`, `invoicing`, `inventory`, `pos`, `delivery`, `compliance`. Un módulo solo importa otro por su `index.ts` o `client.ts`; ESLint lo hace cumplir.

**Principios no negociables**

- **Aceptar rápido, procesar después:** el trabajo pesado (facturas, correos, conciliación) se encola y responde `202` con un `tracking_id`; un worker invocado por `pg_cron` lo procesa con reintentos.
- **Idempotencia en tres capas:** botón congelado al primer clic (`ActionButton`), `idempotency_key` del cliente y restricción `UNIQUE` en la base.
- **Inventario por movimientos:** el stock solo cambia insertando en un libro de solo inserción; el descuento es atómico y nunca deja saldos negativos.
- **El webhook es la fuente de verdad del pago**, nunca la redirección del navegador.

## Empezar en local

**Requisitos:** Node.js 22+, Docker Desktop.

```bash
npm install
cp .env.example .env.local   # completa los valores (ver abajo)
npm run db:start             # Supabase local en Docker
npm run db:reset             # migraciones + datos de ejemplo
npm run dev                  # http://localhost:3000
```

### Variables de entorno

`.env.example` documenta todas sin valores. Las principales:

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Cliente de Supabase (salen de `npm run db:status`) |
| `SUPABASE_SECRET_KEY` | Solo servidor: workers y webhooks |
| `WORKER_SECRET` | Autoriza las llamadas de `pg_cron` al worker (mínimo 32 caracteres) |
| `WOMPI_*` | Llaves del sandbox de Wompi (`WOMPI_ENV=sandbox`) |
| `FACTUS_*` | Credenciales del sandbox de Factus |
| `SMTP_*`, `EMAIL_FROM`, `APP_URL` | Correos de la tienda (en local, Mailpit en `127.0.0.1:54325`) |

La app se niega a arrancar si mezclas llaves de sandbox y producción. **Nunca subas `.env.local` al repositorio.**

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | Servidor de desarrollo, compilación y producción |
| `npm run typecheck` / `lint` | TypeScript y ESLint |
| `npm test` | Pruebas Vitest |
| `npm run db:test` | Pruebas pgTAP de la base de datos |
| `npm run db:reset` | Vuelve la base local a `seed.sql` |
| `npm run db:types` | Regenera los tipos de TypeScript desde la base |
| `npm run db:snapshot` | Foto del esquema actual en `supabase/schema-snapshot.sql` |
| `npm run db:backup` / `db:restore` | Respaldo y restauración de la base local |

## Pruebas

Más de 220 pruebas Vitest y más de 760 pgTAP cubren precios, RLS por tipo de usuario, idempotencia, concurrencia de stock, firmas de webhooks, impuestos y flujos de entrega.

```bash
npm run typecheck && npm run lint && npm test && npm run db:test
```

## Documentación

- [`agents.md`](agents.md): reglas del proyecto (stack, convenciones y reglas no negociables).
- [`docs/memoria.md`](docs/memoria.md): registro de decisiones con su motivo y alternativas descartadas.
- [`docs/handoff.md`](docs/handoff.md): estado actual y trucos para retomar el trabajo.
- [`docs/plan-reversa.md`](docs/plan-reversa.md): cómo volver atrás si un despliegue falla.

## Licencia

[MIT](LICENSE) © 2026 stiven alexander giraldo
