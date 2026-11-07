import { AddToCartForm } from "@/modules/cart";
import { type CatalogItem, minimumLabel, priceLabel } from "@/modules/pricing";

// Catalog list. Prices arrive already computed by the server for the current
// customer; this component only displays them.
// canBuy: only signed-in customers can add to the cart (D-032).
export function ProductList({ items, canBuy = false }: { items: CatalogItem[]; canBuy?: boolean }) {
  if (items.length === 0) {
    return <p>No hay productos disponibles en este momento.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-neutral-200 border-y border-neutral-200">
      {items.map((item) => {
        const minimum = minimumLabel(item);
        const details = [
          item.brand,
          item.volumeMl ? `${item.volumeMl} ml` : null,
          item.origin === "imported" ? "Importado" : null,
        ].filter(Boolean);

        return (
          <li key={item.productId} className="flex flex-col gap-1 py-4">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-medium">{item.name}</h2>
              <p className="whitespace-nowrap font-semibold">{priceLabel(item)}</p>
            </div>
            {details.length > 0 ? (
              <p className="text-sm text-neutral-600">{details.join(" · ")}</p>
            ) : null}
            {minimum ? <p className="text-sm text-neutral-700">{minimum}</p> : null}
            {canBuy ? (
              <AddToCartForm
                productId={item.productId}
                minQuantity={item.minQuantity}
                unitLabel={item.saleUnit === "box" ? "cajas" : "unidades"}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
