import Link from "next/link";

import { formatCop } from "@/modules/pricing";

import { DELIVERY_QUOTE_ERROR_MESSAGES, formatDistance } from "../domain/delivery";
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

const OPTION = "block rounded-md border px-3 py-2";

export function FulfillmentPicker({ choice }: { choice: FulfillmentChoice }) {
  const pickup = choice.fulfillment === "pickup";

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-medium">Entrega</legend>
      <Link
        href="/cart"
        replace
        scroll={false}
        aria-current={pickup ? "true" : undefined}
        className={`${OPTION} ${pickup ? "border-neutral-900 font-medium" : "border-neutral-300"}`}
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
            className={`${OPTION} ${selected ? "border-neutral-900" : "border-neutral-300"}`}
          >
            <span className={selected ? "font-medium" : ""}>
              {selected ? "✓ " : ""}Domicilio a {address.label}
            </span>
            <span className="block text-sm text-neutral-600">
              {address.addressLine}, {address.municipality}
              {address.zoneActive ? "" : " (sin domicilio por ahora)"}
            </span>
            {selected && choice.quote ? (
              <span className={`block text-sm ${choice.quote.ok ? "" : "text-red-700"}`}>
                {choice.quote.ok
                  ? `Domicilio: ${choice.quote.feeCop === 0 ? "gratis" : formatCop(choice.quote.feeCop)} (${formatDistance(choice.quote.distanceM)} desde la tienda)`
                  : DELIVERY_QUOTE_ERROR_MESSAGES[choice.quote.error]}
              </span>
            ) : null}
          </Link>
        );
      })}

      <Link href="/addresses?volver=carrito" className="text-sm underline">
        {choice.addresses.length === 0 ? "Agregar una dirección para domicilio" : "Agregar otra dirección"}
      </Link>
      <p className="text-xs text-neutral-500">
        Domicilios solo en el Valle de Aburrá. Al recibir, quien reciba debe mostrar su cédula y firmar.
      </p>
    </fieldset>
  );
}
