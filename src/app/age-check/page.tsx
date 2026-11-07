import Link from "next/link";
import { Suspense } from "react";

import { AGE_GATE_PATH, confirmAgeAction, LEGAL_COPY, safeNextPath } from "@/modules/compliance";
import { FormSubmitButton } from "@/shared/ui/form-submit-button";

// Entry 18+ notice (D-035). Answering "yes" only stores a cookie; the real
// verification happens at sign-up.
export default function AgeCheckPage({ searchParams }: PageProps<"/age-check">) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{LEGAL_COPY.ageGate.title}</h1>
      <Suspense>
        <AgeCheck searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function AgeCheck({ searchParams }: Pick<PageProps<"/age-check">, "searchParams">) {
  const params = await searchParams;
  const denied = params.denied === "1";
  const next = safeNextPath(typeof params.next === "string" ? params.next : "/");

  if (denied) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert">{LEGAL_COPY.ageGate.denied}</p>
        <Link href={`${AGE_GATE_PATH}?next=${encodeURIComponent(next)}`} className="underline">
          Volver
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p>{LEGAL_COPY.ageGate.body}</p>
      <form action={confirmAgeAction} className="flex flex-col gap-3 sm:flex-row">
        <input type="hidden" name="next" value={next} />
        <FormSubmitButton pendingLabel="Entrando…">{LEGAL_COPY.ageGate.confirm}</FormSubmitButton>
        <Link
          href={`${AGE_GATE_PATH}?denied=1&next=${encodeURIComponent(next)}`}
          className="rounded-md border border-neutral-900 px-4 py-2 text-center"
        >
          {LEGAL_COPY.ageGate.deny}
        </Link>
      </form>
    </div>
  );
}
