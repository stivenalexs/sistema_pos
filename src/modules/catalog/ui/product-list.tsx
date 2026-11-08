import Image from "next/image";

import { AddToCartForm } from "@/modules/cart";
import { type CatalogItem, minimumLabel, priceLabel } from "@/modules/pricing";

import barrel from "./assets/barril.jpg";
import { ShelfCarousel } from "./shelf-carousel";

// Catalog "inside the barrel" (Figma "Nuestra cava · Catálogo", D-048): the
// bottles stand on a lit shelf inside an open barrel and the shelf slides one
// bottle at a time. Prices arrive already computed by the server for the
// current customer; this component only displays them.
// canBuy: only signed-in customers can add to the cart (D-032).
export function ProductList({ items, canBuy = false }: { items: CatalogItem[]; canBuy?: boolean }) {
  if (items.length === 0) {
    return <p className="notice notice-info">No hay productos disponibles en este momento.</p>;
  }

  return (
    <div className="relative isolate overflow-hidden rounded-[4px]">
      <Image
        src={barrel}
        alt=""
        fill
        sizes="(min-width: 1152px) 1104px, 100vw"
        placeholder="blur"
        className="-z-20 object-cover object-center"
      />
      <div className="relative mx-auto w-full max-w-[816px] px-12 pt-16 pb-14 lg:min-h-[718px] lg:px-0 lg:pt-[103px]">
        {/* Shelf: surface and front, colors from the design. */}
        <div aria-hidden className="absolute inset-x-0 top-[calc(4rem+316px)] -z-10 lg:top-[419px]">
          <div className="h-[13px] rounded-[2px] bg-[linear-gradient(180deg,#a77543_0%,#7d512e_22%,#422919_100%)]" />
          <div className="h-[17px] bg-[linear-gradient(180deg,#825533_0%,#352116_100%)] shadow-[0_10px_15px_rgba(0,0,0,0.6)]" />
          <div className="mx-3 h-[205px] bg-[linear-gradient(180deg,rgba(19,14,9,0.9)_0%,rgba(19,14,9,0.78)_72%,rgba(19,14,9,0)_100%)]" />
        </div>
        <ShelfCarousel label="Botellas de nuestra cava">
          {items.map((item, index) => (
            <ProductOnShelf key={item.productId} item={item} canBuy={canBuy} first={index === 0} />
          ))}
        </ShelfCarousel>
      </div>
    </div>
  );
}

function ProductOnShelf({ item, canBuy, first }: { item: CatalogItem; canBuy: boolean; first: boolean }) {
  const minimum = minimumLabel(item);
  const details = [item.brand, item.volumeMl ? `${item.volumeMl} ml` : null].filter(Boolean);

  return (
    <article className="flex w-full flex-col">
      <div className="relative flex h-[344px] items-end justify-center">
        <span
          aria-hidden
          className="absolute top-[308px] left-1/2 h-3 w-[132px] -translate-x-1/2 rounded-full bg-black/50 blur-[4px]"
        />
        <div className="relative mb-1.5 h-[284px] w-[160px]">
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt={item.name}
              fill
              sizes="160px"
              className="object-contain object-bottom"
            />
          ) : (
            <Image
              src="/brand/wine.svg"
              alt=""
              width={46}
              height={54}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 opacity-70"
            />
          )}
        </div>
      </div>
      <div
        className={`flex flex-1 flex-col gap-3 px-1 pt-3 ${first ? "" : "lg:border-l lg:border-gold/20 lg:pl-5"}`}
      >
        <h2 className="min-h-[56px] font-display text-[26px] leading-[1.08]">{item.name}</h2>
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
      </div>
    </article>
  );
}
