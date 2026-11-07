---
name: pre-deploy-checklist
description: Lista de verificación antes de desplegar a producción (entornos, secretos, RLS, pagos y facturación en modo real).
---

# pre-deploy-checklist

No despliegues si algún punto falla; repórtalo.

1. `typecheck`, `lint` y pruebas pasan. Migraciones aplicadas en orden en un entorno de prueba.
2. **RLS:** toda tabla del esquema público tiene RLS activa y políticas revisadas.
3. **Secretos:** ninguno en el repositorio ni en logs. `service_role` solo en servidor. Variables de producción distintas a las de sandbox.
4. **Wompi:** llaves de producción, URL del webhook registrada, firma verificada en una prueba real de bajo monto.
5. **Factus:** credenciales y rango de numeración de producción, catálogos validados, una factura de prueba aceptada por la DIAN.
6. **Cumplimiento:** aviso 18+ visible, texto legal en la versión aprobada, prueba de entrega activa, reglas de bloqueo cargadas.
7. **Cola y workers:** funcionando, con alertas de mensajes atascados y reintentos agotados.
8. **Inventario:** conteo inicial cargado y verificado antes de abrir la venta web.
9. **Revisión:** ejecutar `thermos` a mano (seguridad/bugs y calidad) y resolver o registrar hallazgos con el responsable.
10. **Memoria:** `docs/memoria.md` al día; pendientes P-001 a P-009 resueltos o aceptados explícitamente.
11. Plan de reversa: cómo volver atrás si falla el despliegue.
