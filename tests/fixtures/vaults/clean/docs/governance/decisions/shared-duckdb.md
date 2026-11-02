---
class: decision
component: shared
status: accepted
build: duckdb-merge
supersedes: ["[[governance/archive/decisions/two-databases]]"]
---
# One shared DuckDB serves every app

**Decision:** API and the dashboard read the same database.

**Why:** One copy of the data, one set of costs.
