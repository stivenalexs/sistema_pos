import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import {
  DeactivateStaffForm,
  getStaffRole,
  InviteStaffForm,
  listStaff,
  RevokeInvitationForm,
  STAFF_ROLE_LABELS,
} from "@/modules/customers";
import { PageHeader } from "@/shared/ui/page-header";

const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });

// Staff (D-054): invitations by email and deactivation.
export default function StaffPage() {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader eyebrow="Panel" title="Personal">
        Invita por correo a cajeros, mensajeros, bodega y administradores. La persona crea su contraseña desde el
        enlace; nadie más la conoce.
      </PageHeader>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Staff />
      </Suspense>
    </section>
  );
}

async function Staff() {
  await connection();
  if ((await getStaffRole()) !== "admin") redirect("/login?next=/admin/personal");
  const { members, invitations } = await listStaff();

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-3xl">Equipo</h2>
          <ul className="flex flex-col gap-3">
            {members.map((m) => (
              <li key={m.userId} className="card flex flex-col gap-3 p-4">
                <div>
                  <p className="font-medium">
                    {m.fullName} <span className="badge ml-2">{STAFF_ROLE_LABELS[m.role]}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {m.email} ·{" "}
                    {m.lastSignInAt ? `último ingreso ${DATE.format(new Date(m.lastSignInAt))}` : "todavía no ha ingresado"}
                  </p>
                </div>
                <DeactivateStaffForm userId={m.userId} />
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="font-display text-3xl">Invitaciones pendientes</h2>
          <p className="text-sm text-muted">
            El enlace del correo dura una hora. Si venció o se perdió, invita de nuevo el mismo correo: se reenvía y el
            enlace anterior deja de servir.
          </p>
          {invitations.length === 0 ? (
            <p className="text-sm text-muted">No hay invitaciones pendientes.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {invitations.map((i) => (
                <li key={i.id} className="card flex items-start justify-between gap-4 p-4">
                  <div>
                    <p className="font-medium">
                      {i.fullName} <span className="badge ml-2">{STAFF_ROLE_LABELS[i.role]}</span>
                    </p>
                    <p className="text-sm text-muted">
                      {i.email} · {i.expired ? "vencida" : `vence ${DATE.format(new Date(i.expiresAt))}`}
                    </p>
                  </div>
                  <RevokeInvitationForm invitationId={i.id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card flex flex-col gap-4 self-start p-5">
        <h2 className="font-display text-3xl">Invitar</h2>
        <InviteStaffForm />
      </div>
    </div>
  );
}
