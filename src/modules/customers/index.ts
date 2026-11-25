// Public API of the customers module. Other modules import only from here (agents.md, section 3).
// Exports server code too: import this index only from Server Components and
// server code (D-036). Client Components use ./client (D-077).
export * from "./client";
export {
  type AuthFormState,
  signInAction,
  signOutAction,
  signUpAction,
} from "./server/auth-actions";
export { type CurrentCustomer, getCurrentCustomer } from "./server/current-customer";
export {
  type AdminSummary,
  getAdminSummary,
  getStaffRole,
  listStaff,
  listWholesale,
  type StaffInvitation,
  type StaffMember,
  type WholesaleApplicant,
} from "./server/admin";
