import { unreadAnswers, type Waiting } from '../core/gates.ts';
import { skillCommand } from '../core/harness.ts';
import { activeBuilds } from '../core/lifecycle.ts';
import { findBuildRoot } from '../core/paths.ts';
import { PERMIT_MINUTES } from '../core/permits.ts';
import { currentPhase } from '../core/phases.ts';
import { findReviewsRoot, REVIEWS_DIR } from '../core/review-files.ts';
import { unappliedReviews } from '../core/reviews.ts';
import { readSnapshot } from '../core/snapshot.ts';

/** Sources `nexus ledger import` writes: "ruling" and "review", alone or followed by " · <where>". */
const IMPORTED = /^(?:ruling|review)(?: ·|$)/;

/** One line per active build, re-added every turn so it survives compaction. */
export function reminderLines(root: string): string[] {
  return activeBuilds(root).map((name) => {
    let stage = 'unknown';
    let phase = name;
    let accepted = 0;
    let imported = false;
    try {
      const s = readSnapshot(root, name, { progress: false });
      if (s.build) {
        stage = s.build.stage;
        phase = currentPhase(s.build);
      }
      accepted = s.guardrails.filter((g) => g.state === 'accepted').length;
      // A run with rulings or minors leaves entries; any imported run leaves a record on the phase's plan.
      imported =
        [...s.logs.decisions, ...s.logs.issues].some((e) => e.phase === phase && IMPORTED.test(e.source)) ||
        (s.plan?.plans ?? []).some((p) => p.phase === phase && p.record !== null);
    } catch {
      // still remind: the build is active even if its files are not readable right now
    }
    // The spec is written in the plan stage, after the scope gate moves the phase there, and then the plan; while
    // planning the spec is next, and in the build stage only plans are written.
    const folders = stage === 'plan' ? ['specs', 'plans'] : stage === 'build' ? ['plans'] : ['specs'];
    const parts = [
      `nexus: build ${name}`,
      `phase ${phase}`,
      `stage ${stage}`,
      `${accepted} ${accepted === 1 ? 'guardrail' : 'guardrails'} accepted`,
      ...folders.map((f) => `${f} → .build/${name}/documents/${f}/${phase}`),
      'rules → nexus guardrail propose',
      `show options → .build/${name}/concepts/<topic>/ + concept-pick gate; live refinements → log changes --topic`,
    ];
    if (stage === 'build') {
      if (!imported) parts.push("ledger → nexus ledger import before deleting the run's workspace");
      // A fresh session in the build stage may not have the plan skill loaded; this keeps the hand-off to the finish gate.
      parts.push(`finish → ${skillCommand('plan')} step 5`);
    }
    return parts.join(' · ');
  });
}

/** What to do with an approved permit: make the change while its window is open, otherwise only apply. */
function permitStep(w: Waiting, apply: string, now: Date): string {
  const until = Date.parse(w.submitted) + PERMIT_MINUTES * 60_000;
  if (!Number.isNaN(until) && now.getTime() < until) return `: make the change now, then apply with: ${apply}`;
  const when = Number.isNaN(until) ? 'an unreadable time' : new Date(until).toISOString();
  return `: the permit expired at ${when}; apply the gate with: ${apply}, and open a new permit gate if the change is still needed`;
}

/**
 * Reviews the user answered that the agent hasn't applied, in the repo whose `.nexus/reviews/` a session at cwd reaches.
 * Reviews outlive builds, so this runs with or without one. Anything unreadable is left out, never thrown.
 */
function reviewLines(cwd: string, cli: string): string[] {
  try {
    const root = findReviewsRoot(cwd);
    if (!root) return [];
    const waiting = unappliedReviews(root);
    if (!waiting.length) return [];
    return [
      'nexus: the user has answered a review in the cockpit.',
      ...waiting.map((s) => {
        const name = s.request.name;
        const file = [...REVIEWS_DIR, `${name}.answers.json`].join('/');
        // Applying closes the review's permits, so the changes come first.
        return `- review ${name} (submitted ${s.answers?.submitted ?? 'at an unknown time'}): read ${file}, make the changes its Adjust and Remove rows ask for, then apply with: node "${cli}" review apply ${name}`;
      }),
    ];
  } catch {
    return [];
  }
}

/**
 * UserPromptSubmit hook. Runs on every prompt in every repo, so it must be fast, and silent where there is neither an
 * active build nor an answered review. Returns the hook's stdout ('' for nothing).
 */
export function runHook(input: { cwd?: unknown }, opts: { cli: string; now?: Date }): string {
  const now = opts.now ?? new Date();
  if (typeof input.cwd !== 'string' || !input.cwd) return '';
  const root = findBuildRoot(input.cwd);
  const reviews = reviewLines(input.cwd, opts.cli);
  if (!root) return reviews.length ? context(reviews) : '';
  const { waiting, problems } = unreadAnswers(root);
  const lines: string[] = [];
  if (waiting.length || problems.length) {
    lines.push('nexus: the user has submitted gate answers in the cockpit.');
    for (const w of waiting) {
      const apply = `node "${opts.cli}" gate apply ${w.gate} --build ${w.build}`;
      // Applying closes a permit, so the change comes first.
      const next = w.permit ? permitStep(w, apply, now) : `. Apply with: ${apply}`;
      lines.push(`- ${w.build} / ${w.gate} (submitted ${w.submitted}): ${w.summary}${next}`);
    }
    for (const p of problems) lines.push(`- Could not read ${p.file}: ${p.message}`);
  }
  lines.push(...reviews, ...reminderLines(root));
  return lines.length ? context(lines) : '';
}

function context(lines: string[]): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join('\n') } });
}
