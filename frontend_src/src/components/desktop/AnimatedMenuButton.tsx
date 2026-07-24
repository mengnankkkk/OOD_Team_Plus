import { ButtonHTMLAttributes, ReactNode, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface AnimatedMenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
}

const starPath =
  "M392.05 0c-20.9 210.08-184.06 378.41-392.05 407.78 207.96 29.37 371.12 197.68 392.05 407.74 20.93-210.06 184.09-378.37 392.05-407.74-207.98-29.38-371.16-197.69-392.06-407.78z";

const stars = [1, 2, 3, 4, 5, 6];

const AnimatedMenuButton = forwardRef<HTMLButtonElement, AnimatedMenuButtonProps>(
  ({ icon, children, className, type = "button", ...rest }, ref) => (
    <button ref={ref} type={type} className={cn("menu-anim-btn", className)} {...rest}>
      {icon ? <span className="menu-anim-btn-icon">{icon}</span> : null}
      <span className="menu-anim-btn-label">{children}</span>
      {stars.map((star) => (
        <span key={star} className={`menu-anim-btn-star star-${star}`} aria-hidden="true">
          <svg viewBox="0 0 784.11 815.53" focusable="false">
            <path d={starPath} />
          </svg>
        </span>
      ))}
    </button>
  ),
);

AnimatedMenuButton.displayName = "AnimatedMenuButton";
export default AnimatedMenuButton;
