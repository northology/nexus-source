/** The per-run token the nexus server embeds in the page it serves; answers are refused without it. */
export function pageToken(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="nexus-token"]')?.content ?? null;
}
