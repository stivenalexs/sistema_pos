"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/shared/supabase/browser";
import { FormSubmitButton } from "@/shared/ui/form-submit-button";

// Sign-in links or sign-out button, depending on the session. Read in the
// browser: reading cookies on the server inside the root layout breaks pages
// whose Server Action returns an error (Next.js 16.4.5 invariant, D-035).
// This is display only; every permission check happens on the server.
// The sign-out Server Action comes from the layout: a Client Component must
// not import the customers module index, which also exports server-only code.
//
// Sign-in and sign-out run on the server, so the browser client gets no
// auth event. The session is read again on every page change (both actions
// end with a redirect) and cleared when sign-out finishes, so only this bar
// updates, without reloading the page (D-065). getUser() asks Auth, so a
// token of a deleted account does not show as signed in.
export function SessionNav({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? null);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setEmail(session?.user.email ?? null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [pathname]);

  async function signOut() {
    try {
      await signOutAction();
    } finally {
      // Runs also when the action ends with its redirect.
      setEmail(null);
    }
  }

  if (email === undefined) {
    return <span className="text-sm text-muted">…</span>;
  }

  if (!email) {
    return (
      <nav className="flex items-center gap-5 text-sm">
        <Link href="/login" className="link">
          Iniciar sesión
        </Link>
        <Link href="/signup" className="btn btn-secondary btn-sm">
          Crear cuenta
        </Link>
      </nav>
    );
  }

  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <Link href="/cart" className="link">
        Mi carrito
      </Link>
      <span className="hidden max-w-[16rem] truncate text-muted md:inline">{email}</span>
      <form action={signOut}>
        <FormSubmitButton pendingLabel="Saliendo…" variant="secondary" className="btn-sm">
          Cerrar sesión
        </FormSubmitButton>
      </form>
    </nav>
  );
}
