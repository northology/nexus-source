# Relay rebuild: design

Failed relays are retried automatically, and anything still failing lands in a replay queue, so nobody re-sends
by hand after an outage. Lag per source is visible on the status page.

```mermaid
flowchart LR
  queue[Replay queue store]:::done --> retry[Automatic retry]:::pending
  queue --> replay[Manual replay]:::pending
  retry --> lag[Per-source lag view]:::needs
  replay --> lag
  classDef done stroke-width:1.5px
  classDef pending stroke-dasharray:4 3
  classDef needs stroke:#E63B2E
```

| Piece | Lane | Depends on |
|---|---|---|
| Replay queue store | ingest | none |
| Automatic retry | relay | Replay queue store |
| Manual replay | relay | Replay queue store |
| Per-source lag view | status page | Automatic retry, Manual replay |

## Open items

- [x] Message format stays unchanged
- [ ] Alerting channel (see open questions)
