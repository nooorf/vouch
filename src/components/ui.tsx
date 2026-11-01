import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-[-0.01em] transition-[background-color,border-color,color,box-shadow] disabled:pointer-events-none disabled:opacity-45 whitespace-nowrap";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(16_24_40/0.12)] hover:bg-brand-hover",
  secondary: "border border-line-strong bg-surface text-ink shadow-soft hover:border-faint hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink",
  danger: "bg-danger text-white shadow-[0_1px_2px_rgb(16_24_40/0.12)] hover:opacity-90",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-sm",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({
  variant,
  size,
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant,
  size,
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** A quiet panel: hairline border, barely-there shadow. */
export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-2xl border border-line bg-surface shadow-soft ${className}`} {...props} />;
}

type Tone = "neutral" | "ok" | "held" | "danger" | "info" | "brand";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  ok: "bg-released-soft text-released",
  held: "bg-held-soft text-held",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand",
};
const dots: Record<Tone, string> = {
  neutral: "bg-faint",
  ok: "bg-released-fill",
  held: "bg-held-fill",
  danger: "bg-danger",
  info: "bg-info",
  brand: "bg-brand",
};

export function Badge({ tone = "neutral", children, className = "", dot = false }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}>
      {dot && <span className={`size-1.5 rounded-full ${dots[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** A tinted note inside a panel: errors, warnings, gentle info. */
export function Callout({ tone = "neutral", className = "", ...props }: ComponentProps<"div"> & { tone?: Exclude<Tone, "brand"> }) {
  const t: Record<Exclude<Tone, "brand">, string> = {
    neutral: "bg-surface-2 text-ink",
    ok: "bg-released-soft text-released",
    held: "bg-held-soft text-ink",
    danger: "bg-danger-soft text-danger",
    info: "bg-info-soft text-info",
  };
  return <div className={`rounded-xl px-4 py-3 text-sm ${t[tone]} ${className}`} {...props} />;
}

export function Container({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-8 ${className}`} {...props} />;
}

/** Shared input styling for text fields and textareas. */
export const fieldClass =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink shadow-soft placeholder:text-faint transition-[border-color,box-shadow] focus:border-brand focus:outline-none focus:ring-4 focus:ring-[var(--ring)]";
