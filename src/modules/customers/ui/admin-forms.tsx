"use client";

import { useActionState } from "react";

import { useFieldErrors } from "@/shared/ui/field-errors";
import { FormSubmitButton } from "@/shared/ui/form-submit-button";
import { PasswordInput } from "@/shared/ui/password-input";

import { STAFF_ROLE_LABELS, STAFF_ROLES } from "../domain/staff";
import {
  type AdminFormState,
  deactivateStaffAction,
  inviteStaffAction,
  type PasswordFormState,
  reviewWholesaleAction,
  revokeInvitationAction,
  setPasswordAction,
} from "../server/admin-actions";

// Admin panel forms (D-054). Every submit uses FormSubmitButton: locked on the
// first click until the server answers (agents.md §5.2). No animation.

function Status({ state }: { state: AdminFormState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`notice ${state.status === "error" ? "notice-danger" : "notice-success"}`}>
      {state.message}
    </p>
  );
}

export function WholesaleReviewForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState<AdminFormState, FormData>(reviewWholesaleAction, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="customerId" value={customerId} />
      <label className="field-label">
        Motivo (queda en el historial)
        <input name="reason" required minLength={3} maxLength={300} placeholder="NIT verificado en el RUES" className="field" />
      </label>
      <div className="flex flex-wrap gap-3">
        <FormSubmitButton name="decision" value="approved" pendingLabel="Guardando…" className="btn-sm">
          Aprobar
        </FormSubmitButton>
        <FormSubmitButton name="decision" value="rejected" pendingLabel="Guardando…" variant="secondary" className="btn-sm">
          Rechazar
        </FormSubmitButton>
      </div>
      <Status state={state} />
    </form>
  );
}

export function InviteStaffForm() {
  const [state, action] = useActionState<AdminFormState, FormData>(inviteStaffAction, { status: "idle" });
  const { formRef, invalid, error } = useFieldErrors(state.fieldErrors);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <label className="field-label">
        Nombre completo
        <input name="fullName" {...invalid("fullName")} required minLength={3} maxLength={120} className="field" />
        {error("fullName")}
      </label>
      <label className="field-label">
        Correo
        <input name="email" type="email" {...invalid("email")} required maxLength={254} className="field" autoComplete="off" />
        {error("email")}
      </label>
      <label className="field-label">
        Teléfono (opcional)
        <input name="phone" {...invalid("phone")} inputMode="tel" maxLength={20} className="field" />
        {error("phone")}
      </label>
      <label className="field-label">
        Rol
        <select name="role" {...invalid("role")} required defaultValue="" className="field">
          <option value="" disabled>
            Elige el rol
          </option>
          {STAFF_ROLES.map((role) => (
            <option key={role} value={role}>
              {STAFF_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        {error("role")}
      </label>
      <FormSubmitButton pendingLabel="Enviando…">Enviar invitación</FormSubmitButton>
      <Status state={state} />
    </form>
  );
}

export function RevokeInvitationForm({ invitationId }: { invitationId: string }) {
  const [state, action] = useActionState<AdminFormState, FormData>(revokeInvitationAction, { status: "idle" });
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="invitationId" value={invitationId} />
      <FormSubmitButton pendingLabel="Anulando…" variant="secondary" className="btn-sm">
        Anular
      </FormSubmitButton>
      {state.status === "error" ? <span className="field-error">{state.message}</span> : null}
    </form>
  );
}

export function DeactivateStaffForm({ userId }: { userId: string }) {
  const [state, action] = useActionState<AdminFormState, FormData>(deactivateStaffAction, { status: "idle" });
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={userId} />
      <label className="field-label grow">
        <span className="sr-only">Motivo de la desactivación</span>
        <input name="reason" required minLength={3} maxLength={300} placeholder="Motivo" className="field py-1.5 text-sm" />
      </label>
      <FormSubmitButton pendingLabel="Desactivando…" variant="secondary" className="btn-sm">
        Desactivar
      </FormSubmitButton>
      {state.message ? (
        <span className={state.status === "error" ? "field-error w-full" : "w-full text-sm"}>{state.message}</span>
      ) : null}
    </form>
  );
}

export function SetPasswordForm() {
  const [state, action] = useActionState<PasswordFormState, FormData>(setPasswordAction, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-5">
      {state.message ? (
        <p role="alert" className="notice notice-danger">
          {state.message}
        </p>
      ) : null}
      <label className="field-label">
        Contraseña nueva
        <PasswordInput name="password" autoComplete="new-password" required minLength={8} />
      </label>
      <label className="field-label">
        Repite la contraseña
        <PasswordInput name="confirm" autoComplete="new-password" required minLength={8} />
      </label>
      <p className="field-help">Mínimo 8 caracteres, con letras y números.</p>
      <FormSubmitButton pendingLabel="Guardando…" className="w-full">
        Guardar contraseña
      </FormSubmitButton>
    </form>
  );
}
