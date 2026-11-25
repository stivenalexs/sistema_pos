import Link from "next/link";

import { formatCop } from "@/modules/pricing";

import { DELIVERY_QUOTE_ERROR_MESSAGES, formatDistance } from "../domain/address";
import type { DeliveryAddress, DeliveryQuote } from "../server/addresses";

// Pickup or delivery for the cart (D-039, D-045). Plain links (navigation,
// not actions): the chosen option travels in the URL and the server
// computes the fee again when the order is placed.

export type FulfillmentChoice = {
  fulfillment: "pickup" | "delivery";
  addresses: DeliveryAddress[];
  selectedAddressId: string | null;
  quote: DeliveryQuote | null;
};

export function FulfillmentPicker({ choice }: { choice: FulfillmentChoice }) {
  const pickup = choice.fulfillment === "pickup";

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 font-display text-3xl">Entrega</legend>
      <Link
        href="/cart"
        replace
        scroll={false}
        aria-current={pickup ? "true" : undefined}
        className={`option ${pickup ? "font-medium" : "hover:border-gold/60"}`}
      >
        {pickup ? "✓ " : ""}Recoger en la tienda (sin costo)
      </Link>

      {choice.addresses.map((address) => {
        const selected = !pickup && choice.selectedAddressId === address.id;
        return (
          <Link
            key={address.id}
            href={`/cart?entrega=domicilio&direccion=${address.id}`}
            replace
            scroll={false}
            aria-current={selected ? "true" : undefined}
            className={`option ${selected ? "" : "hover:border-gold/60"}`}
          >
            <span className={selected ? "font-medium" : ""}>
              {selected ? "✓ " : ""}Domicilio a {address.label}
            </span>
            <span className="block text-sm text-muted">
              {address.addressLine}, {address.municipality}
              {address.zoneActive ? "" : " (sin domicilio por ahora)"}
            </span>
            {selected && choice.quote ? (
              <span className={`mt-1 block text-sm ${choice.quote.ok ? "text-gold" : "text-danger"}`}>
                {choice.quote.ok
                  ? `Domicilio: ${choice.quote.feeCop === 0 ? "gratis" : formatCop(choice.quote.feeCop)} (${formatDistance(choice.quote.distanceM)} desde la tienda)`
                  : DELIVERY_QUOTE_ERROR_MESSAGES[choice.quote.error]}
              </span>
            ) : null}
          </Link>
        );
      })}

      <Link href="/addresses?volver=carrito" className="link text-sm">
        {choice.addresses.length === 0 ? "Agregar una dirección para domicilio" : "Agregar otra dirección"}
      </Link>
      <p className="text-xs leading-relaxed text-muted">
        Domicilios solo en el Valle de Aburrá. Al recibir, quien reciba debe mostrar su cédula y firmar.
      </p>
    </fieldset>
  );
}
