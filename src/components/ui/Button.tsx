import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = {
  variant?: "solid" | "outline" | "white";
  to?: string;
  children: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

const styles: Record<NonNullable<Props["variant"]>, string> = {
  solid: "bg-navy text-white hover:bg-navy-700",
  outline: "border border-navy/40 text-navy hover:border-navy bg-transparent",
  white: "bg-white text-navy hover:bg-cream",
};

export default function Button({ variant = "solid", to, children, className = "", ...rest }: Props) {
  const cls = `label-caps inline-flex items-center justify-center gap-2 px-7 py-3.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`;
  if (to) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
