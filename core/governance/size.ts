/** A byte count as people read it: 7 B, 2.9 kB, 5.3 MB. Pure, so the CLI and the cockpit share it. */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const kb = (bytes / 1000).toFixed(1);
  if (Number(kb) < 1000) return `${kb} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
