// Store settings and fee rules from the admin panel (D-058), without I/O.

export const STORE_SETTINGS_ERROR_MESSAGES: Record<string, string> = {
  admin_forbidden: "Solo un administrador puede cambiar los datos de la tienda.",
  location_outside_valley:
    "El punto marcado está fuera del Valle de Aburrá, donde se hacen los domicilios. Márcalo donde está la tienda.",
  unknown_zone: "Elige el municipio de la tienda.",
  invalid_max_distance: "El radio máximo de domicilio debe estar entre 1 y 50 km.",
};

export type FeeRuleInput = {
  name: string;
  customerType: "retail" | "wholesale" | null;
  minBoxes: number | null;
  maxDistanceM: number | null;
  feeCop: number;
};

function optionalWhole(value: string, min: number, max: number): number | null | undefined {
  if (value === "") return null;
  if (!/^\d{1,7}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= min && n <= max ? n : undefined;
}

/** Fee rule typed by the administrator. Empty optional fields mean "any". */
export function parseFeeRuleInput(raw: {
  name: string;
  customerType: string;
  minBoxes: string;
  maxDistanceM: string;
  feeCop: string;
}): { ok: true; value: FeeRuleInput } | { ok: false; message: string } {
  const name = raw.name.trim();
  if (name.length < 3 || name.length > 80) return { ok: false, message: "Escribe un nombre entre 3 y 80 caracteres." };
  if (!["any", "retail", "wholesale"].includes(raw.customerType)) {
    return { ok: false, message: "Elige a qué clientes aplica." };
  }
  const minBoxes = optionalWhole(raw.minBoxes.trim(), 1, 10_000);
  if (minBoxes === undefined) return { ok: false, message: "Las cajas mínimas deben ser un número entero desde 1." };
  // A retail purchase is always by unit (D-024): such a rule would never apply.
  if (raw.customerType === "retail" && minBoxes !== null) {
    return { ok: false, message: "Los minoristas compran por unidad: deja vacías las cajas mínimas." };
  }
  const maxDistanceM = optionalWhole(raw.maxDistanceM.trim(), 1, 50_000);
  if (maxDistanceM === undefined) {
    return { ok: false, message: "La distancia máxima debe estar entre 1 y 50.000 metros." };
  }
  const feeCop = optionalWhole(raw.feeCop.trim(), 0, 1_000_000);
  if (feeCop === undefined || feeCop === null) {
    return { ok: false, message: "El valor debe estar entre $ 0 y $ 1.000.000." };
  }
  return {
    ok: true,
    value: {
      name,
      customerType: raw.customerType === "any" ? null : (raw.customerType as "retail" | "wholesale"),
      minBoxes,
      maxDistanceM,
      feeCop,
    },
  };
}
