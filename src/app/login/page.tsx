import Link from "next/link";
import { Suspense } from "react";

import { safeNextPath } from "@/modules/compliance";
import { LoginForm, signInAction } from "@/modules/customers";
import { PageHeader } from "@/shared/ui/page-header";
import { PhotoShell } from "@/shared/ui/photo-shell";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <PhotoShell>
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Un lugar para disfrutar, sin prisa"
          title={
            <>
              Bienvenido
              <br />a la cava.
            </>
          }
        >
          Entra y descubre todo lo que hemos reservado para ti.
        </PageHeader>
        <Suspense>
          <Login searchParams={searchParams} />
        </Suspense>
        <p className="text-center text-xs text-muted">
          ¿No tienes cuenta?{" "}
          <Link href="/signup" className="link">
            Crea una
          </Link>
        </p>
      </div>
    </PhotoShell>
  );
}

async function Login({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : "/");
  return (
    <div className="flex flex-col gap-6">
      {params.confirmed === "1" ? (
        <p role="status" className="notice notice-success">
          Tu correo quedó confirmado. Ya puedes iniciar sesión.
        </p>
      ) : null}
      {params.invitation === "expired" ? (
        <p role="status" className="notice notice-warning">
          El enlace de la invitación venció o ya se usó. Pide al administrador una invitación nueva, o inicia sesión si ya creaste tu contraseña.
        </p>
      ) : null}
      <LoginForm action={signInAction} next={next} />
    </div>
  );
}
