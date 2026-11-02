import { useEffect, useMemo, useRef } from 'react';
import { createClient } from './api/client.ts';
import { pageToken } from './api/token.ts';
import { BuildPicker } from './components/BuildPicker.tsx';
import { Empty } from './components/Empty.tsx';
import { Problems } from './components/Problems.tsx';
import { Rail } from './components/Rail.tsx';
import { TopBar, type Mode } from './components/TopBar.tsx';
import { useCockpit } from './hooks/useCockpit.ts';
import { usePrefs } from './hooks/usePrefs.ts';
import { useRepo } from './hooks/useRepo.ts';
import { useRoute } from './hooks/useRoute.ts';
import { GUIDANCE_ITEM, railItems, type RailItem } from './lib/rail.ts';
import { repoName, repoRailItems } from './lib/repo.ts';
import { keepBuild, withParams, type Route } from './lib/route.ts';
import { GuidanceView } from './views/GuidanceView.tsx';
import { VIEWS } from './views/index.ts';
import { RepoView } from './views/RepoView.tsx';

export function App() {
  const client = useMemo(() => createClient({ token: pageToken() }), []);
  const [route, navigate] = useRoute();
  const prefs = usePrefs();
  const { load, offline, failed, refresh } = useCockpit(client, route.params['build'] ?? null);
  const { repo, error: repoError } = useRepo(client);
  // Each side keeps its last route, so the switch goes back to where the viewer was. Guidance belongs to neither.
  const lastBuild = useRef<Route | null>(null);
  const lastRepo = useRef<Route | null>(null);
  const side = useRef<Mode>(route.category === 'repo' ? 'repo' : 'build');
  useEffect(() => {
    if (route.category === 'repo') lastRepo.current = route;
    else if (route.category !== 'guidance') lastBuild.current = route;
  }, [route]);
  // The open build travels with the switch, so Build comes back to it rather than to the picker.
  const onMode = (m: Mode) => {
    const build = route.params['build'] ?? null;
    if (m === 'repo') navigate(lastRepo.current ? withParams(lastRepo.current, { build }) : { category: 'repo', sub: 'overview', params: keepBuild(route) });
    else navigate(lastBuild.current ?? { category: 'gate', sub: null, params: keepBuild(route) });
  };
  // The landing, once per page load: a checkout with no build, opened with no route, opens on Repo › Overview.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || load.state === 'loading') return;
    landed.current = true;
    if (load.state === 'empty' && window.location.hash.replace(/^#\/?/, '') === '') navigate({ category: 'repo', sub: 'overview', params: {} }, { replace: true });
  }, [load.state, navigate]);
  const repoTitle = repoName(repo);
  // Guidance needs no build, so it opens whatever state the build is in. It is always main's first child, so it stays
  // mounted (scroll and drawn diagrams kept) when the build becomes ready under it.
  const guide = route.category === 'guidance' ? <GuidanceView route={route} navigate={navigate} client={client} theme={prefs.theme} /> : null;

  // Guidance belongs to neither side, so it opens in the shell of the side it was opened from (a fresh page that opens
  // on it shows the Build shell). Set during render from the route alone, so a repeated render gives the same answer.
  if (route.category === 'repo') side.current = 'repo';
  else if (route.category !== 'guidance') side.current = 'build';

  // Narrows route.category, so VIEWS (the build side's views) is only indexed by a build-side category below.
  if (route.category === 'repo' || (route.category === 'guidance' && side.current === 'repo')) {
    return (
      <div className="app">
        <TopBar build={null} mode="repo" onMode={onMode} repoTitle={repoTitle} theme={prefs.theme} onTheme={prefs.setTheme} />
        <Rail items={repoRailItems(repo)} route={route} builds={[]} build="" zone={prefs.zone} onZone={prefs.setZone} onBuild={() => {}} />
        <main id="main">
          {guide}
          {!guide && repoError !== null && repo === null && (
            <Empty title="The repo could not be read">The server answered “{repoError}”. This page tries again whenever the server reports a change or reconnects.</Empty>
          )}
          {!guide && repo === null && repoError === null && (
            <p className="frame-msg" aria-busy="true">
              Reading the repo…
            </p>
          )}
          {!guide && repo !== null && <RepoView repo={repo} route={route} navigate={navigate} client={client} zone={prefs.zone} theme={prefs.theme} />}
        </main>
      </div>
    );
  }

  if (load.state !== 'ready') {
    // The rail holds Guidance, and a way back to the build's state: the picker, or why there's no build yet.
    const back: RailItem = { category: 'gate', label: load.state === 'choose' ? 'Builds' : 'Build', count: '', needs: false, cells: [] };
    return (
      <div className="app">
        <TopBar build={null} mode="build" onMode={onMode} repoTitle={repoTitle} theme={prefs.theme} onTheme={prefs.setTheme} />
        <Rail items={[back, GUIDANCE_ITEM]} route={route} builds={[]} build="" zone={prefs.zone} onZone={prefs.setZone} onBuild={() => {}} />
        <main id="main">
          {guide}
          {!guide && load.state === 'loading' && (
            <p className="frame-msg" aria-busy="true">
              Loading the build…
            </p>
          )}
          {!guide && load.state === 'offline' && (
            <Empty title="Can't reach the nexus server">
              Start it again with <code>nexus serve</code>, or ask the agent to. This page reconnects by itself.
            </Empty>
          )}
          {!guide && load.state === 'error' && (
            <Empty title="The build could not be loaded">
              The server answered “{load.message}”. This page tries again when the build changes; reloading it also retries.
            </Empty>
          )}
          {!guide && load.state === 'empty' && (
            <Empty title="No build in this checkout yet">
              Ask the agent to start one, or run <code>nexus new &lt;name&gt;</code> in the terminal. It shows up here as soon as it
              exists. New to nexus? <a href="#/guidance">Read the Guidance</a>.
            </Empty>
          )}
          {!guide && load.state === 'choose' && <BuildPicker builds={load.builds} onPick={(b) => navigate(withParams(route, { build: b }))} />}
        </main>
      </div>
    );
  }

  const { snapshot, build, builds } = load;
  const View = VIEWS[route.category];
  return (
    <div className="app">
      <TopBar build={snapshot.build} mode="build" onMode={onMode} repoTitle={repoTitle} theme={prefs.theme} onTheme={prefs.setTheme} />
      <Rail
        items={railItems(snapshot)}
        route={route}
        builds={builds}
        build={build}
        zone={prefs.zone}
        onZone={prefs.setZone}
        onBuild={(b) => navigate({ category: 'gate', sub: null, params: { build: b } })}
      />
      <main id="main">
        {guide}
        {!guide && offline !== null && (
          <p className="offline" role="status">
            Lost the connection to the nexus server; showing the last state. Reconnecting…
          </p>
        )}
        {!guide && offline === null && failed !== null && (
          <p className="offline" role="status">
            Could not refresh the build: the server answered “{failed}”. Showing the last state; it tries again when the build changes.
          </p>
        )}
        {!guide && <Problems problems={snapshot.problems} />}
        {!guide && <View build={build} snapshot={snapshot} route={route} navigate={navigate} client={client} zone={prefs.zone} theme={prefs.theme} refresh={refresh} />}
      </main>
    </div>
  );
}
