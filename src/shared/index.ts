// Shared building blocks: ActionButton, utilities and clients (supabase, wompi, factus).
//
// Server-only pieces are NOT re-exported here, so that importing this file
// from a Client Component never pulls secrets into the browser bundle.
// Import them by path instead:
//   @/shared/supabase/server   (user session, RLS applies; default choice)
//   @/shared/supabase/admin    (secret key, bypasses RLS; workers/webhooks only)
//   @/shared/supabase/browser  (Client Components)
export {};
