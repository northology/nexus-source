---
class: class
name: build-record
division: governance
folder: governance/builds
produced: log
thing: false
statuses: []
archive: []
required: [build]
optional: [components, nex-category]
---
# build-record

A build's final report: its lasting record of what it set out to do, what it delivered and why, written when the
build is decommissioned. One per build, named for it. It lists the components the build touched, links the notes it
left, and links its archived specs, plans, reports and audits in `superpowers/archive/<build>/`.

```markdown
---
class: build-record
component: shared
build: the-build-name
components: [the-component]
nex-category: build-record
---
# <build> final report
```
