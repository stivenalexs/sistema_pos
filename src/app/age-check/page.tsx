import Link from "next/link";
import { Suspense } from "react";

import { AGE_GATE_PATH, confirmAgeAction, LEGAL_COPY, safeNextPath } from "@/modules/compliance";
import { FormSubmitButton } from "@/shared/ui/form-submit-button";
import { PageHeader } from "@/shared/ui/page-header";
import { PhotoShell } from "@/shared/ui/photo-shell";

// Entry 18+ notice (D-035). Answering "yes" only stores a cookie; the real
// verification happens at sign-up.
export default function AgeCheckPage({ searchParams }: PageProps<"/age-check">) {
  return (
    <PhotoShell>
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Solo para mayores de 18 años" title={LEGAL_COPY.ageGate.title} />
        <Suspense>
          <AgeCheck searchParams={searchParams} />
        </Suspense>
      </div>
    </PhotoShell>
  );
}

async function AgeCheck({ searchParams }: Pick<PageProps<"/age-check">, "searchParams">) {
  const params = await searchParams;
  const denied = params.denied === "1";
  const next = safeNextPath(typeof params.next === "string" ? params.next : "/");

  if (denied) {
    return (
      <div className="flex flex-col gap-6">
        <p role="alert" className="notice notice-warning">
          {LEGAL_COPY.ageGate.denied}
        </p>
        <Link href={`${AGE_GATE_PATH}?next=${encodeURIComponent(next)}`} className="link text-sm">
          Volver
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm leading-[1.7] text-muted">{LEGAL_COPY.ageGate.body}</p>
      <form action={confirmAgeAction} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <FormSubmitButton pendingLabel="Entrando…" className="w-full">
          {LEGAL_COPY.ageGate.confirm}
        </FormSubmitButton>
        <Link
          href={`${AGE_GATE_PATH}?denied=1&next=${encodeURIComponent(next)}`}
          className="btn btn-secondary w-full"
        >
          {LEGAL_COPY.ageGate.deny}
        </Link>
      </form>
    </div>
  );
}
