import Image from "next/image";

import { AddToCartForm } from "@/modules/cart";
import { type CatalogItem, minimumLabel, priceLabel } from "@/modules/pricing";

import barrel from "./assets/barril.jpg";
import { ShelfCarousel } from "./shelf-carousel";

// Catalog "inside the barrel" (Figma "Nuestra cava · Catálogo", D-048, D-049).
// The barrel photo at the back (edges faded into the page) and the bottles
// centered in its cavity (D-049, D-050). No shelf. The cards go below.
// Prices arrive already computed by the server for the current customer;
// this component only displays them.
// canBuy: only signed-in customers can add to the cart (D-032).
export function ProductList({ items, canBuy = false }: { items: CatalogItem[]; canBuy?: boolean }) {
  if (items.length === 0) {
    return <p className="notice notice-info">No hay productos disponibles en este momento.</p>;
  }

  const photo = (
    <Image
      src={barrel}
      alt=""
      fill
      sizes="(min-width: 1024px) 1440px, (min-width: 640px) 160vw, 210vw"
      placeholder="blur"
      className="object-cover"
    />
  );

  return (
    <ShelfCarousel
      label="Botellas de nuestra cava"
      backdrop={photo}
      bottles={items.map((item) => (
        <Bottle key={item.productId} item={item} />
      ))}
      cards={items.map((item) => (
        <ProductCard key={item.productId} item={item} canBuy={canBuy} />
      ))}
    />
  );
}

// Bottle centered in the middle of the barrel cavity (D-050).
function Bottle({ item }: { item: CatalogItem }) {
  return (
    <div className="relative flex h-[74%] w-[88%] items-end justify-center sm:h-[70%] lg:h-[70%]">
      {item.imageUrl ? (
        <Image
          src={item.imageUrl}
          alt={item.name}
          fill
          sizes="(min-width: 1024px) 140px, 180px"
          className="object-contain object-bottom"
        />
      ) : (
        <Image src="/brand/wine.svg" alt="" width={46} height={54} className="relative mb-[10%] opacity-70" />
      )}
    </div>
  );
}

function ProductCard({ item, canBuy }: { item: CatalogItem; canBuy: boolean }) {
  const minimum = minimumLabel(item);
  const details = [item.brand, item.volumeMl ? `${item.volumeMl} ml` : null].filter(Boolean);

  return (
    <article className="flex w-full flex-col gap-3 pt-3 pb-2">
      <h2 className="min-h-[52px] font-display text-[24px] leading-[1.08]">{item.name}</h2>
      <div className="flex flex-wrap items-center gap-2">
        {details.length > 0 ? <p className="text-xs text-muted">{details.join(" · ")}</p> : null}
        {item.origin === "imported" ? <span className="badge">Importado</span> : null}
        {item.saleUnit === "box" ? <span className="badge">Caja de {item.unitsPerBox}</span> : null}
      </div>
      <p className="text-lg font-semibold text-gold tabular-nums">{priceLabel(item)}</p>
      {minimum ? <p className="text-[11px] text-muted">{minimum}</p> : null}
      {canBuy ? (
        <div className="mt-auto pt-2">
          <AddToCartForm
            productId={item.productId}
            minQuantity={item.minQuantity}
            unitLabel={item.saleUnit === "box" ? "cajas" : "unidades"}
          />
        </div>
      ) : null}
    </article>
  );
}
