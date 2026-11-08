# Plan de trabajo con Claude Code

Ubicación en el repositorio: `plan.md` (raíz). Estado al 2026-11-07: pasos 1 a 13 hechos; ver `docs/handoff.md`.

Cómo usarlo: un paso por sesión de trabajo. Pide siempre primero un plan sin código, revísalo y luego aprueba. Al terminar cada paso, pide un commit y esta línea: *"Actualiza docs/memoria.md con lo que decidimos."*

Revisa tú, sin delegar: las políticas RLS (paso 6), la firma del webhook de Wompi (paso 12) y los textos legales (paso 8).

## Fase 0: preparar el terreno

- [x] **1.** "Lee CLAUDE.md, agents.md y docs/memoria.md y dime qué entendiste del proyecto, qué skills ves disponibles y qué te falta para empezar."
- [x] **2.** "Repasemos los pendientes P-001 a P-009 uno por uno, y registra mis respuestas como decisiones en la memoria."
- [x] **3.** "Instala y configura Motion AI Kit (versión gratuita) y context-mode con las restricciones de agents.md sección 8. Muéstrame lo que vas a instalar antes."

## Fase 1: base técnica

- [x] **4.** "Crea el proyecto Next.js con TypeScript estricto, Tailwind, ESLint y la estructura de carpetas de agents.md. Configura `typecheck`, `lint` y pruebas."
- [x] **5.** "Conecta Supabase (entorno local y de pruebas) y deja las variables de entorno documentadas en un `.env.example`, sin valores reales."

## Fase 2: datos y seguridad

- [x] **6.** "Usa la skill supabase-migration: crea las tablas de clientes, productos, listas de precios y las políticas RLS, con el importado visible solo para mayoristas."
- [x] **7.** "Crea la tabla `actions`, la cola en Postgres y el componente `ActionButton` con la skill async-action. Incluye pruebas de doble clic y reintento."

## Fase 3: acceso y catálogo

- [x] **8.** "Con age-gate-compliance: aviso 18+, registro con fecha de nacimiento y auditoría. Deja `legal-copy.ts` con textos provisionales marcados para que yo los apruebe."
- [x] **9.** "Con pricing-by-customer-type: catálogo y precios por tipo de cliente, cajas para mayoristas y cantidad para minoristas, calculados en el servidor."

## Fase 4: inventario y carrito

- [x] **10.** "Con inventory-adjustment: `inventory_movements`, descuento atómico y reservas con vencimiento."
- [x] **11.** "Carrito y pedido hasta `awaiting_payment`, con reserva de stock y validación de mínimos."

## Fase 5: dinero (todo en sandbox)

- [x] **12.** "Con wompi-webhook: checkout con tarjeta y PSE, webhook con firma, estados y conciliación. Antes de escribir código, lee la documentación oficial y dime qué campos vas a usar."
- [x] **13.** "Con factus-invoice: emisión desde un worker tras el pago aprobado, catálogos en tablas de configuración y nota crédito para reembolsos."

## Fase 6: entrega, POS y control

- [x] **14.** "Con delivery-proof: tarifas configurables, asignación a mensajero propio o tercero y la vista móvil con cédula y firma."
- [x] **15.** "Con block-sales-rule: bloqueos por municipio, fecha y hora, evaluados en el checkout y en el POS."
- [ ] **16.** "Con pos-sale: la pantalla de caja con venta asíncrona, descuento compartido con la web y factura."
- [ ] **17.** "Panel de administración: aprobar mayoristas, ver facturas rechazadas, cola atascada, ajustes de inventario y reglas de bloqueo."

## Fase 7: salida a producción

- [ ] **18.** (Opcional) "Con antislop, revisa las descripciones de producto y los textos comerciales. No toques textos legales ni código."
- [ ] **19.** "Ejecuta thermos a mano sobre todo el repositorio y dame los hallazgos sin aplicar nada."
- [ ] **20.** "Corre pre-deploy-checklist y dime qué falla."
