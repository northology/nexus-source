import { frameSandbox } from '../lib/frames.ts';

/** Thumbnails are previews only: they load late and take no focus, and screen readers skip them. */
const THUMB = { loading: 'lazy', tabIndex: -1, 'aria-hidden': 'true' } as const;

/**
 * Every concept page the cockpit shows renders through this frame, which picks its sandbox from the page's origin
 * (see frameSandbox).
 */
export function ConceptFrame({ src, title, className, thumb }: { src: string; title?: string; className?: string; thumb?: boolean }) {
  return <iframe src={src} title={title} className={className} sandbox={frameSandbox(src)} {...(thumb ? THUMB : {})} />;
}
