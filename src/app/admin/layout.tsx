import Link from "next/link";

// Admin panel shell (D-054). Every page checks the admin role on the server;
// the menu is only navigation. Sections of steps 17b to 17d are added here.
const SECTIONS = [
  { href: "/admin", label: "Resumen" },
  { href: "/admin/mayoristas", label: "Mayoristas" },
  { href: "/admin/personal", label: "Personal" },
  { href: "/admin/facturas", label: "Facturas" },
  { href: "/admin/reembolsos", label: "Reembolsos" },
  { href: "/admin/cola", label: "Cola" },
] as const;

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="page flex flex-col gap-8 pt-9">
      <nav aria-label="Panel de administración" className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line pb-3 text-sm">
        <span className="eyebrow">Administración</span>
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="link">
            {section.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
