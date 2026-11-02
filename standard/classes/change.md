---
class: class
name: change
division: governance
folder: governance/change
produced: log
thing: false
statuses: []
archive: []
required: []
optional: []
---
# change

The change stream: one note per release or month per component, named like `2026-10-dashboard`. Each entry is one
line; a fix adds a `fixes:` line naming the issue it closed.

```markdown
---
class: change
component: shared
---
# <yyyy-mm or release> <component>

- yyyy-mm-dd · applied · <what changed> (<commit>)
  fixes: <the issue, in one sentence>
```
