// Public API of the inventory module. Other modules import only from here (agents.md, section 3).
// Exports server code too: import this index only from Server Components and
// server code (D-036).
export * from "./domain/inventory";
export {
  getInventoryAlerts,
  getInventoryOverview,
  getRecentMovements,
  type InventoryAlerts,
  type MovementRow,
  type StockRow,
} from "./server/inventory";
export {
  recordCountAction,
  recordEntryAction,
  recordWasteAction,
  setStockSettingsAction,
} from "./server/inventory-actions";
