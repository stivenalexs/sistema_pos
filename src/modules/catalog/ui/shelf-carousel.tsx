"use client";

import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// Bottles inside the open barrel and their cards below (D-048, D-049).
// Both rows move together, one bottle per click: the arrow on the right of
// the last bottle moves forward, the one on the left of the first moves back,
// and each arrow turns off at its end. On a phone the barrel can be swiped.
// How many bottles fit comes from CSS (--visible: 1, 2 or 3 by width).
// Motion: a short slide, only in the catalog; none with prefers-reduced-motion.
// The arrows only move the view, they are not actions.

type Props = {
  label: string;
  /** One bottle per product, drawn inside the barrel cavity. */
  bottles: ReactNode[];
  /** One card per product, in the same order. */
  cards: ReactNode[];
  /** Back layer: the whole barrel photo. */
  backdrop: ReactNode;
  /** Front layer: the same photo clipped to the lower rim, over the bottles. */
  rim: ReactNode;
};

const SWIPE_PX = 40;

export function ShelfCarousel({ label, bottles, cards, backdrop, rim }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const swipeRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(1);
  const [index, setIndex] = useState(0);
  const count = bottles.length;
  const lastIndex = Math.max(0, count - visible);
  const current = Math.min(index, lastIndex);

  const readVisible = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const value = Number.parseInt(getComputedStyle(root).getPropertyValue("--visible"), 10);
    setVisible(Number.isFinite(value) && value > 0 ? value : 1);
  }, []);

  useEffect(() => {
    readVisible();
    window.addEventListener("resize", readVisible);
    return () => window.removeEventListener("resize", readVisible);
  }, [readVisible]);

  function move(direction: 1 | -1) {
    setIndex((value) => Math.min(lastIndex, Math.max(0, Math.min(value, lastIndex) + direction)));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") swipeRef.current = event.clientX;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (start === null) return;
    const dx = event.clientX - start;
    if (Math.abs(dx) >= SWIPE_PX) move(dx < 0 ? 1 : -1);
  }

  const trackStyle = { "--i": current } as CSSProperties;
  const inView = (i: number) => i >= current && i < current + visible;

  const cavity = (
    <div className="h-full overflow-clip">
      <ul style={trackStyle} className="shelf-track flex h-full">
        {bottles.map((bottle, i) => (
          <li
            key={i}
            data-slide
            aria-hidden={!inView(i)}
            className="flex h-full shrink-0 basis-[calc(100%/var(--visible))] items-end justify-center"
          >
            {bottle}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription="carrusel"
      aria-label={label}
      className="[--visible:1] sm:[--visible:2] lg:[--visible:3]"
    >
      <div
        className="touch-pan-y select-none"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipeRef.current = null)}
      >
        {/* Stage: shows the middle of the canvas; the canvas keeps the photo
            proportions and is wider than the stage on small screens, so the
            cavity stays large enough. Every position is a % of the photo. */}
        <div className="barrel-stage relative mx-auto aspect-[calc(1376/(768*var(--zoom)))] w-full max-w-[1104px] overflow-clip [--zoom:2.1] sm:[--zoom:1.6] lg:[--zoom:1.15]">
          <div className="absolute top-0 left-1/2 aspect-[1376/768] w-[calc(100%*var(--zoom))] -translate-x-1/2">
            <div className="absolute inset-0 -z-10">{backdrop}</div>
            {/* Cavity of the barrel: x 35.5%–66%, y 20%–77% of the photo. */}
            <div className="absolute top-[20%] bottom-[23%] left-[35.5%] w-[30.5%] px-[1%]">{cavity}</div>
            <div className="pointer-events-none absolute inset-0 [clip-path:inset(77.5%_33%_0_33%)]">{rim}</div>
            <ShelfArrow direction={-1} disabled={current === 0} onClick={() => move(-1)} />
            <ShelfArrow direction={1} disabled={current >= lastIndex} onClick={() => move(1)} />
          </div>
        </div>
      </div>
      <div className="relative z-10 mx-auto -mt-[6%] w-full max-w-[400px] overflow-clip sm:max-w-[560px] lg:max-w-[680px]">
        <ul style={trackStyle} className="shelf-track flex">
          {cards.map((card, i) => (
            <li
              key={i}
              aria-roledescription="botella"
              aria-label={`${i + 1} de ${count}`}
              aria-hidden={!inView(i)}
              inert={!inView(i)}
              className={`flex shrink-0 basis-[calc(100%/var(--visible))] px-3 ${
                i > current && inView(i) ? "border-l border-gold/20" : ""
              }`}
            >
              {card}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ShelfArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: 1 | -1;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 1 ? "Ver la siguiente botella" : "Ver la botella anterior"}
      className={`absolute top-[45%] z-20 flex size-11 items-center justify-center rounded-full border border-gold bg-bg/80 text-gold hover:bg-field disabled:cursor-default disabled:border-line disabled:text-line ${
        direction === 1 ? "left-[66%] ml-2" : "right-[64.5%] mr-2"
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d={direction === 1 ? "M7.5 4.5 13 10l-5.5 5.5" : "M12.5 4.5 7 10l5.5 5.5"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
