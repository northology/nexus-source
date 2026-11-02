import { describe, expect, it } from 'vitest';
import type { Route } from '@playwright/test';
import { guarded } from './e2e/fixtures.ts';

// The handlers never touch the route here: each one only throws, or doesn't.
const route = {} as Route;

describe('guarded: an e2e route handler still out as its test ends', () => {
  it.each([
    'apiResponse.json: Response has been disposed',
    'route.fetch: Test ended.',
    'route.fulfill: Target page, context or browser has been closed',
    'route.fetch: Test timeout of 30000ms exceeded.',
  ])('lets go of "%s"', async (message) => {
    await expect(guarded(() => Promise.reject(new Error(message)))(route)).resolves.toBeUndefined();
  });
  it('rethrows anything else, so a real failure in a handler still fails its test', async () => {
    await expect(guarded(() => Promise.reject(new Error('the repo fixture has no rule note')))(route)).rejects.toThrow('the repo fixture has no rule note');
    await expect(guarded(() => Promise.reject(new TypeError("Cannot read properties of undefined (reading 'items')")))(route)).rejects.toThrow(TypeError);
    // Not an Error at all: never taken for teardown.
    await expect(guarded(() => Promise.reject('Test ended'))(route)).rejects.toBe('Test ended');
  });
  it('runs the handler with its route and returns nothing', async () => {
    const seen: Route[] = [];
    await expect(guarded(async (r) => void seen.push(r))(route)).resolves.toBeUndefined();
    expect(seen).toEqual([route]);
  });
});
