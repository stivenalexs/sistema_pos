"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/shared/supabase/browser";
import { FormSubmitButton } from "@/shared/ui/form-submit-button";

// Sign-in links or sign-out button, depending on the session. Read in the
// browser: reading cookies on the server inside the root layout breaks pages
// whose Server Action returns an error (Next.js 16.4.5 invariant, D-035).
// This is display only; every permission check happens on the server.
// The sign-out Server Action comes from the layout: a Client Component must
// not import the customers module index, which also exports server-only code.
export function SessionNav({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const [email, setEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    supabase.auth.getClaims().then(({ data }) => {
      if (!active) return;
      const value = data?.claims.email;
      setEmail(typeof value === "string" ? value : null);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

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
      <form action={signOutAction}>
        <FormSubmitButton pendingLabel="Saliendo…" variant="secondary" className="btn-sm">
          Cerrar sesión
        </FormSubmitButton>
      </form>
    </nav>
  );
}
