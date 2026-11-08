import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole, SetPasswordForm } from "@/modules/customers";
import { PageHeader } from "@/shared/ui/page-header";

// First password of an invited staff member (D-054). The session comes from
// the invitation link verified in /auth/confirm.
export default function SetPasswordPage() {
  return (
    <section className="page-narrow flex flex-col gap-8">
      <PageHeader eyebrow="Equipo de La Cava" title="Crea tu contraseña" />
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Form />
      </Suspense>
    </section>
  );
}

async function Form() {
  await connection();
  // Only staff arrive here from an invitation.
  if (!(await getStaffRole())) redirect("/login?invitation=expired");
  return <SetPasswordForm />;
}
