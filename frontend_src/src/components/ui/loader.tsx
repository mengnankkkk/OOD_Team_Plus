import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface LoaderProps {
  label?: string;
  className?: string;
  size?: "sm" | "md";
}

const bars = Array.from({ length: 10 }, (_, idx) => idx + 1);

export function Loader({ label = "加载中…", className, size = "md" }: LoaderProps) {
  return (
    <div className={cn("loading-loader", className)} role="status" aria-label={label || "加载中"}>
      <div className={cn("loading-spinner", size === "sm" && "loading-spinner-sm")} aria-hidden="true">
        {bars.map((bar) => (
          <div
            key={bar}
            style={
              {
                "--delay": bar / 10,
                "--rotation": bar * 36,
                "--translation": 150,
              } as CSSProperties
            }
          />
        ))}
      </div>
      {label ? <span>{label}</span> : null}
    </div>
  );
}
