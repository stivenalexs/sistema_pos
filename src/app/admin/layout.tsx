import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole, type StaffRole } from "@/modules/customers";

// Admin panel shell (D-054). Every page checks the role on the server; the
// menu is only navigation. Warehouse staff enter only the inventory section
// (D-056), so their menu shows only that.
const SECTIONS: { href: string; label: string; roles: readonly StaffRole[] }[] = [
  { href: "/admin", label: "Resumen", roles: ["admin"] },
  { href: "/admin/mayoristas", label: "Mayoristas", roles: ["admin"] },
  { href: "/admin/personal", label: "Personal", roles: ["admin"] },
  { href: "/admin/inventario", label: "Inventario", roles: ["admin", "warehouse"] },
  { href: "/admin/facturas", label: "Facturas", roles: ["admin"] },
  { href: "/admin/reembolsos", label: "Reembolsos", roles: ["admin"] },
  { href: "/admin/cola", label: "Cola", roles: ["admin"] },
];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="page flex flex-col gap-8 pt-9">
      <nav aria-label="Panel de administración" className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line pb-3 text-sm">
        <span className="eyebrow">Administración</span>
        <Suspense fallback={null}>
          <Sections />
        </Suspense>
      </nav>
      {children}
    </div>
  );
}

async function Sections() {
  await connection();
  const role = await getStaffRole();
  return SECTIONS.filter((section) => role !== null && section.roles.includes(role)).map((section) => (
    <Link key={section.href} href={section.href} className="link">
      {section.label}
    </Link>
  ));
}
