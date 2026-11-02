# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript. The cockpit is compiled to static files and served by a small, dependency-free Node
server that ships inside the `nexus` plugin, so it runs in any repo without installing anything there. Node is
assumed present on the machine.

## Users

- **Primary:** the developer running the build (today, its author alone). An expert who knows the build, working at a
  desktop, alongside the agent's session in the harness. They review and steer; the agent does the writing.
- **Future:** others the package may be handed to, such as junior analysts or a partner, who would use it on
  their own repos or to align their projects to the same way of working. The cockpit should make sense to someone
  who wasn't in the planning conversation.

## Product Purpose

`nexus` is a temporary cockpit for one build. It opens at the start of planning and stays for the life of the
build. It does two jobs:

1. **Holding area.** In-flight material lives here: the planning log, the plan, gates, concepts, notes and
   scratch files. None of it touches the repo's permanent docs.
2. **Steering surface.** It shows where the build stands, what's decided and what's open. It puts review gates in
   front of the user so they can confirm, decline, adjust statuses or pick concepts without retyping in chat.

At completion the keepers are moved into the repo's permanent `docs/` vault and the build's folder is removed.

Success means:
- the user can see where a build stands without reading prose;
- reviews at gates are faster and more accurate than in chat;
- a fresh agent session can pick up the build from it;
- it never grows into a governance system.

## Positioning

It is a cockpit, not a log. It replaces a tool that produced long free-text logs. Data underpins every view;
visuals come first and prose appears only where it adds value. It lives with the build (committed on the
build's branch) and disappears when the build is done.

## Operating Context

- Runs locally on desktop, launched by a nexus skill. Mobile is a later pass, not part of this version.
- Always open on a second monitor beside the terminal for the whole session, glanced at often. Screens range
  from 1080p to 1440p. Work happens mostly at a home desk in lower light, sometimes in an office with a similar
  setup.
- One cockpit per checkout, showing the build in that working tree. Builds live in `.build/<name>/`.
- Lifecycle: planning → plan → build → close-out.
- Gate types: confirm/decline a list; adjust statuses; pick between concepts (linked HTML pages); approve or send
  back.
- Bigger steering happens in the conversation with the agent or through markdown notes in the build folder, not in the
  cockpit.
- Used across different kinds of work: ML/AI, frontend design, data viz.

## Capabilities and Constraints

- The agent is the main writer. The cockpit writes only the user's gate-answer files, and the agent never writes those.
- The user's controls are structured (confirm, decline, status changes, picks). There is no free-form editing.
- Decision states: exploring, research, accepted, declined. Declined items can be deleted.
- Readable names only. No coded IDs (no "D01", "E43").
- Specs, plans and notes are markdown in the build folder and are read and reviewed in the cockpit's
  reading view, not in an editor.
- Workstream-neutral: nothing specific to an organization is baked in.
- Not built on Obsidian Bases.
- Build-phase tooling (process maps, tracing diagrams, concept sessions) will grow over time. This version must
  leave room for it.
- The plugin ships a basic deployable foundation, not every scenario. Specialised tools (for example a panel for
  a complex AI/ML process like clustering) are added from the destination repo as extensions. Each one appears
  as its own section on the rail and follows the same visual system and writing rules.

## Brand Commitments

- Neutral, standalone tool identity named `nexus`. No organization branding.
- Lean, Scandinavian-minimal and well designed overall, so there's room for detailed tool and reporting views.
- Light and dark themes, with a switch. Both must be first-class.
- Feels wrong if it looks like:
  - a corporate dashboard (KPI tiles, stock SaaS cards);
  - a process-heavy governance or ticketing tool;
  - something playful or gamified;
  - something so sparse it hides the state.
- Process-heavy *areas* are allowed where the work is genuinely complex (for example dynamic and long-horizon
  workflow planning tools), as dedicated sections, not as the cockpit's overall character.
- Informative reference, not binding: the author's own UI pattern brief. Take its Swiss skeleton, data-esque
  interface language and contemplative pace; leave out its brand-specific motifs.

## Evidence on Hand

None yet. Any example builds shown in mockups are illustrative and must not be presented as real.

## Product Principles

1. **What needs you comes first.** An open gate is the default view; status fills in when nothing waits on the
   user.
2. **Data over prose.** Show state, not paragraphs about state.
3. **Temporary by design.** Everything here is in flight; the permanent record lives elsewhere.
4. **One writer, clear gates.** The agent writes; the user acts at defined gates, never mid-run.
5. **No governance creep.** Every addition has to make steering easier, not add process.
