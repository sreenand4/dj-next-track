import { Library } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export default function TransitionsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
      <PageHeader
        title="My Transitions"
        subtitle="Save the song-to-song transitions you've actually mixed. When you search a saved track in the finder, your own transitions surface first."
      />

      {/* Stub: saved transitions list + add form land here in a later step */}
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface/40 p-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-accent-green">
          <Library className="h-6 w-6" aria-hidden />
        </span>
        <p className="text-sm font-semibold">Your transition library coming next</p>
        <p className="max-w-sm text-xs text-muted">
          This is where you&apos;ll log transitions and browse the ones you&apos;ve
          saved (stored locally in your browser to start).
        </p>
      </div>
    </div>
  );
}
