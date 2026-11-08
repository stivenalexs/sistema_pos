// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShelfCarousel } from "./shelf-carousel";

// jsdom applies no CSS: --visible is read as empty, so one bottle is visible.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderShelf(count: number) {
  const { container } = render(
    <ShelfCarousel
      label="Botellas"
      backdrop={<span />}
      rim={<span />}
      bottles={Array.from({ length: count }, (_, i) => (
        <p key={i}>Botella {i + 1}</p>
      ))}
      cards={Array.from({ length: count }, (_, i) => (
        <p key={i}>Ficha {i + 1}</p>
      ))}
    />,
  );
  const tracks = container.querySelectorAll<HTMLElement>(".shelf-track");
  return {
    index: () => tracks[0]?.style.getPropertyValue("--i"),
    cardsIndex: () => tracks[1]?.style.getPropertyValue("--i"),
    next: screen.getByRole("button", { name: "Ver la siguiente botella" }) as HTMLButtonElement,
    prev: screen.getByRole("button", { name: "Ver la botella anterior" }) as HTMLButtonElement,
    stage: container.querySelector<HTMLElement>(".touch-pan-y") as HTMLElement,
  };
}

describe("ShelfCarousel", () => {
  it("starts with the back arrow off and the forward arrow on", () => {
    const { next, prev, index } = renderShelf(3);
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    expect(index()).toBe("0");
  });

  it("moves bottles and cards together, one per click, and stops at the end", () => {
    const shelf = renderShelf(3);
    fireEvent.click(shelf.next);
    expect(shelf.index()).toBe("1");
    expect(shelf.cardsIndex()).toBe("1");
    fireEvent.click(shelf.next);
    fireEvent.click(shelf.next);
    expect(shelf.index()).toBe("2");
    expect(shelf.next.disabled).toBe(true);
    expect(shelf.prev.disabled).toBe(false);
  });

  it("goes back one bottle and turns the back arrow off at the start", () => {
    const shelf = renderShelf(3);
    fireEvent.click(shelf.next);
    fireEvent.click(shelf.prev);
    expect(shelf.index()).toBe("0");
    expect(shelf.prev.disabled).toBe(true);
  });

  it("only the visible card can be focused or read", () => {
    const shelf = renderShelf(3);
    fireEvent.click(shelf.next);
    const cards = screen.getAllByRole("listitem", { hidden: true }).filter((li) => li.textContent?.startsWith("Ficha"));
    expect(cards.map((li) => li.hasAttribute("inert"))).toEqual([true, false, true]);
  });

  it("follows a finger swipe but ignores mouse drags", () => {
    const shelf = renderShelf(3);
    fireEvent.pointerDown(shelf.stage, { pointerType: "touch", clientX: 200 });
    fireEvent.pointerUp(shelf.stage, { pointerType: "touch", clientX: 120 });
    expect(shelf.index()).toBe("1");
    fireEvent.pointerDown(shelf.stage, { pointerType: "mouse", clientX: 200 });
    fireEvent.pointerUp(shelf.stage, { pointerType: "mouse", clientX: 100 });
    expect(shelf.index()).toBe("1");
  });
});
