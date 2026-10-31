# Assumptions

This file records design decisions and assumptions made where the spec was ambiguous.

1. **`DB_NAME` default**: When `DB_NAME` is not set in `.env`, default to `bugbound` as stated in section 9.
2. **SHA hash lengths**: `manifestHash8` uses the first 8 hex chars of the SHA-256 hash. Simulation IDs use the full SHA-1 of the canonicalized change.
3. **`SAFE` nodes in affected array**: SAFE nodes are NOT included in the `affected` array of the impact report. They are computed as a count (total components minus target minus affected). The UI dims them on the graph.
4. **Score label thresholds**: Inclusive ranges — 0-24 LOW, 25-49 MEDIUM, 50-74 HIGH, 75-100 CRITICAL.
5. **Propagation stop for type/config/package**: "stop at depth 2" means depth 2 nodes are included as AT_RISK, but depth 3+ are not reached via static edges. Dynamic edges always produce UNCERTAIN regardless of depth (up to the hard limit of 5).
6. **Worst status ordering**: BROKEN > AT_RISK > UNCERTAIN. When a node is reachable via multiple paths, keep the worst status and the shortest path.
7. **Event `eventId` generation**: When not provided, use `<projectId>:<type>:<timestamp>` as a default eventId.
8. **Demo project name**: The seed endpoint creates a project called "ShopLite Demo" as specified in Step 8.
9. **Rate limiting**: Simple in-memory counter-based rate limiting (not Redis-backed) since this is a hackathon project.
10. **Change stream fallback**: If change streams are unavailable (e.g., standalone MongoDB), fall back to polling the events collection every 3 seconds.
