---
class: class
name: report
division: superpowers
folder: superpowers/archive
produced: authored
thing: false
statuses: []
archive: []
required: [build]
optional: []
---
# report

An archived report: a build's review, audit or results write-up. Kept under `superpowers/archive/<build>/` with the
rest of its build. The final report is a build-record instead, in `governance/builds/`.

```markdown
---
class: report
component: shared
build: the-build-name
---
# <Report title>
```
