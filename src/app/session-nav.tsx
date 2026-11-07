"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { signOutAction } from "@/modules/customers";
import { createSupabaseBrowserClient } from "@/shared/supabase/browser";
import { FormSubmitButton } from "@/shared/ui/form-submit-button";

// Sign-in links or sign-out button, depending on the session. Read in the
// browser: reading cookies on the server inside the root layout breaks pages
// whose Server Action returns an error (Next.js 16.4.5 invariant, D-035).
// This is display only; every permission check happens on the server.
export function SessionNav() {
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
    return <span className="text-sm text-neutral-500">…</span>;
  }

  if (!email) {
    return (
      <nav className="flex gap-4 text-sm">
        <Link href="/login" className="underline">
          Iniciar sesión
        </Link>
        <Link href="/signup" className="underline">
          Crear cuenta
        </Link>
      </nav>
    );
  }

  return (
    <form action={signOutAction} className="flex items-center gap-3 text-sm">
      <span>{email}</span>
      <FormSubmitButton pendingLabel="Saliendo…" className="px-3 py-1 text-sm">
        Cerrar sesión
      </FormSubmitButton>
    </form>
  );
}
