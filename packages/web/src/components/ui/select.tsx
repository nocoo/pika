import type * as React from "react";

import { cn } from "@/lib/utils";

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "flex h-9 w-full appearance-none rounded-md border border-border hover:border-foreground/20 bg-secondary px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:border-transparent disabled:hover:border-transparent disabled:text-muted-foreground/38",
        className,
      )}
      {...props}
    />
  );
}

export { Select };
