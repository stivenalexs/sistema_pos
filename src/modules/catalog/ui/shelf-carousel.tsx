"use client";

import { Children, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

// Bottles on the barrel shelf (D-048). One bottle per click: the arrow on the
// right of the last bottle moves forward, the one on the left of the first
// moves back, and each arrow turns off at its end. On a phone the shelf can
// also be swiped (native scroll with snap points, no library).
// Motion: a short smooth scroll, only here; with prefers-reduced-motion the
// shelf jumps instead. The arrows only move the view, they are not actions.
export function ShelfCarousel({ children, label }: { children: ReactNode; label: string }) {
  const trackRef = useRef<HTMLUListElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const targetRef = useRef<number | null>(null);
  const clearTargetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slides = Children.toArray(children);

  const update = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setAtStart(track.scrollLeft <= 1);
    setAtEnd(track.scrollLeft + track.clientWidth >= track.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    update();
    track.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(track);
    return () => {
      track.removeEventListener("scroll", update);
      observer.disconnect();
      if (clearTargetRef.current) clearTimeout(clearTargetRef.current);
    };
  }, [update]);

  // Quick clicks while the shelf is still sliding count from the bottle it is
  // heading to, so no click is lost.
  function move(direction: 1 | -1) {
    const track = trackRef.current;
    const slide = track?.querySelector<HTMLElement>("[data-slide]");
    if (!track || !slide) return;
    const width = slide.offsetWidth;
    const lastIndex = Math.max(0, Math.round((track.scrollWidth - track.clientWidth) / width));
    const from = targetRef.current ?? Math.round(track.scrollLeft / width);
    const to = Math.min(lastIndex, Math.max(0, from + direction));
    targetRef.current = to;
    if (clearTargetRef.current) clearTimeout(clearTargetRef.current);
    clearTargetRef.current = setTimeout(() => (targetRef.current = null), 700);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: to * width, behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <div className="relative" role="region" aria-roledescription="carrusel" aria-label={label}>
      <ul
        ref={trackRef}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, index) => (
          <li
            key={index}
            data-slide
            aria-roledescription="botella"
            aria-label={`${index + 1} de ${slides.length}`}
            className="flex shrink-0 basis-full snap-start px-3 sm:basis-1/2 lg:basis-1/3"
          >
            {slide}
          </li>
        ))}
      </ul>
      <ShelfArrow direction={-1} disabled={atStart} onClick={() => move(-1)} />
      <ShelfArrow direction={1} disabled={atEnd} onClick={() => move(1)} />
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
      className={`absolute top-[150px] z-10 flex size-11 items-center justify-center rounded-full border border-gold bg-bg/80 text-gold hover:bg-field disabled:cursor-default disabled:border-line disabled:text-line ${
        direction === 1 ? "right-0 lg:-right-14" : "left-0 lg:-left-14"
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
