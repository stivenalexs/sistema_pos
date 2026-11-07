import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { LEGAL_COPY, latestAdultBirthDate, todayInColombia } from "@/modules/compliance";
import { SignupForm, signUpAction } from "@/modules/customers";

export default function SignupPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Crear cuenta</h1>
      <p className="text-neutral-700">
        Para comprar en la tienda necesitas una cuenta y tener 18 años o más.
      </p>
      <Suspense>
        <Signup />
      </Suspense>
      <p className="text-sm">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="underline">
          Inicia sesión
        </Link>
      </p>
    </section>
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
