import { ButtonHTMLAttributes, ReactNode, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface AnimatedMenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
}

// Port of the Uiverse.io "ink sweep" button — a black pill that reveals a white circular
// sweep on hover via mix-blend-mode: difference, and nudges on click.
const AnimatedMenuButton = forwardRef<HTMLButtonElement, AnimatedMenuButtonProps>(
  ({ icon, children, className, type = "button", ...rest }, ref) => (
    <button ref={ref} type={type} className={cn("menu-anim-btn", className)} {...rest}>
      {icon ? <span className="menu-anim-btn-icon">{icon}</span> : null}
      <span className="menu-anim-btn-label">{children}</span>
    </button>
  ),
);

AnimatedMenuButton.displayName = "AnimatedMenuButton";
export default AnimatedMenuButton;
