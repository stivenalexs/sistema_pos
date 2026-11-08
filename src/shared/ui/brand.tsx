import Image from "next/image";
import Link from "next/link";

// Store identity from the Figma login (D-046): seal with a glass, name and
// descriptor. The name is "La Cava" and the descriptor "Licores con historia".
export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3.5" aria-label="La Cava, ir al catálogo">
      <span className="flex h-[49px] w-[42px] shrink-0 items-center justify-center rounded-t-[21px] rounded-b-[2px] border border-gold">
        <Image src="/brand/wine.svg" alt="" width={23} height={27} />
      </span>
      <span className="flex flex-col gap-[3px] whitespace-nowrap">
        <span className="font-display text-[26px] leading-none font-medium tracking-[3px] text-ink sm:text-[29px]">
          LA CAVA
        </span>
        <span className="text-[9px] tracking-[2.5px] text-gold">LICORES CON HISTORIA</span>
      </span>
    </Link>
  );
}
