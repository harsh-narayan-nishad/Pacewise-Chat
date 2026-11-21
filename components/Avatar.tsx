import { Users } from "lucide-react";
import { nameColor } from "@/lib/chat";
import { cn } from "@/lib/utils";

/** A round photo, or the first letters on a colour of their own; a green dot when the person is online. */
export function Avatar({ id, name, url, size = 44, online, group, className }: { id: string; name: string; url?: string | null; size?: number; online?: boolean; group?: boolean; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const usable = url && /^(https?:|data:image\/)/.test(url);
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {usable ? (
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full font-medium text-white" style={{ background: nameColor(id), fontSize: Math.round(size * 0.38) }} aria-hidden>
          {group ? <Users style={{ width: size * 0.45, height: size * 0.45 }} /> : initials}
        </span>
      )}
      {online && <span className="absolute bottom-0 right-0 rounded-full border-2 border-canvas bg-[#30C26A]" style={{ width: Math.max(10, size * 0.26), height: Math.max(10, size * 0.26) }} aria-label="online" />}
    </span>
  );
}
