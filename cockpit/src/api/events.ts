import type { Client } from './client.ts';

/** What a server change event says changed: one build (null: everything under .build/), or the repo. */
export type ChangeData = { build?: string | null; repo?: boolean } | null;

export interface EventListeners {
  /** A server change event, its data parsed (null when it isn't a JSON object). */
  change?: (data: ChangeData) => void;
  /** The stream (re)connected: anything may have changed while it was down. */
  open?: () => void;
}

export function isRepoChange(data: ChangeData): boolean {
  return data !== null && data.repo === true;
}

interface Subscriber {
  client: Pick<Client, 'refreshToken'>;
  listeners: EventListeners;
}

/**
 * One EventSource per page, however many hooks listen: a browser allows six HTTP/1.1 connections per origin, and a
 * stream holds one for as long as the page is open, so a stream per hook runs out after a few cockpit tabs.
 */
let source: EventSource | null = null;
let connects = 0;
const subscribers = new Set<Subscriber>();

function parse(data: unknown): ChangeData {
  try {
    const value: unknown = JSON.parse(String(data));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as ChangeData) : null;
  } catch {
    return null;
  }
}

function open(): EventSource {
  const es = new EventSource('/api/events');
  es.addEventListener('change', (e) => {
    const data = parse((e as MessageEvent<unknown>).data);
    for (const s of [...subscribers]) s.listeners.change?.(data);
  });
  es.addEventListener('open', () => {
    // A reconnect may follow a server restart, which renews the page token: re-read it once, for every client.
    if (connects > 0) for (const client of new Set([...subscribers].map((s) => s.client))) void client.refreshToken();
    connects += 1;
    for (const s of [...subscribers]) s.listeners.open?.();
  });
  return es;
}

/** Listens to the server's events through the page's one stream, opened on first use; returns the unsubscribe. */
export function subscribeEvents(client: Pick<Client, 'refreshToken'>, listeners: EventListeners): () => void {
  const subscriber: Subscriber = { client, listeners };
  subscribers.add(subscriber);
  source ??= open();
  return () => {
    if (!subscribers.delete(subscriber) || subscribers.size > 0) return;
    source?.close();
    source = null;
    connects = 0;
  };
}
