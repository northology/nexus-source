import type { Snapshot } from '../../../core/types.ts';
import type { Client } from '../api/client.ts';
import type { Navigate } from '../hooks/useRoute.ts';
import type { Theme } from '../lib/prefs.ts';
import type { Route } from '../lib/route.ts';

export interface ViewProps {
  build: string;
  snapshot: Snapshot;
  route: Route;
  navigate: Navigate;
  client: Client;
  zone: string;
  theme: Theme;
  refresh: () => void;
}
