---
name: delivery-proof
description: Cargos de domicilio, asignación a mensajero propio o tercero, y prueba de entrega con cédula y firma.
---

# delivery-proof

Reglas (ver `docs/memoria.md`, D-005 a D-007):

- Tarifa solo en el **área metropolitana**: $6.000 si la distancia es menor o igual a 1 km, $15.000 si es mayor.
- Mayoristas con **20 o más cajas**: sin cargo de envío; lo asume la tienda.
- Mensajeros **propios y terceros**.
- Al recibir, **ambos perfiles** muestran y firman con su número de cédula.

Implementación:

1. **Tarifas en tabla** `delivery_fee_rules` (distancia máxima, valor, tipo de cliente, mínimo de cajas para envío gratis). Nada de valores fijos en el código.
2. **Distancia:** desde el punto de despacho a la dirección, con PostGIS en línea recta (propuesta P-001, por confirmar). Fuera del área metropolitana: no se ofrece domicilio con esta tarifa hasta definirlo.
3. **Proveedores:** tabla `delivery_providers` (`own`, `third_party`). Un pedido se asigna a uno; la integración por API con terceros queda pendiente (P-008).
4. **Prueba de entrega** (`delivery_proofs`): `order_id`, nombre, número de cédula declarado, firma (imagen), hora, mensajero, coordenadas opcionales. Datos mínimos y acceso restringido por RLS.
5. **Vista móvil sencilla** para el mensajero: ver pedido, capturar cédula y firma, confirmar. No se marca `delivered` sin esa prueba.
6. **Edad:** el mensajero confirma que la persona que recibe es mayor de edad; si no puede acreditarlo, se registra el intento y no se entrega.
7. **Acción asíncrona:** confirmar entrega usa `async-action` y `ActionButton`.
8. Pruebas: tarifa en el borde de 1 km, pedido de 20 cajas mayorista, entrega sin firma, reintento de confirmación.
