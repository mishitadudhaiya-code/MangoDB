# BugBound: Step-by-Step Build Prompts for Antigravity

> **Rules**
> 1. `PROJECT_CONTEXT.md` (the master prompt) must be in the repo first.
> 2. Paste **one step at a time**, test it, commit, then continue.
> 3. Start every new chat with: *"Read PROJECT_CONTEXT.md and follow it strictly."*
> 4. If time runs short, **skip optional steps; never skip deployment.**
> 5. All commits must be before the **9 PM** deadline.

## Parallel split

| Person | Steps |
|---|---|
| **A: Engine** | Step 2, then Step 5 |
| **B: Backend + MongoDB** | Step 1, Step 3, Step 4, Step 6 |
| **C: Frontend + deploy + docs** | Step 0, Step 7, Step 8, Step 10, Step 11 |

Steps 2, 3 and 7 can run in parallel after Step 1. Everyone follows the JSON shapes in PROJECT_CONTEXT.md sections 7, 8, 9 and 10.

---

## STEP 0: Skeleton + EARLY DEPLOY (C, ~30 min)

```
Read PROJECT_CONTEXT.md. Create the BugBound project skeleton:
- package.json (Node 20, scripts: start, dev, test), dependencies: express, mongodb, dotenv, cors, compression
- Folders: src/engine, src/db, src/routes, src/services, public, samples, test
- src/server.js: Express, JSON body limit 5mb, serve /public statically, GET /api/health returning {status:"ok", time}, listen on process.env.PORT || 3000
- public/index.html: placeholder "BugBound" page that calls /api/health and shows the result
- .gitignore (node_modules, .env), .env.example (MONGODB_URI=, DB_NAME=bugbound, PORT=3000)
- README.md with the title, tagline and the one-sentence pitch from section 2
Only this. Then tell me how to run it locally.
```
**Manually:** push to GitHub, create a Render web service (build `npm install`, start `npm start`), confirm `/api/health` on the live URL. **Do this in the first hour.**

---

## STEP 1: MongoDB connection, validators, indexes (B, ~40 min)

```
Read PROJECT_CONTEXT.md section 9. Implement src/db/index.js and src/db/setup.js:
1. connect(): mongodb driver with MONGODB_URI and DB_NAME, cached client, exports getDb().
2. setup(): idempotent, run on server start. Create collections projects, graph_versions, components, dependency_edges, simulations, impact_reports, events. Apply $jsonSchema validators (validationLevel strict, validationAction error) to components, dependency_edges and events using the required fields in section 9; leave meta, params and details free-form. Create ALL indexes from section 9 (unique and compound), safely if they already exist. Log each one.
3. Call setup() before listen() in server.js; fail with a clear message if MONGODB_URI is missing.
4. src/db/events.js: logEvent({projectId, type, status, details, eventId?}) inserting into events; if eventId is supplied use it, and swallow duplicate-key errors (11000) so repeated ingestion is safe.
5. `npm run db:check` script printing collections, validators and indexes (we show this to judges).
```

---

## STEP 2: Graph and impact engine (A, ~2 hours, MOST IMPORTANT)

```
Read PROJECT_CONTEXT.md sections 7 and 8. Implement the engine as PURE functions (no DB):

- src/engine/validateManifest.js: validateManifest(m) -> {valid, errors[]}. Return ALL errors: unique component ids, edges reference existing ids, valid type and kind, criticality 1-5 (default 3 if missing), at least 2 components, no self-loops, required fields present.
- src/engine/buildGraph.js: buildGraph(manifest) -> {nodes: Map, reverseAdj: Map(to -> [edges]), forwardAdj}. Apply default criticality.
- src/engine/propagate.js: propagate(graph, change) implementing section 8 exactly:
    * BFS over reverse edges from change.targetId, visited set (cycle-safe), depth limit 5
    * track depth and path per node
    * status table from section 8 including: dynamic edges -> UNCERTAIN (and anything beyond a dynamic edge stays UNCERTAIN), writes edge for RENAME_FIELD -> BROKEN, edge.meta.usesRemovedApi for UPGRADE_DEPENDENCY_MAJOR -> BROKEN, type/config/package changes stop at depth 2
    * returns affected[] records {componentId, name, type, status, depth, path, criticality, reason, recommendation}
    * reason and recommendation come from deterministic templates per change type, status and edge kind (src/engine/templates.js)
    * if one node is reachable via several paths, keep the WORST status (BROKEN > AT_RISK > UNCERTAIN) and the shortest path
- src/engine/score.js: blastRadius(graph, targetId, affected) -> {score, label, counts:{broken,atRisk,uncertain,safe}} using the exact formula in section 8
- src/engine/simulate.js: simulate(manifestOrGraph, change) -> {change, affected, chains, score, label, counts}; also validate the change (target exists, type is one of 7, required params present) and throw a typed error with reasons.
- src/engine/hash.js: canonicalize(obj) (sorted keys) and sha256/sha1 helpers.

Create samples/shoplite.json, samples/shoplite-v2.json and samples/invalid.json exactly as described in section 12 (22+ components, realistic ids like db.users.user_name, api.get_user, page.profile, page.analytics with a dynamic edge, etc.).

Write test/engine.test.js with node:test, at least 12 tests: each of the 7 change types, dynamic edge -> UNCERTAIN, cycle in graph does not hang, depth limit, worst-status-wins, score within 0-100, unreachable nodes are not in affected, invalid manifest returns all errors. Verify the ShopLite expectations from section 12 in a test. Run `npm test` and fix until green. Keep functions under 60 lines and comment the BFS and score formula.
```
**Test:** `npm test` all green.

---

## STEP 3: Projects, manifest upload (idempotent + validated) (B, ~45 min)

```
Read PROJECT_CONTEXT.md sections 9 and 10. Using src/db and src/engine, implement src/routes/projects.js:
- POST /api/projects {name} -> create (409 if exists). GET /api/projects.
- POST /api/projects/:id/manifest (body = manifest JSON):
    1. empty/non-object -> 400 {error, hint}; log MANIFEST_REJECTED
    2. validateManifest -> invalid -> 422 {error, reasons:[...]}; log MANIFEST_REJECTED with reasons
    3. canonicalize + sha256 -> manifestHash; versionId = "<projectId>:<hash first 8>"
    4. insert into graph_versions; on duplicate key (11000) -> 200 {status:"duplicate", versionId} and log MANIFEST_DUPLICATE; create NO new records
    5. on success bulk insert components and dependency_edges for that version with the deterministic _ids from section 9 (use insertMany ordered:false), respond 201 {versionId, componentCount, edgeCount}; log MANIFEST_UPLOADED with eventId "<versionId>:uploaded"
- GET /api/projects/:id/versions, and GET /api/versions/:vid/graph returning {components, edges} (projection without internal fields).
Add JSON error-handling middleware. Give me curl commands: create project, upload shoplite.json, upload it again (expect duplicate), upload invalid.json (expect 422).
```

---

## STEP 4: Simulate, history, compare (B, ~60 min)

*(needs Steps 2 and 3)*

```
Read PROJECT_CONTEXT.md sections 8, 9, 10. Implement:
- POST /api/versions/:vid/simulate body {type, targetId, params}:
    * load the version's components and edges from MongoDB, rebuild the graph with buildGraph (reuse engine, no DB access inside the engine)
    * validate the change (400/422 with reasons)
    * simulationId = "<versionId>:<sha1 of canonicalized change>"; if it already exists in simulations return 200 {status:"cached", ...stored report} and log SIMULATION_CACHED
    * else run simulate(), insert into simulations (summary: change, score, label, counts, createdAt) and impact_reports (affected, chains) with the same _id, log SIMULATION_RUN with eventId "<simulationId>:run", return 201 with the full report
- GET /api/projects/:id/simulations (summaries, newest first) and GET /api/simulations/:sid (full report joined with the summary).
- GET /api/compare?a=<sid>&b=<sid>: implement with an aggregation using $setDifference and $setIntersection on affected component ids (in src/services/analytics.js), returning onlyInA, onlyInB, inBoth (with each status), plus both scores and the score difference. Validate both ids exist (404 otherwise).
Give me the curl sequence: rename user_name, delete email field, run rename again (expect cached), compare the two.
```

---

## STEP 5: Engine hardening (A, ~30 min, only if time remains)

```
Review src/engine for robustness. None of these may crash: an edge to a missing id (should have been rejected but defend anyway), a change targeting a component with no dependents (return empty affected, score 0, label LOW), params missing, a graph of 2 nodes, a cyclic graph with a dynamic edge. Add a test for each. Do not change behaviour covered by existing tests.
```

---

## STEP 6: Analytics + change stream live feed (B, ~50 min)

```
Read PROJECT_CONTEXT.md sections 4, 9, 10. In src/services/analytics.js add three named aggregation functions with comments explaining every stage:
 a. blastRankings(projectId): top 10 simulations by score
 b. fragileComponents(projectId): impact_reports $match projectId, $unwind affected, $group by affected.componentId (count, worst status using a numeric rank and $max), $sort desc, $limit 10
 c. hotspots(versionId): dependency_edges $match versionId, $group by "to" counting dependents, $sort desc, $limit 10, $lookup components for names
Expose GET /api/projects/:id/analytics (all three; use the latest version for hotspots) and GET /api/projects/:id/events (last 50).
Implement GET /api/stream as Server-Sent Events: open ONE MongoDB change stream on the events collection (inserts only) at startup, fan out to connected clients as `data: <json>\n\n`, heartbeat comment every 20s, clean up on disconnect. If change streams are unavailable, log a warning and fall back to polling events every 3s so the app never breaks. Tell me how to verify with curl -N.
```

---

## STEP 7: Frontend: graph + what-if + report (C, ~2.5 hours)

```
Read PROJECT_CONTEXT.md section 11. Build public/index.html, public/style.css, public/app.js (vanilla JS; Cytoscape.js and Chart.js from cdnjs). Use the API in section 10.

1. Header with tagline and the "estimates, not guarantees" note.
2. Left sidebar: project dropdown + new project; Load ShopLite demo button (POST /api/demo/seed; if 404 show a toast); manifest upload input showing 400/422 reasons and a "Duplicate: no new version created" message.
3. Center: Cytoscape graph of the selected version (GET /api/versions/:vid/graph). Node shape by type (field, api, function, page, service, config, package), directed edges consumer -> provider, dashed edges for dynamic ones, readable layout (use cose or breadthfirst; fit to screen; labels on nodes). Clicking a node shows details.
4. What-if panel: change type select, target select (filtered by compatible component types), params inputs that adapt to the type, Simulate button. Plus quick buttons that fill common scenarios when the demo project is loaded.
5. After simulate: color nodes BROKEN red, AT_RISK orange, UNCERTAIN yellow with dashed border, SAFE green dimmed, target blue; ANIMATE the chain reaction by revealing statuses depth by depth (e.g. 600ms per level) and highlight the path edges. Clicking an affected node shows reason, path and recommendation.
6. Report panel: blast radius gauge (0-100 with label), counts, affected list with recommendations, separate "Needs manual review" list for UNCERTAIN, and "cached result" badge when status is cached. Download report as JSON.
7. History list of simulations with score; select two -> Compare view (only in A / only in B / both, score difference).
8. Analytics: Chart.js bar chart of blast radius per simulation, tables for fragile components and hotspots.
9. Live event feed with EventSource on /api/stream plus initial load from /api/projects/:id/events.
10. Loading, empty and error states everywhere. Never show raw stack traces.
Keep JS in small commented functions. Handle not-yet-built endpoints gracefully.
```

---

## STEP 8: Demo seed + one-click samples (B or C, ~20 min)

```
Add POST /api/demo/seed: create or reuse a project named "ShopLite Demo", upload samples/shoplite.json using the SAME upload logic (idempotent, so no duplicate on repeat), return {projectId, versionId}. Add GET /api/demo/samples/:name serving shoplite, shoplite-v2 and invalid. In the UI add buttons "Upload ShopLite v2" and "Try a broken manifest" that upload those samples so judges can show graph versions, duplicates and the 422 failure in one click. It must never touch non-demo projects.
```

---

## STEP 9 (OPTIONAL WOW): Source scanner (A, ~60 min, only if everything else works)

```
Add POST /api/scan: body {files: [{path, content}]} (JS or Python snippets, max 10 files). Using regex only (no AST), extract: 
 - fetch/axios/requests calls to "/api/..." paths -> edge page/file -> api
 - property reads like data.user_name, ["user_name"] with a string literal -> static reads edge to a field
 - bracket access with a variable (data[key]) -> a dynamic: true edge
 - function definitions and calls between the given files -> function edges
Build a manifest (components + edges, files become page/function/service components), validate it with validateManifest, and return it (do not store it). Add a small "Scan code" box in the UI that pastes code and loads the resulting manifest into the upload flow. Document clearly in README that it is a heuristic scanner with limits. Include tests for 4 patterns.
```

---

## STEP 10: Deployment hardening (C, ~30 min)

```
Prepare for production on Render: read PORT and MONGODB_URI from env (clear error if missing), setup() safe on every restart, compression, simple in-memory rate limit on upload and simulate routes, friendly 413 for large bodies, /api/health also pings MongoDB and reports db:"up"|"down", no secrets or URIs in logs, no dev-only dependency needed at runtime. Atlas network access must allow Render (document 0.0.0.0/0 for the hackathon). Give me a pre-deploy checklist.
```

---

## STEP 11: README (C, ~30 min)

```
Write the final README.md for judges: (1) title, tagline, one-sentence pitch, live URL and video placeholders; (2) the problem and who it is for; (3) features; (4) how it works: ASCII architecture diagram, the propagation rules table and the blast-radius formula; (5) "How we use MongoDB": table mapping each track requirement to the exact collection/index/validator/aggregation/change stream with file paths; (6) demo walkthrough (section 13); (7) API table; (8) run locally and run tests; (9) Limitations and future work (honest: static analysis, manifest-based input, heuristic scanner, no runtime tracing); (10) tech stack and third-party libraries; (11) team placeholders. Only claim what works.
```

---

## FINAL AUDIT (everyone, at 7:00 PM)

```
Audit the repo against the Definition of done in PROJECT_CONTEXT.md and the hackathon rules: npm test passes; fresh clone + npm install + npm start works with only .env filled; no secrets in files or history (search for mongodb+srv and passwords); README matches the real behaviour; the demo flow in section 13 works end to end on the LIVE URL including cached re-simulation, duplicate upload, invalid manifest, compare and live feed. Output a prioritized fix list. Do NOT add features.
```

## Timeline (deadline 9:00 PM)

| Time | Goal |
|---|---|
| Hour 1 | Step 0 live on Render. Step 1 done. |
| Hours 1 to 4 | Steps 2, 3, 7 in parallel. |
| Hours 4 to 7 | Steps 4, 6, 8. Frontend wired to the real API. |
| Until 6:30 PM | Step 5, optional Step 9, Step 10, bug fixes. **Feature freeze.** |
| 6:30 to 8:30 PM | Step 11, demo video (max 7 min), PPT, final audit. |
| 9:00 PM | Build ends. Submission form opens at 9 PM, closes **10 PM**. Submit early and check every link. |

## Demo video script (max 7 minutes)

1. 0:00 to 0:45: the problem ("a tiny rename, and half the app breaks")
2. 0:45 to 1:30: what BugBound is and the honesty line (static estimates, UNCERTAIN is a feature)
3. 1:30 to 4:30: live demo (load ShopLite, animated chain reaction, what-if variations, compare, cached re-run, invalid manifest)
4. 4:30 to 5:45: MongoDB under the hood (collections, validators, unique indexes, aggregations, change stream)
5. 5:45 to 6:30: limitations and future work
6. 6:30 to 7:00: impact and close
