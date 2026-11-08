// Public API of the delivery module. Other modules import only from here (agents.md, section 3).
// Server-only code and Client Components are both exported: import this
// index only from Server Components and server code (D-036).
export * from "./domain/delivery";
export {
  type DeliveryAddress,
  type DeliveryQuote,
  type DeliveryZone,
  getDeliveryAddresses,
  getDeliveryZones,
  MAP_DEFAULT_CENTER,
  quoteDelivery,
} from "./server/addresses";
export {
  acceptDeliveryAttempt,
  type CourierDelivery,
  getCourierDelivery,
  getDeliveryStaff,
  listCourierDeliveries,
  processDeliveryAttempt,
} from "./server/courier";
export {
  type AdminCourier,
  type AdminDelivery,
  assignDeliveryAction,
  createProviderAction,
  type DeliveryProvider,
  getDeliveryOptions,
  listDeliveriesForAdmin,
  setProviderActiveAction,
} from "./server/admin-deliveries";
export {
  type AdminZone,
  type ConfigChange,
  type ConfigOverview,
  type FeeRule,
  getConfigOverview,
  saveFeeRuleAction,
  saveStoreSettingsAction,
  setFeeRuleActiveAction,
  setZoneActiveAction,
} from "./server/admin-config";
export { AddressForm } from "./ui/address-form";
export { StoreSettingsForm } from "./ui/store-settings-form";
export { DeleteAddressForm } from "./ui/delete-address-form";
export { DeliveryAttemptForm } from "./ui/delivery-attempt-form";
export { type FulfillmentChoice, FulfillmentPicker } from "./ui/fulfillment-picker";
