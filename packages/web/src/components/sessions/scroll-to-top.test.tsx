import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScrollToTop } from "./scroll-to-top";

describe("ScrollToTop", () => {
  it("renders hidden initially", () => {
    render(<ScrollToTop />);
    const btn = screen.getByTestId("scroll-to-top");
    expect(btn.className).toContain("opacity-0");
    expect(btn.getAttribute("aria-label")).toBe("Scroll to top");
  });

  it("becomes visible after scroll past threshold", () => {
    render(<ScrollToTop />);
    const btn = screen.getByTestId("scroll-to-top");
    act(() => {
      Object.defineProperty(window, "scrollY", {
        value: 600,
        configurable: true,
      });
      window.dispatchEvent(new Event("scroll"));
    });
    expect(btn.className).toContain("opacity-100");
  });

  it("hides again when scroll returns below threshold", () => {
    render(<ScrollToTop />);
    const btn = screen.getByTestId("scroll-to-top");
    act(() => {
      Object.defineProperty(window, "scrollY", {
        value: 600,
        configurable: true,
      });
      window.dispatchEvent(new Event("scroll"));
    });
    expect(btn.className).toContain("opacity-100");
    act(() => {
      Object.defineProperty(window, "scrollY", {
        value: 100,
        configurable: true,
      });
      window.dispatchEvent(new Event("scroll"));
    });
    expect(btn.className).toContain("opacity-0");
  });

  it("invokes window.scrollTo on click", () => {
    let called: { top?: number; behavior?: string } | undefined;
    const original = window.scrollTo;
    (
      window as unknown as { scrollTo: (opts: ScrollToOptions) => void }
    ).scrollTo = (opts: ScrollToOptions) => {
      called = { top: opts.top, behavior: opts.behavior };
    };
    try {
      render(<ScrollToTop />);
      screen.getByTestId("scroll-to-top").click();
      expect(called?.top).toBe(0);
      expect(called?.behavior).toBe("smooth");
    } finally {
      window.scrollTo = original;
    }
  });
});
