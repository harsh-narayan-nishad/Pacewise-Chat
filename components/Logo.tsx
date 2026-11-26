import { cn } from "@/lib/utils";

/** Palk's mark (the same drawing as app/icon.svg): a teal rounded tile with a white chat bubble with a simple nose. */
export function PalkMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id="palk-tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#16AFA6" /><stop offset="1" stopColor="#0B7F79" /></linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#palk-tile)" />
      <path d="M31 12.5c10.5 0 19 7.9 19 17.7 0 4.6-1.9 8.8-5 12 .3 2.7 1.6 5 3.6 6.6.5.4.2 1.2-.4 1.2-3.9 0-7.3-1.5-9.6-3.6-2.3.8-4.9 1.3-7.6 1.3-10.5 0-19-7.9-19-17.6S20.5 12.5 31 12.5z" fill="#fff" />
      <path d="M32.7 24.2c-.3 3.9-1.6 7-3.8 9.4-.6.7-.2 1.8.7 1.9 1.9.3 3.6 0 5.1-.8" fill="none" stroke="#0B7F79" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The Palk logo: the mark and the name. */
export function Logo({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="Palk">
      <PalkMark size={size === "lg" ? 44 : 26} />
      <span className={cn("font-semibold tracking-tight text-ink", size === "lg" ? "text-3xl" : "text-[17px]")}>Palk</span>
    </span>
  );
}
