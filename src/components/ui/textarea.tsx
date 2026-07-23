import * as React from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full resize-none bg-transparent text-base leading-7 text-[var(--ink)] outline-none placeholder:text-[var(--muted)]",
        className,
      )}
      {...props}
    />
  );
}
