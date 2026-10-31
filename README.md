# BugBound

> **One tiny code change. How much of your application does it break?**

**Pitch:** BugBound builds a dependency graph of your application and simulates what a proposed change would break — showing the cascading chain reaction, the blast radius score, and the components that need manual review, before you deploy.

- **Live Deployment:** [https://mangodb-90n3.onrender.com/](https://mangodb-90n3.onrender.com/)
- **Demo Video:** <!-- TODO: Add demo video link before submission (max 7 min walkthrough) --> [Watch 7-minute Walkthrough](TODO_DEMO_VIDEO_URL) *(TODO: Insert YouTube link before final submission)*
- **Hackathon Track:** UNCHARTED 2026 (NEXUS × SVNIT Surat) — Track 3: *Developer Tools for Production Use Cases*

---

## 1. The Problem & Who It Is For

Modern microservices, APIs, and web apps suffer from hidden coupling:
- A developer renames a database field (`user_name` → `username`), unaware that an analytics dashboard reads it dynamically through an intermediate API.
- A team changes a timeout configuration, causing cascading timeouts in downstream payment workers.
- A package upgrade introduces a breaking change on an edge where a deprecated method is consumed.

Traditional unit tests often miss cross-service and multi-layer dependency failures, while running full end-to-end integration test suites is slow and expensive.

**Who BugBound is for:**
- **Full-Stack Engineers & Tech Leads:** Propose "what-if" refactors and instantly visualize the blast radius before writing code.
- **DevOps & Release Engineers:** Inspect risk before approving pull requests or running database migrations.
- **Production QA Teams:** Identify exactly which downstream consumers and dynamic edges require manual regression testing.

---

## 2. Key Features

- **Interactive Dependency Graph (Cytoscape.js):** Visualizes components by type (`field`, `api`, `function`, `page`, `service`, `config`, `package`) with directed edges (`reads`, `writes`, `calls`, `renders`, `configures`, `imports`).
- **Animated Chain Reaction:** When a change is simulated, impact propagates level-by-level across the graph with real-time visual reveal and edge highlighting.
- **Honest Severity Labeling:**
  - 🔴 **BROKEN:** Static consumer of a deleted/renamed component or broken contract.
  - 🟠 **AT_RISK:** Downstream dependency (depth 2+) or config change.
  - 🟡 **UNCERTAIN (Dashed):** Any path flowing through dynamic bracket access (`obj[variableKey]`). Never guessed — marked for manual review!
  - 🟢 **SAFE (Dimmed):** Unaffected nodes in the topology.
- **Blast-Radius Score (0 to 100):** Weighted by component business criticality (1–5), severity weight, and distance decay factor.
- **Deterministic & Idempotent (MongoDB):**
  - Canonical JSON hashing (SHA-256 for manifests, SHA-1 for changes).
  - Re-running an identical simulation returns the cached record instantly without duplicate work.
  - Uploading an identical manifest returns `200 duplicate` without duplicating data.
- **Side-by-Side Simulation Comparison:** Compares two changes using MongoDB aggregations (`$setDifference` and `$setIntersection`) to show "Only in A", "Only in B", "In Both", and score differences.
- **Production MongoDB Analytics:** Chart.js trends, fragile component rankings, and dependency hotspots.
- **Live Event Stream (SSE):** Real-time Server-Sent Events fed by MongoDB Change Streams (with automatic fallback to polling).
- **One-Click ShopLite Demo:** Instant seeding of a realistic 22-component e-commerce system.

---

## 3. How It Works

### Architecture Diagram

```
+-------------------------------------------------------------------------+
|                               Browser UI                                |
|  - Cytoscape.js (Interactive Graph & Animated Chain Reaction)           |
|  - What-If Simulation Panel                                             |
|  - Impact Report & Blast-Radius Gauge                                   |
|  - History & Simulation Compare Modal                                   |
|  - Live SSE Event Feed                                                  |
+------------------------------------+------------------------------------+
                                     |  HTTP REST / SSE
                                     v
+------------------------------------+------------------------------------+
|                       Node.js 20 / Express Server                       |
|  [routes/projects]   [routes/simulations]   [routes/analytics]  [demo]  |
|  - Rate Limiter (60 req/min)                - 5MB Body Limit (413)      |
+------------------+----------------------------------+-------------------+
                   |                                  |
                   v (Pure in-memory)                 v (Official Driver)
+------------------+---------------+   +--------------+-------------------+
|         BugBound Engine          |   |          MongoDB Atlas           |
|  - validateManifest.js           |   |  - graph_versions (SHA-256)      |
|  - buildGraph.js                 |   |  - components ($jsonSchema)      |
|  - propagate.js (Reverse BFS)    |   |  - dependency_edges ($jsonSchema)|
|  - score.js (Blast Radius)       |   |  - simulations (SHA-1, cached)   |
|  - simulate.js (Orchestrator)    |   |  - impact_reports (chains)       |
|  - hash.js (Canonical JSON)      |   |  - events (Change Stream -> SSE) |
+----------------------------------+   +----------------------------------+
```

### Propagation Rules

Changes propagate backwards from the modified component (since in the manifest `from` depends on `to`, impact flows from `to` to `from`):

| Change Type | Depth 1 (Static Edge) | Depth 1 (Dynamic Edge) | Depth 2+ (Static) | Depth 2+ (Dynamic on Path) |
|---|---|---|---|---|
| `RENAME_FIELD`, `DELETE_FIELD`, `DELETE_ENDPOINT`, `CHANGE_FUNCTION_SIGNATURE` | **BROKEN** | **UNCERTAIN** | **AT_RISK** | **UNCERTAIN** |
| `CHANGE_FIELD_TYPE`, `CHANGE_CONFIG`, `UPGRADE_DEPENDENCY_MAJOR` | **AT_RISK** | **UNCERTAIN** | **AT_RISK** (depth 2 only) | **UNCERTAIN** |

- If `edge.meta.usesRemovedApi === true` for `UPGRADE_DEPENDENCY_MAJOR`, the status is **BROKEN**.
- If `edge.kind === "writes"` for `RENAME_FIELD`, the writer is **BROKEN** (writing to a nonexistent key).
- Worst status wins if a node is reachable via multiple paths (`BROKEN` > `AT_RISK` > `UNCERTAIN`).
- Hard cutoff at depth 5 to prevent infinite runaway on cyclical graphs.

### Blast-Radius Formula (0 to 100)

$$\text{decay}(\text{depth}) = \frac{1}{1 + 0.25 \times (\text{depth} - 1)}$$

$$\text{weight}(\text{status}) = \begin{cases} 1.0 & \text{BROKEN} \\ 0.5 & \text{AT\_RISK} \\ 0.25 & \text{UNCERTAIN} \end{cases}$$

$$\text{raw} = \sum_{\text{affected}} \left( \text{criticality} \times \text{weight}(\text{status}) \times \text{decay}(\text{depth}) \right)$$

$$\text{max} = \sum_{\text{all except target}} \text{criticality}$$

$$\text{score} = \text{round}\left( \min\left(100, \frac{\text{raw}}{\text{max}} \times 100 \times 1.5\right) \right)$$

*Labels:* `0-24 LOW`, `25-49 MEDIUM`, `50-74 HIGH`, `75-100 CRITICAL`.

---

## 4. How We Use MongoDB (Track Requirements)

BugBound uses official MongoDB driver primitives across every layer:

| Track Requirement | MongoDB Feature | Our Implementation | Source File |
|---|---|---|---|
| **Runs / Events with stable IDs** | Unique Compound Indexes & IDs | `_id: "<versionId>:<sha1(change)>"` for simulations, `eventId` with idempotent deduplication | [src/db/events.js](file:///d:/Project-C/MangoDB/src/db/events.js), [src/routes/simulations.js](file:///d:/Project-C/MangoDB/src/routes/simulations.js) |
| **Indexes for common queries** | Compound & Unique Indexes | `{ versionId: 1, to: 1 }` (reverse BFS), `{ projectId: 1, score: -1 }`, `{ projectId: 1, at: -1 }` | [src/db/setup.js](file:///d:/Project-C/MangoDB/src/db/setup.js) |
| **Schema validation** | `$jsonSchema` (`strict`, `error`) | Validates required fields on `components`, `dependency_edges`, and `events`, while leaving `meta`, `params`, and `details` flexible | [src/db/setup.js](file:///d:/Project-C/MangoDB/src/db/setup.js#L54-L125) |
| **Aggregation Pipelines** | Multi-stage Aggregations | Top blast rankings, fragile components with `$switch` severity weighting, hotspots lookup | [src/services/analytics.js](file:///d:/Project-C/MangoDB/src/services/analytics.js) |
| **Set Comparison Aggregation** | `$setDifference` & `$setIntersection` | Direct pipeline comparison of two simulations to compute "onlyInA", "onlyInB", and "inBoth" | [src/services/analytics.js](file:///d:/Project-C/MangoDB/src/services/analytics.js#L20-L168) |
| **Change Streams for Live Feed** | Collection Watch (`watch()`) | Change stream on `events` (insert only), fanning out to clients via Server-Sent Events (SSE) | [src/services/stream.js](file:///d:/Project-C/MangoDB/src/services/stream.js) |
| **Idempotent repeated ingestion** | Unique Index Error Handling | Code 11000 duplicate handling: duplicate manifests return `200 duplicate`; duplicate changes return `200 cached` | [src/routes/projects.js](file:///d:/Project-C/MangoDB/src/routes/projects.js), [src/routes/simulations.js](file:///d:/Project-C/MangoDB/src/routes/simulations.js) |
| **Practical failure handling** | HTTP 400, 413, 422, 429 | Schema validation errors return 422 with all reasons; payload limit returns 413; rate limit returns 429 | [src/server.js](file:///d:/Project-C/MangoDB/src/server.js) |

---

## 5. Demo Walkthrough (Section 13)

1. **Load ShopLite Demo:** Click **Load ShopLite Demo** on the sidebar. The 22-component graph renders immediately with force-directed physics.
2. **Simulate Rename `user_name`:**
   - Select Quick Scenario: `Rename user_name`.
   - Click **Run Impact Simulation**.
   - Watch the animated chain reaction reveal:
     - Profile Page, Dashboard Page, `api.get_user`, `fn.formatName`, Email Service → 🔴 **BROKEN** (5 broken — static reads of `user_name`)
     - Notification Service → 🟠 **AT_RISK** (depth 2, reaches field via email-service)
     - Analytics Page → 🟡 **UNCERTAIN** (dynamic edge `data[key]`)
     - Settings Page → 🟢 **SAFE** (reads `users.email`, not `user_name`)
     - Blast Radius: **41 MEDIUM** (5 broken, 1 at-risk, 1 uncertain).
3. **Run Identical Simulation Again:**
   - Click **Run Impact Simulation** again with the same parameters.
   - Response returns in ~2ms with `⚡ Cached Result (Idempotent)` badge.
4. **Compare Simulations:**
   - Run simulation for `Delete email field`.
   - Go to the **History** tab, select both checkboxes, and click **Compare (2 Selected)**.
   - Inspect the side-by-side comparison generated via MongoDB `$setDifference` and `$setIntersection`.
5. **Demonstrate Failure Handling:**
   - Click **Try Broken Manifest (422)**.
   - The server catches missing nodes and self-loops, rejecting the payload with a complete list of 422 validation reasons.
   - Click **Upload ShopLite v2** twice to show graph versioning and duplicate detection.

---

## 6. API Reference

| Method | Endpoint | Description | Status Codes |
|---|---|---|---|
| `GET` | `/api/health` | Health check and MongoDB Atlas ping | `200` |
| `POST` | `/api/projects` | Create a new project | `201`, `400`, `409` |
| `GET` | `/api/projects` | List all projects | `200` |
| `POST` | `/api/projects/:id/manifest` | Upload manifest (validated, hashed, idempotent) | `201`, `200 (dup)`, `400`, `413`, `422` |
| `GET` | `/api/projects/:id/versions` | List graph versions for a project | `200` |
| `GET` | `/api/versions/:vid/graph` | Fetch graph components & edges for visualization | `200`, `404` |
| `POST` | `/api/versions/:vid/simulate` | Run what-if simulation (cached if identical) | `201`, `200 (cached)`, `400`, `422` |
| `GET` | `/api/projects/:id/simulations` | List simulation history (newest first) | `200` |
| `GET` | `/api/simulations/:sid` | Get full report joined with summary | `200`, `404` |
| `GET` | `/api/compare?a=:id&b=:id` | Compare two simulations via MongoDB aggregation | `200`, `400`, `404` |
| `GET` | `/api/projects/:id/analytics` | Get blast rankings, fragile components & hotspots | `200` |
| `GET` | `/api/projects/:id/events` | Audit trail of last 50 events | `200` |
| `GET` | `/api/stream` | Server-Sent Events (SSE) live feed | `200 (text/event-stream)` |
| `POST` | `/api/demo/seed` | Seed ShopLite Demo project | `201`, `200` |
| `GET` | `/api/demo/samples/:name` | Serve sample manifests (`shoplite`, `shoplite-v2`, `invalid`) | `200`, `404` |

---

## 7. Local Setup & Testing

### Prerequisites
- Node.js 20+
- MongoDB Atlas cluster or local MongoDB instance

### Installation
```bash
# 1. Clone repository
git clone https://github.com/mishitadudhaiya-code/MangoDB.git
cd MangoDB

# 2. Install dependencies (zero dev dependencies needed!)
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your MONGODB_URI

# 4. Verify database connection and indexes
npm run db:check

# 5. Run automated test suite (61 tests)
npm test

# 6. Start the server
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 8. Limitations & Honest Engineering (Important)

- **Static Potential Impact Estimates:** All simulation outputs are potential impact estimates based on a static dependency model, not execution guarantees or certainty. BugBound models architectural contracts and does not execute your code or observe production memory.
- **Dynamic Access is UNCERTAIN:** Dynamic property access (`obj[variableKey]`) cannot be resolved statically. Rather than guessing, BugBound explicitly labels it `UNCERTAIN` for engineer review.
- **Manifest-Based Input:** Input is a project dependency manifest (JSON) or lightweight regex snippet scanner, not a full compiler.
- **Depth Cutoff:** Propagation stops at depth 5 to bound computational complexity on cyclic graphs.
- **Out of Scope (By Design):**
  - Full-language parsing and whole-repository AST analysis (beyond lightweight regex scanner for common JS/Python patterns)
  - Runtime tracing and production memory observation
  - Static type inference engine
  - Authentication, multi-tenancy, and multi-user access control
  - Direct GitHub / VCS webhook integration
  - LLM-based hallucinated code fixes

---

## 9. Tech Stack & Dependencies

- **Runtime:** Node.js 20 LTS
- **Web Framework:** Express 4
- **Database:** MongoDB 6 Driver (Official MongoDB Node.js driver — no ORM/ODM)
- **Frontend:** Vanilla HTML5, CSS3, JavaScript (no bundling required)
- **Visualization:** [Cytoscape.js](https://js.cytoscape.org/) (graph canvas), [Chart.js](https://www.chartjs.org/) (analytics)
- **Testing:** Node.js built-in `node:test` and `node:assert`
- **Utility Libraries:** `cors`, `compression`, `dotenv`

---

## 10. Team

- **Hackathon:** UNCHARTED 2026 (NEXUS × SVNIT Surat)
- **Track 3:** Developer Tools for Production Use Cases
- **Team Name:** MangoDB
- **Members:**
  - Margi Chaudhary
  - Mishita Dudhaiya
  - Heshika Pareek
