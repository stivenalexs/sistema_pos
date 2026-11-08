import Image from "next/image";

import { AddToCartForm } from "@/modules/cart";
import { type CatalogItem, minimumLabel, priceLabel } from "@/modules/pricing";

// Catalog grid (D-046). Prices arrive already computed by the server for the
// current customer; this component only displays them.
// canBuy: only signed-in customers can add to the cart (D-032).
export function ProductList({ items, canBuy = false }: { items: CatalogItem[]; canBuy?: boolean }) {
  if (items.length === 0) {
    return <p className="notice notice-info">No hay productos disponibles en este momento.</p>;
  }

  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const minimum = minimumLabel(item);
        const details = [item.brand, item.volumeMl ? `${item.volumeMl} ml` : null].filter(Boolean);

        return (
          <li key={item.productId} className="card flex flex-col overflow-hidden">
            <ProductImage item={item} />
            <div className="flex flex-1 flex-col gap-3 p-5">
              <div className="flex flex-wrap gap-2">
                {item.origin === "imported" ? <span className="badge">Importado</span> : null}
                {item.saleUnit === "box" ? (
                  <span className="badge">Caja de {item.unitsPerBox}</span>
                ) : null}
              </div>
              <h2 className="font-display text-[26px] leading-tight">{item.name}</h2>
              {details.length > 0 ? (
                <p className="text-xs tracking-wide text-muted">{details.join(" · ")}</p>
              ) : null}
              <p className="mt-auto pt-2 text-lg font-semibold text-gold tabular-nums">
                {priceLabel(item)}
              </p>
              {minimum ? <p className="text-xs text-muted">{minimum}</p> : null}
              {canBuy ? (
                <div className="border-t border-line pt-4">
                  <AddToCartForm
                    productId={item.productId}
                    minQuantity={item.minQuantity}
                    unitLabel={item.saleUnit === "box" ? "cajas" : "unidades"}
                  />
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Product photo, or the brand glass on a dark panel when there is none.
function ProductImage({ item }: { item: CatalogItem }) {
  return (
    <div className="relative flex aspect-[4/3] items-center justify-center border-b border-line bg-[radial-gradient(ellipse_at_center,#2a2018_0%,#16110d_70%)]">
      {item.imageUrl ? (
        <Image
          src={item.imageUrl}
          alt={item.name}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-contain p-4"
        />
      ) : (
        <Image src="/brand/wine.svg" alt="" width={46} height={54} className="opacity-60" />
      )}
    </div>
  );
}
