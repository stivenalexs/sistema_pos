---
name: inventory-adjustment
description: Ajustes de inventario, conteos cíclicos, mermas, entradas de mercancía y reservas con vencimiento.
---

# inventory-adjustment

Regla de oro: el stock **solo** cambia insertando filas en `inventory_movements` (solo inserción; no se edita ni se borra). El stock actual se deriva de esos movimientos.

1. **Tipos de movimiento:** `purchase_in`, `web_sale`, `pos_sale`, `adjustment`, `waste`, `return_in`, `reservation`, `reservation_release`.
2. **Unidad base:** el stock se lleva en unidades; las cajas son `units_per_box` unidades.
3. **Entrada de mercancía:** movimiento `purchase_in` con referencia (factura de compra o remisión).
4. **Conteo cíclico:** se compara el conteo físico con el stock calculado; la diferencia se registra como `adjustment` con motivo obligatorio y usuario responsable.
5. **Mermas y roturas:** `waste` con motivo.
6. **Reservas web:** al iniciar un pago pendiente se reserva con vencimiento (propuesta: 30 min, P-003). Un job libera las reservas vencidas con `reservation_release`.
7. **Stock de seguridad:** la web muestra disponibilidad menos un colchón configurable por producto. El POS ve la cantidad real.
8. **Atomicidad:** toda salida es condicional ("descuenta solo si hay"). Nunca leer, calcular en la app y escribir.
9. **Auditoría:** cualquier ajuste manual exige rol de administración y queda con usuario, fecha y motivo.
10. Alertas: bajo mínimo por producto, diferencias grandes en conteo.
11. Pruebas: reserva que vence, ajuste negativo con stock insuficiente, dos salidas simultáneas.
