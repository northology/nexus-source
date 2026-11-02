import { closeSync, createReadStream } from 'node:fs';
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';

/**
 * Answers 200 with `size` bytes read from an already-open fd, and owns the fd from here: it is closed on end, on a
 * stream error, when the client leaves early, and if writeHead throws. If the file shrank after it was measured the
 * stream ends short of content-length, so the connection is destroyed rather than left for a kept-alive client to hang on.
 */
export function pipeFd(res: ServerResponse, fd: number, size: number, headers: OutgoingHttpHeaders): void {
  try {
    res.writeHead(200, headers);
  } catch (e) {
    closeSync(fd);
    throw e;
  }
  const stream = createReadStream('', { fd, start: 0, end: Math.max(0, size - 1), autoClose: true });
  let sent = 0;
  stream.on('data', (c) => { sent += c.length; });
  stream.on('end', () => { if (sent < size) res.destroy(); });
  stream.on('error', () => res.destroy());
  res.on('close', () => { if (!res.writableFinished) stream.destroy(); });
  stream.pipe(res);
}
