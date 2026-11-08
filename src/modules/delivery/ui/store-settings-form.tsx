"use client";

import { useActionState, useState } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";
import type { IdempotentFormState } from "@/shared/ui/idempotent-form-state";

import { AddressMap, type LatLng } from "./address-map";

// Store location (map pin), municipality and maximum delivery distance
// (D-058). The server action comes from the page; the database validates.
// No animation (agents.md §8).

type Props = {
  action: (previous: IdempotentFormState, formData: FormData) => Promise<IdempotentFormState>;
  initial: { lat: number | null; lng: number | null; zoneId: string | null; maxDistanceM: number };
  zones: { id: string; municipality: string }[];
  center: LatLng;
};

export function StoreSettingsForm({ action, initial, zones, center }: Props) {
  const [state, formAction] = useActionState<IdempotentFormState, FormData>(action, { status: "idle" });
  const [point, setPoint] = useState<LatLng | null>(
    initial.lat !== null && initial.lng !== null ? { lat: initial.lat, lng: initial.lng } : null,
  );
  const sent = state.status === "error" ? state.values : undefined;

  return (
    <form key={state.answer ?? 0} action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="field-label text-xs">Ubicación de la tienda (toca el mapa para moverla)</span>
        <AddressMap center={point ?? center} value={point} onChange={setPoint} />
        <input type="hidden" name="lat" value={point?.lat ?? ""} />
        <input type="hidden" name="lng" value={point?.lng ?? ""} />
        <span className="text-xs text-muted">
          {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "Sin ubicación"}. Las distancias de domicilio se
          miden en línea recta desde aquí.
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="field-label min-w-48 grow">
          <span className="text-xs">Municipio de la tienda (recoger en tienda, POS y bloqueos)</span>
          <select name="zoneId" required defaultValue={sent?.zoneId ?? initial.zoneId ?? ""} className="field py-1.5 text-sm">
            <option value="" disabled>
              Elige…
            </option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.municipality}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label min-w-40">
          <span className="text-xs">Radio máximo de domicilio (km)</span>
          <input
            name="maxDistanceKm"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={50}
            step={1}
            defaultValue={sent?.maxDistanceKm ?? String(Math.round(initial.maxDistanceM / 1000))}
            className="field py-1.5 text-sm tabular-nums"
          />
        </label>
        <FormSubmitButton pendingLabel="Guardando…" className="btn-sm">
          Guardar datos de la tienda
        </FormSubmitButton>
      </div>
      {state.message ? (
        <p role="status" className={`text-sm ${state.status === "error" ? "field-error" : "text-success"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
