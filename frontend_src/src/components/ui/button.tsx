import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none border text-sm font-semibold uppercase tracking-[0.08em] ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default: "border-foreground bg-foreground text-background hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-background hover:text-foreground hover:shadow-[4px_4px_0_hsl(var(--foreground))]",
                destructive:
                    "border-destructive bg-destructive text-destructive-foreground hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-background hover:text-destructive hover:shadow-[4px_4px_0_hsl(var(--destructive))]",
                outline:
                    "border-foreground bg-transparent text-foreground hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-foreground hover:text-background hover:shadow-[4px_4px_0_hsl(var(--foreground))]",
                secondary:
                    "border-foreground bg-secondary text-secondary-foreground hover:bg-background",
                ghost: "border-transparent hover:bg-secondary hover:text-foreground",
                link: "border-transparent text-foreground underline-offset-4 decoration-2 decoration-destructive hover:underline",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-9 px-3",
                lg: "h-11 px-8",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }
