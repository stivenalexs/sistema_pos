# Plan de trabajo con Claude Code

Ubicación en el repositorio: `plan.md` (raíz). Estado al 2026-11-21: pasos 1 a 17 hechos, el paso agregado 17e (recogida en tienda y domicilios fallidos) y los pasos 19 y 20 corridos como reporte (D-071, D-070); falta el paso 18 (opcional) y corregir los hallazgos de thermos. Ver `docs/handoff.md`.

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
- [x] **16.** "Con pos-sale: la pantalla de caja con venta asíncrona, descuento compartido con la web y factura."
- [x] **17.** "Panel de administración: aprobar mayoristas, ver facturas rechazadas, cola atascada, ajustes de inventario y reglas de bloqueo." Hecho en partes: 17a mayoristas y personal (D-054), 17b facturas, notas crédito, cola y reembolsos (D-055), 17c inventario (D-056), 17d-1 ventas POS y domicilios (D-057), 17d-2a tienda, zonas y tarifas (D-058), 17d-2b reglas de bloqueo (D-060) y 17d-3 pedido web endurecido y Factus probado en el sandbox (D-066).
- [x] **17e.** (Agregado, decisiones de D-059.) "Recogida en tienda confirmada por el cliente y domicilios fallidos: devolución a la tienda, elección del cliente, reprogramación, correo y reembolso de solo productos." En la memoria y los commits se llamó "paso 18": 18a recogida (D-067), 18b-1 domicilios fallidos y correo (D-068) y 18b-2 reembolso de productos con nota crédito parcial (D-069). No confundir con el paso 18 de este plan (antislop).

## Pendientes fuera del plan

- POS: venta sin internet y apertura y cierre de caja (D-053).
- Rediseño del panel, propuestas 4 a 6: listas en tabla, estados vacíos que orienten y la entrada de mercancía primero en Inventario (D-064).
- Accesibilidad: pendientes menores de la auditoría (D-062).
- Por confirmar: P-006 (abogado: textos legales, ley seca, habeas data) y P-013 (documentos del mayorista).

## Fase 7: salida a producción

Antes del paso 18 hay que instalar la skill antislop (no está en `.claude/skills/`), con aprobación y versión fijada (agents.md §8). thermos ya está instalada (D-071).

- [ ] **18.** (Opcional) "Con antislop, revisa las descripciones de producto y los textos comerciales. No toques textos legales ni código."
- [x] **19.** "Ejecuta thermos a mano sobre todo el repositorio y dame los hallazgos sin aplicar nada." Corrido el 2026-11-21 (D-071): 7 hallazgos de seguridad y bugs (1 alto: pago duplicado que marca el pedido para reembolso) y 11 de calidad; ninguno aplicado.
- [x] **20.** "Corre pre-deploy-checklist y dime qué falla." Corrido el 2026-11-21 (D-070): no se puede desplegar; fallan 8 de 11 puntos porque no hay entorno alojado ni credenciales de producción, los textos legales siguen en borrador, falta el inventario real, thermos y un plan de reversa. Volver a correrlo antes de cualquier despliegue.
