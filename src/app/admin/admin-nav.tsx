"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Admin menu (D-064): grouped by task, the current section marked
// (aria-current) and the pending items of each section next to its name.
// A sidebar on wide screens; on phones, one row that scrolls sideways.

export type NavGroup = { label: string; links: { href: string; label: string; count: number }[] };

export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const isCurrent = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Panel de administración"
      className="-mx-4 overflow-x-auto [scrollbar-width:none] border-b border-line px-4 pb-3 lg:mx-0 lg:overflow-visible lg:border-b-0 lg:border-r lg:px-0 lg:pr-6 lg:pb-0"
    >
      <ul className="flex gap-x-6 gap-y-5 lg:flex-col">
        {groups.map((group) => (
          <li key={group.label} className="shrink-0">
            <p className="mb-1.5 hidden text-xs text-muted lg:block">{group.label}</p>
            <ul className="flex gap-x-5 lg:flex-col lg:gap-y-1">
              {group.links.map((link) => {
                const current = isCurrent(link.href);
                return (
                  <li key={link.href} className="shrink-0">
                    <Link
                      href={link.href}
                      aria-current={current ? "page" : undefined}
                      className={`flex min-h-9 items-center justify-between gap-3 whitespace-nowrap text-sm lg:rounded-[4px] lg:px-2 ${
                        current
                          ? "font-medium text-ink lg:bg-field lg:shadow-[inset_2px_0_0_var(--color-gold)]"
                          : "text-muted hover:text-ink"
                      }`}
                    >
                      {link.label}
                      {link.count > 0 ? (
                        <span className="rounded-full bg-gold px-1.5 text-[11px] leading-[18px] font-semibold text-gold-ink tabular-nums">
                          <span className="sr-only">, pendientes: </span>
                          {link.count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
