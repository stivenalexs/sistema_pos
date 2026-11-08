// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfCarousel } from "./shelf-carousel";

// jsdom has no layout: give the shelf a fixed geometry (one bottle visible,
// 247 px each) and make scrollTo move instantly.
const SLIDE = 247;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => SLIDE });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => SLIDE });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.querySelectorAll("[data-slide]").length * SLIDE;
    },
  });
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === "object") this.scrollLeft = options.left ?? 0;
    fireEvent.scroll(this);
  } as typeof HTMLElement.prototype.scrollTo;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderShelf(count: number) {
  render(
    <ShelfCarousel label="Botellas">
      {Array.from({ length: count }, (_, i) => (
        <p key={i}>Botella {i + 1}</p>
      ))}
    </ShelfCarousel>,
  );
  return {
    track: screen.getByRole("list"),
    next: screen.getByRole("button", { name: "Ver la siguiente botella" }),
    prev: screen.getByRole("button", { name: "Ver la botella anterior" }),
  };
}

describe("ShelfCarousel", () => {
  it("starts with the back arrow off and the forward arrow on", () => {
    const { next, prev } = renderShelf(3);
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });

  it("moves one bottle per click and turns the forward arrow off at the end", () => {
    const { track, next, prev } = renderShelf(3);
    fireEvent.click(next);
    expect(track.scrollLeft).toBe(SLIDE);
    act(() => vi.advanceTimersByTime(800));
    fireEvent.click(next);
    expect(track.scrollLeft).toBe(2 * SLIDE);
    expect((next as HTMLButtonElement).disabled).toBe(true);
    expect((prev as HTMLButtonElement).disabled).toBe(false);
  });

  it("counts quick clicks from the bottle it is heading to", () => {
    const { track, next } = renderShelf(5);
    // Simulate a smooth scroll still on its way: position does not change yet.
    HTMLElement.prototype.scrollTo = vi.fn() as typeof HTMLElement.prototype.scrollTo;
    fireEvent.click(next);
    fireEvent.click(next);
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({ left: 2 * SLIDE, behavior: "smooth" });
    expect(track.scrollLeft).toBe(0);
  });

  it("goes back one bottle and jumps without motion when reduced motion is on", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
    const { track, next, prev } = renderShelf(3);
    fireEvent.click(next);
    act(() => vi.advanceTimersByTime(800));
    const spy = vi.spyOn(HTMLElement.prototype, "scrollTo");
    fireEvent.click(prev);
    expect(spy).toHaveBeenCalledWith({ left: 0, behavior: "auto" });
    expect(track.scrollLeft).toBe(0);
    expect((prev as HTMLButtonElement).disabled).toBe(true);
  });
});
