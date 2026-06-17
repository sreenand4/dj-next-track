import { ExternalLink } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t border-border px-5 py-5 text-xs text-muted sm:px-8">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>BPM &amp; key data by</span>
        <a
          href="https://getsongbpm.com"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 font-medium text-foreground hover:text-accent"
        >
          GetSongBPM
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        <span aria-hidden>·</span>
        <span>catalog &amp; previews by</span>
        <a
          href="https://www.deezer.com"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 font-medium text-foreground hover:text-accent"
        >
          Deezer
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </p>
    </footer>
  );
}
