"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// While a payment is being confirmed by the Wompi webhook, reload the order
// every few seconds (for up to 2 minutes). The page never decides the
// payment result by itself.
export function PaymentStatusRefresher({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 120_000) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [active, router]);

  return null;
}
