import type { ReactNode } from "react";

// Title block of every page: small gold label, serif title and an optional
// description (D-046). "compact" is the working scale of the admin panel
// (D-064): smaller title, the store keeps the large one.
export function PageHeader({
  eyebrow,
  title,
  size = "large",
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  size?: "large" | "compact";
  children?: ReactNode;
}) {
  return (
    <header className={`flex flex-col ${size === "compact" ? "gap-3" : "gap-4"}`}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1 className={`display-title ${size === "compact" ? "text-[34px] sm:text-[40px]" : "text-[44px] sm:text-[56px]"}`}>{title}</h1>
      {children ? <div className="max-w-prose text-sm leading-[1.7] text-muted">{children}</div> : null}
    </header>
  );
}
