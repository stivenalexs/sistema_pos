---
name: wompi-webhook
description: Integrar o modificar pagos con Wompi (checkout, PSE, webhooks, firmas, estados, conciliación). Úsala en todo lo que toque dinero entrante.
---

# wompi-webhook

Antes de escribir código, **consulta la documentación oficial de Wompi y su sandbox**; no asumas nombres de campos ni algoritmos de memoria. Lo siguiente es el esquema de trabajo y los puntos a verificar.

1. **Referencia única:** una por pedido, derivada del número de pedido. Un pedido nunca tiene dos intentos de pago activos.
2. **Montos:** Wompi trabaja en centavos. Convierte solo en el borde: `total_cop` (pesos) → centavos. Calcula el monto en el servidor.
3. **Firma de integridad** del checkout: se genera en el servidor con el secreto de integridad (verificar fórmula en la documentación).
4. **Webhook de eventos:** ruta `POST` pública. Pasos: (a) verifica la firma del evento con el secreto de eventos y rechaza si no coincide; (b) guarda el evento crudo en una tabla con restricción `UNIQUE` por id de evento/transacción; (c) responde `200` rápido; (d) procesa en cola.
5. **Estados:** maneja aprobado, rechazado, anulado, error y **pendiente** (PSE puede tardar). Pendiente mantiene el pedido en `awaiting_payment` y la reserva de stock hasta su vencimiento.
6. **Fuente de verdad:** el webhook, no la redirección del navegador. La página de retorno solo consulta el estado del pedido.
7. **Al aprobar:** marca el pedido `paid`, confirma el descuento de stock reservado y encola la factura (`factus-invoice`). Todo en una operación idempotente.
8. **Conciliación:** un job periódico consulta a Wompi las transacciones pendientes con más de N minutos y las resuelve.
9. **Entornos:** llaves de sandbox y producción separadas; nunca se mezclan ni se imprimen en logs.
10. Pruebas: evento duplicado, evento fuera de orden, firma inválida, pago pendiente que luego se aprueba y que luego vence.

El código de verificación de firma está en la lista de "prohibido tocar sin revisión" de `agents.md`.
