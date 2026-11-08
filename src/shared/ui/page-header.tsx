import type { ReactNode } from "react";

// Title block of every page: small gold label, serif title and an optional
// description (D-046).
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1 className="display-title text-[44px] sm:text-[56px]">{title}</h1>
      {children ? <div className="max-w-prose text-sm leading-[1.7] text-muted">{children}</div> : null}
    </header>
  );
}
