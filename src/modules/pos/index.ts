// Public API of the pos module. Other modules import only from here (agents.md, section 3).
// Exports server code too: import this index only from Server Components and
// server code (D-036). Client Components use ./client (D-077).
export * from "./client";
export {
  createPosSale,
  findPosCustomer,
  getPosCatalog,
  getPosReceipt,
  getPosStaff,
  parsePosSaleInput,
  type PosCatalog,
  type PosCustomer,
  type PosReceipt,
  type PosSaleInput,
  type PosSaleResult,
  type PosStaff,
} from "./server/pos";
export { type AdminPosSale, listPosSalesForAdmin, voidPosSaleAction } from "./server/admin-sales";
