"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Disc3, Menu } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";
import { SiteFooter } from "@/components/SiteFooter";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`group flex items-start gap-3 rounded-xl px-3 py-3 transition-colors ${
              active
                ? "bg-accent/15 text-foreground"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Icon
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                active ? "text-accent" : "text-muted group-hover:text-foreground"
              }`}
              aria-hidden
            />
            <span className="flex flex-col">
              <span className="text-sm font-semibold leading-tight">
                {item.label}
              </span>
              <span className="text-xs leading-snug text-muted">
                {item.description}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-orange text-background">
        <Disc3 className="h-5 w-5" aria-hidden />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-sm font-bold tracking-tight">Next Track</span>
        <span className="text-xs font-medium text-muted">Finder for DJs</span>
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <Brand />
        <div className="mt-2 flex-1 overflow-y-auto pb-6">
          <NavLinks />
        </div>
        <div className="border-t border-border px-5 py-4 text-xs text-muted">
          Harmonic mixing companion
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-border bg-surface">
            <Brand />
            <div className="mt-2 flex-1 overflow-y-auto pb-6">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface/80 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <span className="text-sm font-bold">Next Track Finder</span>
        </header>

        <main className="flex-1">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
