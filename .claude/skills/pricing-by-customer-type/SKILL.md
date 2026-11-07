---
name: pricing-by-customer-type
description: Mostrar o calcular precios, cajas, mínimos y visibilidad de catálogo según cliente mayorista o minorista.
---

# pricing-by-customer-type

Reglas del negocio (ver `docs/memoria.md`, D-002 a D-004):

- `wholesale`: ve productos nacionales **e importados**; compra **por caja**; mínimos en cajas.
- `retail`: ve **solo nacionales**; compra por unidad **si el producto tiene activada** `allow_retail_by_unit`.

Implementación:

1. Un solo catálogo (`products`) con `origin` (`national`/`imported`), `units_per_box`, `allow_retail_by_unit`.
2. Listas de precios: `price_lists` y `product_prices` (por lista, con escalas por cantidad si aplica). Cada cliente tiene su tipo y su lista asignada.
3. **Visibilidad por RLS:** los importados no son legibles para `retail`. No filtres solo en el frontend.
4. **El precio se calcula en el servidor** (función SQL o caso de uso) a partir del carrito y del cliente. El navegador solo lo muestra.
5. Validaciones en servidor: mínimo de cajas para mayoristas, unidad permitida para minoristas, stock disponible, producto vigente.
6. Mayorista nuevo: queda en estado pendiente hasta aprobación manual (RUT / cámara de comercio). Mientras tanto no ve precios mayoristas.
7. Envío: el cálculo de cargo vive en `delivery` (ver `delivery-proof`); aquí solo se consulta la regla "20 o más cajas = envío gratis".
8. Pruebas: mismo producto con dos tipos de cliente, importado invisible para minorista, mínimo no cumplido, intento de manipular el precio desde el cliente.

Pendiente de confirmar: si el minorista puede comprar cajas (P-004).
