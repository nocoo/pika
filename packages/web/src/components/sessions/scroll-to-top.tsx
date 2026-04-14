"use client";

import { ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const SCROLL_THRESHOLD = 500;

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > SCROLL_THRESHOLD);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={cn(
        "fixed bottom-6 right-6 z-40 flex size-10 items-center justify-center",
        "rounded-full bg-card shadow-lg",
        "text-muted-foreground hover:text-foreground",
        "transition-[transform,opacity] duration-300",
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-4 opacity-0 pointer-events-none",
      )}
      aria-label="Scroll to top"
    >
      <ChevronUp className="size-5" />
    </button>
  );
}
