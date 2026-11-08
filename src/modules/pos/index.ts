// Public API of the pos module. Other modules import only from here (agents.md, section 3).
// Exports server code too: import this index only from Server Components and
// server code (D-036).
export * from "./domain/pos";
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
export { PosTerminal } from "./ui/pos-terminal";
