---
name: factus-invoice
description: Emitir facturas electrónicas, notas crédito y manejar rechazos de la DIAN vía Factus. Úsala en todo lo relacionado con facturación.
---

# factus-invoice

Consulta la documentación oficial de Factus y trabaja primero contra su **sandbox**. No inventes campos ni códigos de catálogo.

1. **Cuándo:** solo con pedido `paid` (webhook de Wompi aprobado) o con venta POS cerrada. Siempre desde un worker, nunca en la petición del cliente.
2. **Idempotencia:** envía a Factus un código de referencia único derivado del número de pedido. Antes de crear, consulta si ya existe para no duplicar.
3. **Autenticación:** OAuth2 con renovación de token. Guarda y renueva el token en servidor; reintenta una vez ante 401.
4. **Datos del cliente:** mayorista exige NIT y datos fiscales completos; minorista puede usar documento y datos mínimos según la norma. Valida antes de enviar.
5. **Catálogos:** los ids de método de pago, tributos, municipio, tipo de documento y unidad salen de los catálogos de Factus (sandbox y producción pueden diferir). Guárdalos en tablas de configuración, no en el código.
6. **Impuestos por producto:** cada producto trae su tratamiento tributario (nacional/importado). Confírmalo con el contador antes de producción.
7. **Resultado:** guarda número de factura, CUFE, estado, enlaces de PDF/XML. Estado de factura en columna propia: `pending`, `sent`, `accepted`, `rejected`.
8. **Rechazos:** si la DIAN rechaza, guarda el motivo, no reintentes a ciegas; reintenta solo errores transitorios con backoff. Los errores de datos van a una bandeja para administración.
9. **Reembolsos:** generan **nota crédito** asociada a la factura original, no se borra la factura.
10. **Entornos:** credenciales y rangos de numeración separados para sandbox y producción.
11. Pruebas: doble ejecución del worker, token vencido, rechazo por rango de numeración, nota crédito.
