// Browser-safe API of the customers module (D-077): pure rules and Client
// Components, nothing that runs only on the server. Client Components of
// other modules import from "@/modules/customers/client"; server code can keep
// using "@/modules/customers", which re-exports this file.
export { type SignupInput, validateSignup } from "./domain/signup";
export * from "./domain/staff";
export {
  DeactivateStaffForm,
  InviteStaffForm,
  RevokeInvitationForm,
  SetPasswordForm,
  WholesaleReviewForm,
} from "./ui/admin-forms";
export { LoginForm } from "./ui/login-form";
export { SignupForm } from "./ui/signup-form";
