import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { LEGAL_COPY, latestAdultBirthDate, todayInColombia } from "@/modules/compliance";
import { SignupForm, signUpAction } from "@/modules/customers";
import { PageHeader } from "@/shared/ui/page-header";
import { PhotoShell } from "@/shared/ui/photo-shell";

export default function SignupPage() {
  return (
    <PhotoShell>
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Tu lugar en la cava" title="Crear cuenta">
          Para comprar en la tienda necesitas una cuenta y tener 18 años o más.
        </PageHeader>
        <Suspense>
          <Signup />
        </Suspense>
        <p className="text-center text-xs text-muted">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="link">
            Inicia sesión
          </Link>
        </p>
      </div>
    </PhotoShell>
  );
}

async function Signup() {
  // The latest valid birth date depends on today's date: compute it per request.
  await connection();
  return (
    <SignupForm
      action={signUpAction}
      legal={LEGAL_COPY.signup}
      maxBirthDate={latestAdultBirthDate(todayInColombia())}
    />
  );
}
