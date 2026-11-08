import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";

import { PermanentNotice } from "@/modules/compliance";
import { signOutAction } from "@/modules/customers";

import { Brand } from "@/shared/ui/brand";

import { SessionNav } from "./session-nav";
import "./globals.css";

// Fonts of the Figma design (D-046), served by next/font (no new packages).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "La Cava",
  description: "Venta de licores al por mayor y al detal en Antioquia.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-CO"
      className={`${inter.variable} ${cormorant.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg font-sans text-ink">
        <header className="border-b border-line/70">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
            <Brand />
            <SessionNav signOutAction={signOutAction} />
          </div>
        </header>
        <main className="flex w-full flex-1 flex-col">{children}</main>
        <PermanentNotice />
      </body>
    </html>
  );
}
