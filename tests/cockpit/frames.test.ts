import { describe, it, expect } from 'vitest';
import { frameSandbox } from '../../cockpit/src/lib/frames.ts';

const HERE = 'http://127.0.0.1:4489/#/concepts';

describe('the sandbox for a concept frame', () => {
  it('gives a page on another origin its own origin', () => {
    expect(frameSandbox('http://127.0.0.1:50123/b/concepts/x.html', HERE)).toBe('allow-scripts allow-same-origin');
  });
  it('never gives a same-origin page allow-same-origin', () => {
    expect(frameSandbox('/api/builds/b/files/concepts/x.html', HERE)).toBe('allow-scripts');
    expect(frameSandbox('http://127.0.0.1:4489/api/builds/b/files/concepts/x.html', HERE)).toBe('allow-scripts');
  });
  // These have the opaque origin 'null', which differs from the cockpit's, but a frame of one inherits or borrows
  // the cockpit's origin: only an http(s) page on another origin may keep its own.
  it.each(['about:blank', 'about:srcdoc', 'javascript:void 0', 'data:text/html,x', 'blob:http://127.0.0.1:4489/0b1c', 'blob:http://127.0.0.1:50123/0b1c', 'file:///C:/x.html'])(
    'fails closed for %s',
    (src) => {
      expect(frameSandbox(src, HERE)).toBe('allow-scripts');
    },
  );
  it('gives an https page on another origin its own origin', () => {
    expect(frameSandbox('https://example.test/x.html', HERE)).toBe('allow-scripts allow-same-origin');
  });
});
