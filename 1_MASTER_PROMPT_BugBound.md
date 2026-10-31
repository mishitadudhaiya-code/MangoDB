# BugBound: Master Project Prompt

> **How to use:** Save this in your repo root as `PROJECT_CONTEXT.md`. Start every Antigravity chat with: *"Read PROJECT_CONTEXT.md first and follow it strictly."* Then use `2_STEP_PROMPTS_BugBound.md` one step at a time.

---

## 1. Role

You are a senior full-stack engineer pair-programming with a 3-person student team at a 24-hour hackathon (UNCHARTED 2026, NEXUS x SVNIT Surat, Track 3: Developer Tools for Production Use Cases). Time is very short. Prefer simple, working, deployable code over clever code. Never leave the project broken between steps. Write code, then give a 3-line summary of what changed and how to test it.

## 2. What we are building

**BugBound** is a change-impact analysis tool. A developer describes a project as a dependency graph (APIs, database fields, functions, pages, services, configs, packages), proposes a "what-if" change (rename a field, delete an endpoint, change a config, upgrade a dependency), and BugBound traces the chain reaction through the graph, labels each affected component **BROKEN / AT_RISK / UNCERTAIN / SAFE**, gives a **blast-radius score**, and stores every simulation in MongoDB so impacts can be compared over time.

**Tagline:** One tiny code change. How much of your application does it break?

**One-sentence pitch:** BugBound builds a dependency graph of your project and simulates what a proposed change would break, showing the chain reaction, the blast radius and the components that need manual review, before you deploy.

### Honesty rules (important for judges)
- This is **static, rule-based impact analysis**, not execution. Results are **potential impact estimates**. Use the words "potentially", "estimated", and "needs review" in the UI and README. Never claim certainty.
- Dynamic access (e.g. `obj[variableKey]`) can't be resolved statically, so it is reported as **UNCERTAIN**, not guessed. This is a feature, and we show it in the demo.
- We do not understand arbitrary repositories. Input is a **project manifest (JSON)**, optionally built by our lightweight **source scanner** for simple JS/Python patterns.

## 3. Hackathon rules that affect the code

- Build window: 30 Oct 9:00 PM to **31 Oct 9:00 PM IST**. Write everything from scratch in this window. Third-party libraries are fine; list them in the README.
- **Live deployment is compulsory** (public URL). A local-only demo is not accepted. Deploy a skeleton early.
- Public/accessible repo with a **clear README**.
- **No secrets in the repo.** Use `.env`, add to `.gitignore`, commit `.env.example`.
- **Code freeze after the deadline.** No commits or deployment changes after submission. No auto-commit or scheduled-deploy automation.
- Scoring: Technical implementation 25%, Functionality & deployment 25%, Innovation 20%, Problem relevance 20%, Demo & documentation 10%.
- Follow any AI-use policy the organizers announce. We must be able to explain every part of the code in Q&A.

## 4. Track requirements we must visibly satisfy (MongoDB)

| Requirement | Our implementation |
|---|---|
| Runs/events with stable IDs, timestamps, links to project/version | `graph_versions`, `simulations`, `impact_reports`, `events` with deterministic `_id`s, `createdAt`, `projectId`, `versionId` |
| Indexes for common questions | Compound indexes in section 9 |
| Aggregations to compare runs / derive findings | Blast-radius ranking, fragile-component hotspots, simulation comparison via `$setDifference` |
| Schema validation for required fields, flexible payloads | `$jsonSchema` on `components`, `dependency_edges`, `events`; `meta` and `params` stay free-form |
| Change streams for live views | One change stream on `events`, pushed to the browser via Server-Sent Events |
| Idempotent repeated ingestion | Unique manifest hash per project; deterministic simulation `_id`; unique `eventId` |
| One practical failure case | Duplicate manifest upload, re-run of an identical simulation (cached), invalid manifest (422), incomplete input (400) |

## 5. Tech stack

- **Backend:** Node.js 20 + Express, official `mongodb` driver (no Mongoose).
- **Database:** MongoDB Atlas free tier (replica set, needed for change streams).
- **Frontend:** static files from `/public`, plain HTML + CSS + vanilla JS. Graph rendering with **Cytoscape.js** from cdnjs; Chart.js from cdnjs for charts. No build step.
- **Hosting:** Render (or Railway), one web service, `MONGODB_URI` as an env var.
- **Tests:** Node's built-in `node:test` for the graph and impact engine.
- No TypeScript, ORMs, auth, Docker, or microservices.

## 6. Scope

### In scope
- Manifest JSON upload and validation; graph versions per project.
- What-if simulation for 7 change types (section 8) with rule-based propagation.
- Blast-radius score and severity label.
- Simulation history, side-by-side comparison of two simulations, analytics.
- Interactive graph where affected nodes are colored, and the chain-reaction path is highlighted.
- Live event feed (SSE).
- Demo sample project **ShopLite** with one-click load.
- **Optional (only after everything else works):** source scanner that builds a manifest from a few JS/Python files.

### Out of scope (list under "Limitations")
Full-language parsing, whole-repo analysis, type inference, runtime tracing, auth, multi-user, GitHub integration, LLM features.

## 7. Manifest format (the project description)

Edge direction: **`from` depends on `to`** (consumer to provider). Impact therefore flows in the **reverse** direction, from the changed component to everything that depends on it.

```json
{
  "project": "ShopLite",
  "version": "1.0.0",
  "components": [
    { "id": "db.users.user_name", "type": "field", "name": "users.user_name", "criticality": 4, "meta": {} },
    { "id": "api.get_user", "type": "api", "name": "GET /api/users/:id", "criticality": 5, "meta": {} },
    { "id": "page.profile", "type": "page", "name": "Profile Page", "criticality": 4, "meta": {} }
  ],
  "edges": [
    { "from": "api.get_user", "to": "db.users.user_name", "kind": "reads", "dynamic": false },
    { "from": "page.profile", "to": "api.get_user", "kind": "calls", "dynamic": false }
  ]
}
```

- `type`: `field | table | api | function | page | service | config | package`
- `kind`: `reads | writes | calls | returns | renders | configures | imports`
- `criticality`: integer 1 to 5 (5 = business critical), default 3.
- `dynamic: true` means the dependency is through dynamic access that can't be resolved statically.

**Validation (return ALL errors, 422):** unique component ids; every edge `from`/`to` references an existing component; valid `type` and `kind`; criticality 1 to 5; at least 2 components; no self-loops. Cycles are allowed (handle them).

## 8. What-if changes and propagation rules

A change: `{ "type": "...", "targetId": "<component id>", "params": { ... } }`

| Change type | Typical target | Params |
|---|---|---|
| `RENAME_FIELD` | field/api | `{ "from": "user_name", "to": "username" }` |
| `DELETE_FIELD` | field | `{}` |
| `CHANGE_FIELD_TYPE` | field | `{ "from": "string", "to": "int" }` |
| `DELETE_ENDPOINT` | api | `{}` |
| `CHANGE_FUNCTION_SIGNATURE` | function | `{ "description": "added required arg" }` |
| `CHANGE_CONFIG` | config | `{ "key": "TIMEOUT", "from": "30", "to": "5" }` |
| `UPGRADE_DEPENDENCY_MAJOR` | package | `{ "from": "1.x", "to": "2.x" }` |

**Propagation:** breadth-first search from the target over **reverse edges** (find components that have an edge `to` the current node). Record `depth` (1 = direct) and the `path` (list of component ids from the target to the node). Track visited nodes to survive cycles.

**Status assignment** for a node reached through edge `e` from a node with status `S_prev` (the target itself counts as `BROKEN` for rename/delete/signature changes, and `CHANGED` for type/config/package changes):

| Change type | Depth 1 via static edge | Depth 1 via dynamic edge | Depth 2+ (static) | Depth 2+ (dynamic edge anywhere on path) |
|---|---|---|---|---|
| `RENAME_FIELD`, `DELETE_FIELD`, `DELETE_ENDPOINT`, `CHANGE_FUNCTION_SIGNATURE` | **BROKEN** | **UNCERTAIN** | **AT_RISK** | **UNCERTAIN** |
| `CHANGE_FIELD_TYPE`, `CHANGE_CONFIG`, `UPGRADE_DEPENDENCY_MAJOR` | **AT_RISK** | **UNCERTAIN** | **AT_RISK** if depth is 2, otherwise stop propagation | **UNCERTAIN** |

Exceptions and refinements:
- `edge.meta.usesRemovedApi === true` on a package edge makes the status **BROKEN** for `UPGRADE_DEPENDENCY_MAJOR`.
- For `RENAME_FIELD`, if `edge.kind === "writes"` the consumer is **BROKEN** (it writes a key that no longer exists).
- `kind: "configures"` for config changes is **AT_RISK**.
- Every component in the graph that is not reached is **SAFE**. The UI shows SAFE nodes dimmed.
- Stop propagation at depth 5.

Each affected record:

```json
{ "componentId": "page.profile", "name": "Profile Page", "type": "page", "status": "BROKEN",
  "depth": 2, "path": ["db.users.user_name","api.get_user","page.profile"],
  "criticality": 4, "reason": "Reads renamed field through GET /api/users/:id (calls)",
  "recommendation": "Update Profile Page to read 'username' instead of 'user_name'." }
```

Reasons and recommendations are **template-based** (deterministic), built from change type, status, edge kind and params.

### Blast-radius score (0 to 100)
```
weight(status) = BROKEN 1.0, AT_RISK 0.5, UNCERTAIN 0.25
decay(depth)   = 1 / (1 + 0.25 * (depth - 1))
raw   = sum( criticality * weight(status) * decay(depth) )  over affected components
max   = sum( criticality ) over ALL components except the target
score = round( min(100, raw / max * 100 * 1.5) )   // 1.5 boost so small graphs still show meaningful scores
```
Labels: `0-24 LOW`, `25-49 MEDIUM`, `50-74 HIGH`, `75-100 CRITICAL`. Also return counts: `{broken, atRisk, uncertain, safe}`.

## 9. MongoDB design

Database: `bugbound`

**`projects`**: `{ _id, name (unique), createdAt }`

**`graph_versions`**
```
{ _id: "<projectId>:<manifestHash8>", projectId, version, manifestHash (sha256 of canonical JSON),
  componentCount, edgeCount, createdAt }
```
- Unique: `{ projectId: 1, manifestHash: 1 }`; index `{ projectId: 1, createdAt: -1 }`

**`components`** (one doc per component per version)
```
{ _id: "<versionId>:<componentId>", projectId, versionId, componentId, type, name, criticality, meta }
```
- Index `{ versionId: 1, type: 1 }`; unique `{ versionId: 1, componentId: 1 }`
- `$jsonSchema` required: `projectId, versionId, componentId, type, name, criticality`

**`dependency_edges`**
```
{ _id: "<versionId>:<from>><kind>><to>", projectId, versionId, from, to, kind, dynamic, meta }
```
- Indexes `{ versionId: 1, to: 1 }` (reverse traversal), `{ versionId: 1, from: 1 }`
- `$jsonSchema` required: `projectId, versionId, from, to, kind, dynamic`

**`simulations`**
```
{ _id: "<versionId>:<sha1(canonical change)>", projectId, versionId, change: {type, targetId, params},
  createdAt, score, label, counts: {broken, atRisk, uncertain, safe} }
```
- Index `{ projectId: 1, createdAt: -1 }`, `{ projectId: 1, score: -1 }`
- Deterministic `_id` means running the same change twice returns the cached record (idempotent).

**`impact_reports`**: `{ _id: <same as simulation _id>, projectId, versionId, simulationId, affected: [ ...records ], chains: [ [ids...] ] }`
- Index `{ projectId: 1 }`, `{ "affected.componentId": 1 }`

**`events`** (audit log, including rejected input)
```
{ eventId (unique), projectId, type: "MANIFEST_UPLOADED | MANIFEST_DUPLICATE | MANIFEST_REJECTED | SIMULATION_RUN | SIMULATION_CACHED",
  at, status: "ok | duplicate | rejected", details }
```
- Unique `{ eventId: 1 }`; index `{ projectId: 1, at: -1 }`
- `$jsonSchema` required: `eventId, projectId, type, at, status`

**Aggregations to implement (named functions with comments)**
1. **Blast-radius ranking:** top simulations by `score` for a project.
2. **Fragile components:** `impact_reports` `$unwind affected`, `$group` by `componentId` (count, worst status via `$max` on a numeric rank), `$sort`.
3. **Compare two simulations:** `$match` the two reports, use `$setDifference` / `$setIntersection` on affected component ids, so we get "only in A", "only in B", "in both".
4. **Hotspots (most depended-on components):** `dependency_edges` `$group` by `to`, count dependents, `$lookup` the component name.

## 10. API surface

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/projects` | Create project |
| GET | `/api/projects` | List projects |
| POST | `/api/projects/:id/manifest` | Upload manifest (validate, hash, idempotent) |
| GET | `/api/projects/:id/versions` | Graph versions |
| GET | `/api/versions/:vid/graph` | Components and edges for the UI |
| POST | `/api/versions/:vid/simulate` | Run what-if `{type, targetId, params}`; cached if identical |
| GET | `/api/projects/:id/simulations` | History |
| GET | `/api/simulations/:sid` | Full report |
| GET | `/api/compare?a=<sid>&b=<sid>` | Compare two simulations |
| GET | `/api/projects/:id/analytics` | Ranking, fragile components, hotspots |
| GET | `/api/projects/:id/events` | Recent events |
| GET | `/api/stream` | SSE fed by a MongoDB change stream |
| POST | `/api/demo/seed` | Load ShopLite |
| GET | `/api/health` | Health incl. DB ping |
| POST | `/api/scan` | *(Optional)* build a manifest from source snippets |

Errors: `400` incomplete input, `422` invalid manifest/change (list of reasons), `200 {status:"duplicate"|"cached"}` for repeats. Always JSON. Always log an event.

## 11. Frontend

Single page, clean, neutral palette. Colors: BROKEN red, AT_RISK orange, UNCERTAIN yellow with dashed border, SAFE green (dimmed), changed target blue.

- Header with tagline and a note: "Estimates based on a static dependency model, not guarantees."
- Project/version picker, manifest upload, **Load ShopLite demo** button.
- **Graph panel (Cytoscape):** nodes by type (different shapes), edges directed (consumer to provider), dashed for dynamic edges. After a simulation, color nodes by status and **animate the chain reaction** by revealing nodes level by level (depth 1, then 2, ...) with a short delay. Clicking a node shows its reason, path and recommendation.
- **What-if panel:** choose change type, choose target component (dropdown of components filtered by type), fill the params, **Simulate** button. Quick-action buttons for common scenarios on the demo project.
- **Report panel:** blast-radius gauge with label, counts, list of affected components with recommendations, and "Needs manual review" section for UNCERTAIN.
- **History and compare:** list of past simulations with score; select two and press **Compare** to see "only in A / only in B / both" and the score difference.
- **Analytics:** bar chart of blast-radius per simulation, fragile components table, hotspots table.
- **Live event feed** via EventSource, with ok/duplicate/rejected dots.
- Friendly error and empty states. No stack traces.

## 12. Demo project: ShopLite (must be included as `samples/shoplite.json`)

~22 components: `db.users` table with fields `user_name`, `email`, `created_at`; `db.orders` with `total`, `status`; apis `GET /api/users/:id`, `POST /api/orders`, `GET /api/orders/:id`; function `formatName()` shared by pages; pages Profile, Dashboard, Settings, Orders, Analytics; services `email-service`, `billing-service`; config `PAYMENT_TIMEOUT`; package `payments-sdk` (1.x). Required behaviors:
- Renaming `users.user_name`: Profile and Dashboard **BROKEN** (static reads), Settings **SAFE**, Analytics **UNCERTAIN** (dynamic access edge), `email-service` **BROKEN**, and at least one depth-2 **AT_RISK**.
- Changing `PAYMENT_TIMEOUT` affects `billing-service` (AT_RISK) and Orders page at depth 2.
- Upgrading `payments-sdk` has one edge with `usesRemovedApi: true` (BROKEN).
- Also ship `samples/shoplite-v2.json` (slightly changed graph: one new component and one new edge) to demonstrate graph versions, and `samples/invalid.json` (edge pointing to a missing component) for the 422 demo.

## 13. Demo flow the app must support

1. **Load ShopLite**: the graph renders.
2. Simulate **rename `user_name` to `username`**: chain reaction animates, 2+ broken, 1 uncertain, blast radius appears.
3. Simulate **delete `email` field** and **change `PAYMENT_TIMEOUT`**, then **compare** two simulations.
4. Run the **same simulation again**: "cached, no duplicate".
5. Upload **invalid manifest**: 422 with reasons. Upload ShopLite again: "duplicate".
6. Show MongoDB Atlas: collections, indexes, validators; show the live feed and analytics.

## 14. Code quality rules

- Folders: `src/engine/` (pure functions), `src/db/`, `src/routes/`, `src/services/`, `public/`, `samples/`, `test/`.
- The engine has **no database access** and is unit-tested (at least 12 tests: each change type, dynamic edge to UNCERTAIN, cycle handling, depth limit, score bounds, SAFE nodes, validation errors).
- Never crash on bad input. Always return JSON errors.
- Comment the BFS, the scoring formula and the aggregations so the team can explain them.
- README stays current: what it does, architecture (ASCII), setup, env vars, demo steps, MongoDB features used, **limitations**, libraries.

## 15. Definition of done

- Live URL runs the demo flow in section 13.
- Repo has README, `.env.example`, no secrets.
- `npm test` passes.
- Every MongoDB requirement in section 4 is demonstrable.
