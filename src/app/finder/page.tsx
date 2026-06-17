import { SlidersVertical } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export default function FinderPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
      <PageHeader
        title="Next Track Finder"
        subtitle="Search a song to see the best tracks to play next — matched by key (Camelot), BPM, genre and energy."
      />

      {/* Stub: search input + results land here in a later step */}
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface/40 p-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-accent">
          <SlidersVertical className="h-6 w-6" aria-hidden />
        </span>
        <p className="text-sm font-semibold">Search & recommendations coming next</p>
        <p className="max-w-sm text-xs text-muted">
          This is where you&apos;ll search for a track and get ranked next-song
          suggestions on the Camelot wheel.
        </p>
      </div>
    </div>
  );
}
