import { connection } from "next/server";
import { Suspense } from "react";

import { getAdminSummary, getStaffRole, type StaffRole } from "@/modules/customers";

import { AdminNav, type NavGroup } from "./admin-nav";
import { sectionCounts } from "./admin-tasks";

// Admin panel shell (D-054, D-064). Every page checks the role on the server;
// the menu is only navigation. Warehouse staff enter only the inventory
// section (D-056), so their menu shows only that.
type Section = { href: string; label: string; roles: readonly StaffRole[] };

const GROUPS: { label: string; sections: Section[] }[] = [
  { label: "Hoy", sections: [{ href: "/admin", label: "Resumen", roles: ["admin"] }] },
  {
    label: "Ventas",
    sections: [
      { href: "/admin/domicilios", label: "Domicilios", roles: ["admin"] },
      { href: "/admin/ventas-pos", label: "Ventas POS", roles: ["admin"] },
      { href: "/admin/facturas", label: "Facturas", roles: ["admin"] },
      { href: "/admin/reembolsos", label: "Reembolsos", roles: ["admin"] },
    ],
  },
  { label: "Bodega", sections: [{ href: "/admin/inventario", label: "Inventario", roles: ["admin", "warehouse"] }] },
  {
    label: "Clientes y equipo",
    sections: [
      { href: "/admin/mayoristas", label: "Mayoristas", roles: ["admin"] },
      { href: "/admin/personal", label: "Personal", roles: ["admin"] },
    ],
  },
  {
    label: "Tienda",
    sections: [
      { href: "/admin/configuracion", label: "Configuración", roles: ["admin"] },
      { href: "/admin/bloqueos", label: "Bloqueos", roles: ["admin"] },
    ],
  },
  { label: "Sistema", sections: [{ href: "/admin/cola", label: "Cola", roles: ["admin"] }] },
];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="page grid gap-8 pt-9 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <Suspense fallback={<div aria-hidden className="min-h-9" />}>
        <Menu />
      </Suspense>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

async function Menu() {
  await connection();
  const role = await getStaffRole();
  if (role === null) return null;
  // Pending counts only for the administrator (admin_summary is admin-only).
  const counts = role === "admin" ? sectionCounts(await getAdminSummary()) : {};
  const groups: NavGroup[] = GROUPS.map((group) => ({
    label: group.label,
    links: group.sections
      .filter((section) => section.roles.includes(role))
      .map((section) => ({ href: section.href, label: section.label, count: counts[section.href] ?? 0 })),
  })).filter((group) => group.links.length > 0);
  return <AdminNav groups={groups} />;
}
