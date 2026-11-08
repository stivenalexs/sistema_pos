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
    <form action={formAction} className="flex flex-col gap-5">
      <label className="field-label">
        Nombre de la dirección
        <input name="label" required maxLength={60} placeholder="Casa, oficina…" className="field" />
        {errors.label ? <span className="field-error">{errors.label}</span> : null}
      </label>

      <label className="field-label">
        Municipio
        <select name="zoneId" required defaultValue="" className="field">
          <option value="" disabled>
            Elige el municipio
          </option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.municipality}
            </option>
          ))}
        </select>
        {errors.zoneId ? <span className="field-error">{errors.zoneId}</span> : null}
      </label>

      <label className="field-label">
        Dirección
        <input
          name="addressLine"
          required
          minLength={5}
          maxLength={200}
          placeholder="Cra 43A # 1-50"
          className="field"
        />
        {errors.addressLine ? <span className="field-error">{errors.addressLine}</span> : null}
      </label>

      <label className="field-label">
        Detalles (opcional)
        <input name="details" maxLength={200} placeholder="Apartamento, torre, punto de referencia" className="field" />
        {errors.details ? <span className="field-error">{errors.details}</span> : null}
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-medium">Punto de entrega en el mapa</legend>
        <AddressMap center={center} value={point} onChange={setPoint} />
        <input type="hidden" name="lat" value={point?.lat ?? ""} />
        <input type="hidden" name="lng" value={point?.lng ?? ""} />
        {errors.lat ? <span className="field-error">{errors.lat}</span> : null}
      </fieldset>

      <FormSubmitButton pendingLabel="Guardando…" className="w-full">Guardar dirección</FormSubmitButton>
      {state.message ? (
        <p role="status" className={`notice ${state.status === "error" ? "notice-danger" : "notice-success"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
