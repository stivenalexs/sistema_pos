import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { PermanentNotice } from "@/modules/compliance";
import { signOutAction } from "@/modules/customers";

import { SessionNav } from "./session-nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Licorera",
  description: "Venta de licores al por mayor y al detal en Antioquia.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-CO"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-white text-neutral-900">
        <header className="flex items-center justify-between border-b border-neutral-300 px-4 py-3">
          <Link href="/" className="font-semibold">
            Licorera
          </Link>
          <SessionNav signOutAction={signOutAction} />
        </header>
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">{children}</main>
        <PermanentNotice />
      </body>
    </html>
  );
}
