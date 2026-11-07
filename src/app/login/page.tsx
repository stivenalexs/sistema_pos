import Link from "next/link";
import { Suspense } from "react";

import { safeNextPath } from "@/modules/compliance";
import { LoginForm, signInAction } from "@/modules/customers";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <Suspense>
        <Login searchParams={searchParams} />
      </Suspense>
      <p className="text-sm">
        ¿No tienes cuenta?{" "}
        <Link href="/signup" className="underline">
          Crea una
        </Link>
      </p>
    </section>
  );
}

async function Login({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : "/");
  return (
    <>
      {params.confirmed === "1" ? (
        <p role="status" className="rounded-md border border-green-700 bg-green-50 p-3">
          Tu correo quedó confirmado. Ya puedes iniciar sesión.
        </p>
      ) : null}
      <LoginForm action={signInAction} next={next} />
    </>
  );
}
