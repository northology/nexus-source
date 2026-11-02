/**
 * The sandbox for a concept frame. A page on another origin than the cockpit keeps that origin, so its fonts,
 * modules and data load; a page on the cockpit's own origin must stay opaque, or it could reach the cockpit.
 * Fails closed: only an http(s) page on another origin keeps its own. `about:`, `javascript:`, `data:`, `blob:` and
 * the like have the opaque origin `null`, which differs from the cockpit's, but such a frame would inherit or borrow
 * the cockpit's origin.
 */
export function frameSandbox(src: string, here: string = window.location.href): string {
  const url = new URL(src, here);
  const web = url.protocol === 'http:' || url.protocol === 'https:';
  return web && url.origin !== new URL(here).origin ? 'allow-scripts allow-same-origin' : 'allow-scripts';
}
