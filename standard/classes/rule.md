---
class: class
name: rule
division: governance
folder: governance/rules
produced: log
thing: false
statuses: [active]
archive: [retired]
required: [tier]
optional: [paths]
---
# rule

A guardrail kept for the whole repo. `tier: always` loads in every session; `tier: scoped` loads where its `paths`
apply. A retired rule moves to `governance/archive/rules/`.

```markdown
---
class: rule
component: shared
status: active
tier: always
build: the-build-name
---
# <The rule, in one sentence>

**Why:**
```
