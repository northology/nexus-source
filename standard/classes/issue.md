---
class: class
name: issue
division: governance
folder: governance/issues
produced: log
thing: false
statuses: [open, deferred]
archive: []
required: []
optional: []
---
# issue

A real problem still to fix (`open`) or knowingly put off (`deferred`). When it's fixed, the note is deleted and the
change entry carries a `fixes:` line. A declared non-issue is deleted too.

```markdown
---
class: issue
component: shared
status: open
relates: []
---
# <The problem, in one line>

## What happens

## Where
```
