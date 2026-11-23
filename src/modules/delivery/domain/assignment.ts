// Assignment from the admin panel (D-057), without I/O.

/**
 * One value per option of the assignment select, so a courier never goes
 * with another provider: "own:<provider>:<courier>" or "third:<provider>".
 */
export function encodeAssignment(providerId: string, courierId: string | null): string {
  return courierId ? `own:${providerId}:${courierId}` : `third:${providerId}`;
}

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const OWN_ASSIGNMENT = new RegExp(`^own:(${UUID_PART}):(${UUID_PART})$`, "i");
const THIRD_ASSIGNMENT = new RegExp(`^third:(${UUID_PART})$`, "i");

export function parseAssignment(value: unknown): { providerId: string; courierId: string | null } | null {
  if (typeof value !== "string") return null;
  const own = OWN_ASSIGNMENT.exec(value);
  if (own) return { providerId: own[1]!, courierId: own[2]! };
  const third = THIRD_ASSIGNMENT.exec(value);
  return third ? { providerId: third[1]!, courierId: null } : null;
}

export const ASSIGNMENT_ERROR_MESSAGES: Record<string, string> = {
  delivery_forbidden: "Solo un administrador puede asignar domicilios.",
  delivery_order_not_assignable:
    "Ese pedido ya no se puede asignar (no está pagado, ya se entregó o está marcado para reembolso).",
  delivery_unknown_provider: "Ese proveedor no existe o está inactivo.",
  delivery_invalid_courier: "Ese mensajero no está activo o no pertenece al proveedor.",
};
