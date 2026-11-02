---
class: class
name: pipeline
division: data
folder: data/pipelines
produced: authored
thing: true
statuses: []
archive: []
required: []
optional: []
---
# pipeline

How data moves: sources, stages and schedule. `source` is the pipeline's code path or job name.

```markdown
---
class: pipeline
component: shared
source: path/to/pipeline
uses: []
feeds: []
---
# <Pipeline name>

## Stages

## Schedule and failure handling
```
