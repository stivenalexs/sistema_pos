import Image from "next/image";
import type { ReactNode } from "react";

import cava from "./assets/cava.jpg";

// Entrance layout from the Figma login (D-046): the cellar photo with dark
// gradients, the form on the left and an editorial note on the right. On a
// phone the photo stays as a darkened background behind the form.
// Static: no animation.
export function PhotoShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-[calc(100dvh-7rem)] overflow-hidden">
      <Image
        src={cava}
        alt=""
        fill
        priority
        sizes="100vw"
        placeholder="blur"
        className="-z-20 object-cover object-[70%_center]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-bg/85 lg:bg-[linear-gradient(90deg,rgba(19,15,12,0.98)_0%,rgba(19,15,12,0.93)_32%,rgba(19,15,12,0.53)_53%,rgba(19,15,12,0.05)_76%,rgba(19,15,12,0.09)_100%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(16,12,8,0.3)_0%,rgba(16,12,8,0)_30%,rgba(16,12,8,0)_67%,rgba(16,12,8,0.86)_100%)]"
      />
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:py-20">
        <div className="w-full max-w-[384px]">{children}</div>
        <aside className="hidden flex-col items-start justify-end gap-4 justify-self-end lg:flex">
          <span aria-hidden className="h-px w-9 bg-gold" />
          <p className="font-display text-[33px] leading-[1.15] italic">
            Cada licor, una historia.
            <br />
            Cada visita, un descubrimiento.
          </p>
        </aside>
      </div>
    </div>
  );
}
