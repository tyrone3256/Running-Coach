"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Sun, NotebookPen, LineChart, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Hari ini", icon: Sun, ready: true },
  { href: "/program", label: "Program", icon: CalendarDays, ready: true },
  { href: "/log", label: "Log", icon: NotebookPen, ready: false },
  { href: "/insights", label: "Insights", icon: LineChart, ready: false },
  { href: "/coach", label: "Coach", icon: MessageCircle, ready: false },
];

export function BottomNav() {
  const path = usePathname();
  if (path.startsWith("/login")) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {ITEMS.map(({ href, label, icon: Icon, ready }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          const cls = cn(
            "flex flex-col items-center gap-0.5 py-2 text-[11px]",
            active ? "text-foreground" : "text-muted-foreground",
            !ready && "opacity-40",
          );
          return (
            <li key={href}>
              {ready ? (
                <Link href={href} className={cls} aria-current={active ? "page" : undefined}>
                  <Icon className="size-5" aria-hidden /> {label}
                </Link>
              ) : (
                <span className={cls} title="Segera (milestone berikutnya)">
                  <Icon className="size-5" aria-hidden /> {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
