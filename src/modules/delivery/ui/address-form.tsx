"use client";

import { useActionState, useState } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";

import type { DeliveryZone } from "../server/addresses";
import { type AddressFormState, saveAddressAction } from "../server/address-actions";
import { AddressMap, type LatLng } from "./address-map";

// New delivery address: written address, municipality from the list and the
// point marked on the map (P-010, D-045). The server validates everything.

type Props = { zones: DeliveryZone[]; center: LatLng };

export function AddressForm({ zones, center }: Props) {
  const [state, formAction] = useActionState<AddressFormState, FormData>(saveAddressAction, { status: "idle" });
  const [point, setPoint] = useState<LatLng | null>(null);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        Nombre de la dirección
        <input name="label" required maxLength={60} placeholder="Casa, oficina…" className="rounded-md border border-neutral-400 px-3 py-2" />
        {errors.label ? <span className="text-sm text-red-700">{errors.label}</span> : null}
      </label>

      <label className="flex flex-col gap-1">
        Municipio
        <select name="zoneId" required defaultValue="" className="rounded-md border border-neutral-400 px-3 py-2">
          <option value="" disabled>
            Elige el municipio
          </option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.municipality}
            </option>
          ))}
        </select>
        {errors.zoneId ? <span className="text-sm text-red-700">{errors.zoneId}</span> : null}
      </label>

      <label className="flex flex-col gap-1">
        Dirección
        <input
          name="addressLine"
          required
          minLength={5}
          maxLength={200}
          placeholder="Cra 43A # 1-50"
          className="rounded-md border border-neutral-400 px-3 py-2"
        />
        {errors.addressLine ? <span className="text-sm text-red-700">{errors.addressLine}</span> : null}
      </label>

      <label className="flex flex-col gap-1">
        Detalles (opcional)
        <input name="details" maxLength={200} placeholder="Apartamento, torre, punto de referencia" className="rounded-md border border-neutral-400 px-3 py-2" />
        {errors.details ? <span className="text-sm text-red-700">{errors.details}</span> : null}
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend>Punto de entrega en el mapa</legend>
        <AddressMap center={center} value={point} onChange={setPoint} />
        <input type="hidden" name="lat" value={point?.lat ?? ""} />
        <input type="hidden" name="lng" value={point?.lng ?? ""} />
        {errors.lat ? <span className="text-sm text-red-700">{errors.lat}</span> : null}
      </fieldset>

      <FormSubmitButton pendingLabel="Guardando…">Guardar dirección</FormSubmitButton>
      {state.message ? (
        <p role="status" className={state.status === "error" ? "text-red-700" : ""}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
