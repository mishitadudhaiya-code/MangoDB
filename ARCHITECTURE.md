# BugBound: System Architecture & Implementation Reference

> **Document Status:** Authoritative technical specification of the codebase as actually implemented.  
> **Source Verification:** Every section reflects verified code from `src/`, `public/`, and `samples/`.

---

## Table of Contents

1. [High-Level Architecture & Design Philosophy](#1-high-level-architecture--design-philosophy)
2. [Environment Variables & Configuration](#2-environment-variables--configuration)
3. [Network Configuration, DNS & MongoDB Connection Setup](#3-network-configuration-dns--mongodb-connection-setup)
4. [Server & Middleware Infrastructure](#4-server--middleware-infrastructure)
5. [Frontend Architecture & Single-Page Application (public/)](#5-frontend-architecture--single-page-application-public)
   - [5.1 Client Hash Router](#51-client-hash-router)
   - [5.2 Reactive State Store](#52-reactive-state-store)
   - [5.3 Pages & Route Controllers](#53-pages--route-controllers)
   - [5.4 Cytoscape Visualizer & Shape-Type Mappings](#54-cytoscape-visualizer--shape-type-mappings)
6. [Complete REST API Reference](#6-complete-rest-api-reference)
7. [Impact Engine: Rules, Algorithms & Mathematical Scoring](#7-impact-engine-rules-algorithms--mathematical-scoring)
   - [7.1 In-Memory Graph Model](#71-in-memory-graph-model)
   - [7.2 BFS Reverse-Propagation Algorithm](#72-bfs-reverse-propagation-algorithm)
   - [7.3 Status Resolution & Edge Dynanism Rules](#73-status-resolution--edge-dynamism-rules)
   - [7.4 Blast-Radius Scoring Formula](#74-blast-radius-scoring-formula)
   - [7.5 Canonical Serialization & Deterministic Hashing](#75-canonical-serialization--deterministic-hashing)
   - [7.6 Template Engine (Reasons & Recommendations)](#76-template-engine-reasons--recommendations)
   - [7.7 Heuristic Source Scanner](#77-heuristic-source-scanner)
8. [Database Architecture & MongoDB Collection Schemas](#8-database-architecture--mongodb-collection-schemas)
9. [MongoDB Aggregation Pipelines (Verbatim Code)](#9-mongodb-aggregation-pipelines-verbatim-code)
   - [9.1 compareSimulations(simIdA, simIdB)](#91-comparesimulationssimida-simidb)
   - [9.2 blastRankings(projectId)](#92-blastrankingsprojectid)
   - [9.3 fragileComponents(projectId)](#93-fragilecomponentsprojectid)
   - [9.4 hotspots(versionId)](#94-hotspotsversionid)
10. [Real-Time Event Stream: Change Streams & SSE Flow with Polling Fallback](#10-real-time-event-stream-change-streams--sse-flow-with-polling-fallback)
11. [Deviations & Unimplemented Items from Initial Specifications](#11-deviations--unimplemented-items-from-initial-specifications)

---

## 1. High-Level Architecture & Design Philosophy

BugBound is a **static change-impact analysis engine** designed to simulate software regressions and schema ripples before code or migrations hit production.

```
                      +---------------------------------------+
                      |       Client Browser (SPA)           |
                      |  Vanilla JS • Hash Router • Cytoscape |
                      |       Chart.js • EventSource SSE      |
                      +-------------------+-------------------+
                                          | HTTP / SSE
                                          v
+-----------------------------------------------------------------------------------+
| Express 4 HTTP Application Server (src/server.js)                                 |
|                                                                                   |
|  [Middleware] CORS • Compression • Rate Limiting (60/min) • JSON Parser (5MB)     |
|                                                                                   |
|  [Routes]                                                                         |
|    - /api/projects, /api/projects/:id/manifest                                    |
|    - /api/versions/:vid/simulate, /api/simulations/:sid, /api/compare             |
|    - /api/projects/:id/analytics, /api/projects/:id/events, /api/stream           |
|    - /api/demo/seed, /api/demo/samples/:name, /api/scan, /api/health             |
+--------------------------+-------------------------------+------------------------+
                           |                               |
                           v                               v
+--------------------------------------+     +--------------------------------------+
| Pure Simulation Engine (src/engine/) |     | MongoDB Atlas Cluster (src/db/)      |
|  - Graph Construction (Reverse Adj)  |     |  - Collections with $jsonSchema      |
|  - BFS Reverse Traversal (Depth <=5) |     |  - Aggregations ($setDifference)     |
|  - Deterministic Status Propagation  |     |  - Unique Compound Indexes           |
|  - Blast Radius Score & Decay Math   |     |  - Change Stream (watch 'events')    |
|  - Heuristic Regex Scanner           |     |  - Upstream DNS Override (8.8.8.8)   |
+--------------------------------------+     +--------------------------------------+
```

### Core Architectural Axioms
1. **Separation of Concerns:** The engine (`src/engine/`) contains **zero database access or side effects**. It accepts raw graph structures, calculates propagation trees, produces severity scores, and returns immutable results.
2. **Deterministic Idempotency:**
   - Graph versions use SHA-256 canonical manifest hashes (`<projectId>:<hash8>`). Identical manifests return the existing version without duplication.
   - Simulations use SHA-1 canonical change hashes (`<versionId>:<changeHash>`). Re-running an identical simulation returns the cached report instantly.
3. **Honesty Over Guesswork:** Dynamic accesses (`obj[var]`) cannot be statically resolved. Rather than guessing or silently omitting, BugBound marks downstream dependents as `UNCERTAIN` and flags them for manual review.
4. **Resilience & Fallbacks:** If MongoDB Atlas Change Streams are unavailable (e.g. non-replica development environments or restricted network proxies), the system seamlessly degrades to a 3-second background polling mechanism.

---

## 2. Environment Variables & Configuration

The application is configured through environment variables loaded via `dotenv` in `src/server.js`:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `3000` | Port on which Express listens for incoming HTTP and SSE connections. |
| `MONGODB_URI` | **Yes** | *None* | Connection URI for MongoDB Atlas (or local replica set). e.g., `mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority`. |
| `DB_NAME` | No | `bugbound` | Name of the database within the MongoDB instance. |

Example `.env`:
```ini
PORT=3000
MONGODB_URI=mongodb+srv://demo:secret@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority
DB_NAME=bugbound
```

---

## 3. Network Configuration, DNS & MongoDB Connection Setup

Implemented in `src/db/index.js`:

### DNS Resolver Injection
To prevent DNS SRV lookup failures common on Windows local networks and certain cloud hosting providers (e.g. Render, WSL, containerized Docker bridges) when connecting to `mongodb+srv://` Atlas endpoints, custom public DNS nameservers are injected at startup before the driver resolves any hosts:

```javascript
// src/db/index.js line 5
require('dns').setServers(['8.8.8.8', '1.1.1.1']);
```

### MongoClient Connection Lifecycle
- **Driver:** Official Node.js `mongodb` driver (v6.x). No ORM/ODM (no Mongoose).
- **Singleton Caching:** The `MongoClient` and `Db` instances are held in module-scoped variables (`client`, `db`). Successive calls to `connect()` or `getDb()` return the cached connection.
- **Verification Ping:** On startup, `connect()` issues a `{ ping: 1 }` admin command to verify network roundtrips before bootstrapping collections.
- **Graceful Shutdown:** `close()` explicitly tears down the connection pool on application termination.
- **Non-Fatal Boot:** If MongoDB connection fails during server startup, `src/server.js` logs the error and continues running so static pages, client router, and the heuristic code scanner remain accessible.

---

## 4. Server & Middleware Infrastructure

Implemented in `src/server.js`:

```javascript
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' }));
```

### Middlewares
1. **CORS:** Enabled globally via `cors()` to permit cross-origin API integration.
2. **Compression:** Gzip/Deflate compression enabled for all JSON payloads and static assets via `compression()`.
3. **Payload Limit:** `express.json` is configured with a strict `5mb` ceiling to support large enterprise dependency graphs.
4. **Rate Limiting (`src/middleware/rateLimit.js`):**
   - Sliding-window in-memory rate limiter: `60 requests per minute per IP`.
   - Applied to compute-heavy endpoints:
     - `POST /api/projects/:id/manifest`
     - `POST /api/versions/:vid/simulate`
   - Excess requests receive `429 Too Many Requests` with `{ error, hint }`.
5. **Payload Error Interceptor:** Intercepts `entity.too.large` body-parser errors and returns clean `413 Payload Too Large` JSON responses.
6. **Global Error Handler:** Catches unhandled exceptions, logs to stderr, and emits `{ error: err.message, hint: ... }` with appropriate status codes (defaulting to 500).

---

## 5. Frontend Architecture & Single-Page Application (`public/`)

The frontend is a modular, zero-build vanilla JavaScript Single-Page Application (SPA) structured around a fixed left sidebar (`~220px`), top control bar, and dynamic `<main id="main-content">` stage.

### 5.1 Client Hash Router (`public/js/router.js`)
Client routing is driven by the browser's `hashchange` event. The `Router` class unmounts active page controllers and mounts the targeted view controller:

```javascript
const router = new Router({
  '#/dashboard': window.DashboardPage,
  '#/graph':     window.GraphPage,
  '#/simulate':  window.SimulatePage,
  '#/chain':     window.ChainPage,
  '#/blast':     window.BlastPage,
  '#/history':   window.HistoryPage,
  '#/analytics': window.AnalyticsPage,
  '#/events':    window.EventsPage,
  '#/scanner':   window.ScannerPage,
  '#/about':     window.AboutPage
}, 'main-content');
```

### 5.2 Reactive State Store (`public/js/store.js`)
State is centralized in `BugBoundStore`, a lightweight event emitter that caches API responses and syncs to `sessionStorage`:
- Holds `projects`, `selectedProject`, `versions`, `selectedVersion`, `graphData`, `currentSimulation`, and `events`.
- Manages SSE connection (`/api/stream`) with automatic reconnection and topbar indicator status.
- Emits events: `stateChanged`, `projectChanged`, `versionChanged`, `simulationChanged`, `eventReceived`, `sseStatusChanged`.

### 5.3 Pages & Route Controllers (`public/js/pages/`)

| Hash Route | Controller File | Purpose & UI Components |
|---|---|---|
| `#/dashboard` | `dashboard.js` | High-level system overview. Metric KPI cards (Total Components, Edges, Simulations Run, Fragile Hotspots), Quick Action cards, and latest 5 audit events. |
| `#/graph` | `graph.js` | Interactive Cytoscape dependency explorer. Custom node shapes by type, solid/dashed edge rendering, animated BFS cascade replay, zoom/pan controls, and node detail drawer. |
| `#/simulate` | `simulate.js` | What-If simulation workbench. Change type selector, target dropdown filtered by type, dynamic parameter form, 4 quick-action chips (`rename-username`, `delete-email`, `change-timeout`, `upgrade-payments`), and estimated blast radius gauge report. |
| `#/chain` | `chain.js` | Linear propagation flow visualizer. Displays affected components grouped by depth levels ($0 \to 1 \to 2 \to \dots$). Shows path breadcrumbs, reasons, recommendations, and JSON export. |
| `#/blast` | `blast.js` | Whiteboard hand-drawn blast radius sketch. Rendered on cream paper background using Caveat handwriting font and dynamic jittered SVG concentric circles representing impact zones (Critical, High, Medium, Low). |
| `#/history` | `history.js` | Simulation run audit history. Displays past runs with scores and change metadata. Allows selecting two runs to launch side-by-side comparison modal via `/api/compare`. |
| `#/analytics` | `analytics.js` | Deep-dive metrics. Blast radius distribution chart (Chart.js), top fragile components table, and dependency hotspot leaderboard. |
| `#/events` | `events.js` | Live real-time audit log. Connects to SSE feed, displaying chronological events with status pills (`ok`, `duplicate`, `rejected`). |
| `#/scanner` | `scanner.js` | Heuristic source code scanner UI. Includes sample multi-file JavaScript and Python codebases, syntax-highlighted code editor, scan execution, and one-click manifest publishing. |
| `#/about` | `about.js` | Technical and architectural documentation for judges and engineers. Details graph algorithms, scoring math, MongoDB aggregations, and honesty boundaries. |

### 5.4 Cytoscape Visualizer & Shape-Type Mappings
The graph view (`public/js/pages/graph.js`) styles nodes according to their architectural type using distinct geometric shapes:

```javascript
const SHAPE_BY_TYPE = {
  field:    'round-rectangle',
  table:    'barrel',
  api:      'diamond',        // width: 44, height: 44
  function: 'hexagon',        // width: 44, height: 44
  page:     'rectangle',
  service:  'round-octagon',
  config:   'round-tag',
  package:  'round-pentagon'
};
```

#### Status Color Scheme & Styles
- **`TARGET` (Changed node):** Cyan / Bright Blue (`#06b6d4`), width: 48, height: 48.
- **`BROKEN`:** Crimson Red (`#ef4444`).
- **`AT_RISK`:** Amber Orange (`#f59e0b`).
- **`UNCERTAIN`:** Warning Yellow (`#eab308`), with dashed border.
- **`SAFE`:** Emerald Green (`#10b981`), dimmed opacity (`0.45`).
- **Edges:** Directed arrows from consumer (`from`) to provider (`to`). Static edges are solid; dynamic edges (`dynamic: true`) are styled with `line-style: dashed`.

---

## 6. Complete REST API Reference

All requests and responses use JSON (`application/json`).

### 6.1 Projects & Manifests

#### `POST /api/projects`
Creates a new project record.
- **Body:** `{ "name": "ProjectName" }`
- **Responses:**
  - `201 Created`: `{ "projectId": "ProjectName", "name": "ProjectName", "createdAt": "..." }`
  - `400 Bad Request`: `{ "error": "Missing or invalid \"name\" field.", "hint": "..." }`
  - `409 Conflict`: `{ "error": "Project \"ProjectName\" already exists." }`

#### `GET /api/projects`
Returns all projects ordered by creation date descending.
- **Responses:**
  - `200 OK`: `[ { "_id": "ShopLite Demo", "name": "ShopLite Demo", "createdAt": "..." } ]`

#### `POST /api/projects/:id/manifest`
Uploads and validates a project dependency graph. Idempotent. Rate-limited (60 req/min).
- **URL Params:** `id` (Project ID)
- **Body:**
  ```json
  {
    "project": "ShopLite",
    "version": "1.0.0",
    "components": [
      { "id": "db.users.user_name", "type": "field", "name": "users.user_name", "criticality": 4, "meta": {} }
    ],
    "edges": [
      { "from": "api.get_user", "to": "db.users.user_name", "kind": "reads", "dynamic": false }
    ]
  }
  ```
- **Responses:**
  - `201 Created`: `{ "versionId": "ShopLite:a1b2c3d4", "componentCount": 22, "edgeCount": 27 }`
  - `200 OK (Duplicate)`: `{ "status": "duplicate", "versionId": "ShopLite:a1b2c3d4", "message": "This manifest has already been uploaded." }`
  - `400 Bad Request`: Missing/empty body. Emits `MANIFEST_REJECTED` event.
  - `413 Payload Too Large`: Payload exceeds 5MB limit.
  - `422 Unprocessable Entity`: Validation failure. Returns `{ "error": "Invalid manifest.", "reasons": [...] }`. Emits `MANIFEST_REJECTED` event.

#### `GET /api/projects/:id/versions`
Lists all uploaded graph versions for a given project.
- **Responses:**
  - `200 OK`: `[ { "_id": "ShopLite:a1b2c3d4", "projectId": "ShopLite", "version": "1.0.0", "manifestHash": "...", "componentCount": 22, "edgeCount": 27, "createdAt": "..." } ]`

#### `GET /api/versions/:vid/graph`
Returns components and dependency edges for Cytoscape rendering.
- **URL Params:** `vid` (Version ID)
- **Responses:**
  - `200 OK`: `{ "components": [...], "edges": [...] }`
  - `404 Not Found`: `{ "error": "Version \"...\" not found or has no components." }`

---

### 6.2 What-If Simulations & Comparisons

#### `POST /api/versions/:vid/simulate`
Simulates a proposed change. Cached by deterministic SHA-1 hash. Rate-limited (60 req/min).
- **URL Params:** `vid` (Version ID)
- **Body:**
  ```json
  {
    "type": "RENAME_FIELD",
    "targetId": "db.users.user_name",
    "params": { "from": "user_name", "to": "username" }
  }
  ```
- **Responses:**
  - `201 Created`:
    ```json
    {
      "status": "computed",
      "simulationId": "ShopLite:a1b2c3d4:e5f6g7...",
      "projectId": "ShopLite",
      "versionId": "ShopLite:a1b2c3d4",
      "change": { "type": "RENAME_FIELD", "targetId": "db.users.user_name", "params": { ... } },
      "score": 41,
      "label": "MEDIUM",
      "counts": { "broken": 5, "atRisk": 1, "uncertain": 1, "safe": 14 },
      "createdAt": "2026-11-01T...",
      "affected": [
        {
          "componentId": "page.profile",
          "name": "Profile Page",
          "type": "page",
          "status": "BROKEN",
          "depth": 1,
          "path": ["db.users.user_name", "page.profile"],
          "criticality": 4,
          "reason": "Reads renamed field \"user_name\" (reads).",
          "recommendation": "Update Profile Page to read \"username\" instead of \"user_name\"."
        }
      ],
      "chains": [ ["db.users.user_name", "page.profile"] ]
    }
    ```
  - `200 OK (Cached)`: Same structure with `"status": "cached"`. Emits `SIMULATION_CACHED` event.
  - `400 Bad Request`: Missing body or required parameters.
  - `404 Not Found`: Target component or version does not exist.
  - `422 Unprocessable Entity`: Invalid change definition or missing required parameters.

#### `GET /api/projects/:id/simulations`
Returns historical simulations for a project ordered newest first.
- **Responses:**
  - `200 OK`: `[ { "_id": "...", "projectId": "...", "change": {...}, "score": 41, "label": "MEDIUM", "counts": {...}, "createdAt": "..." } ]`

#### `GET /api/simulations/:sid`
Returns full simulation document joined with detailed impact report and chains.
- **Responses:**
  - `200 OK`: Simulation object including `affected: [...]` and `chains: [...]`.
  - `404 Not Found`: `{ "error": "Simulation \"...\" not found." }`

#### `GET /api/compare?a=<sid>&b=<sid>`
Executes MongoDB aggregation to compare two simulations using set logic.
- **Query Params:** `a` (First Simulation ID), `b` (Second Simulation ID)
- **Responses:**
  - `200 OK`:
    ```json
    {
      "simulationA": { "id": "...", "score": 41, "label": "MEDIUM", "counts": {...} },
      "simulationB": { "id": "...", "score": 18, "label": "LOW", "counts": {...} },
      "scoreDifference": 23,
      "onlyInA": [ ... ],
      "onlyInB": [ ... ],
      "inBoth": [
        {
          "componentId": "svc.billing",
          "statusA": "AT_RISK",
          "statusB": "BROKEN",
          "reasonA": "...",
          "reasonB": "..."
        }
      ],
      "counts": { "onlyInA": 4, "onlyInB": 1, "inBoth": 2 }
    }
    ```
  - `400 Bad Request`: Missing `a` or `b` query parameter.
  - `404 Not Found`: One or both simulations do not exist.

---

### 6.3 Analytics, Live Stream & Demo Utilities

#### `GET /api/projects/:id/analytics`
Executes analytics aggregations: blast rankings, fragile components, and hotspots.
- **Responses:**
  - `200 OK`: `{ "projectId": "...", "latestVersionId": "...", "blastRankings": [...], "fragileComponents": [...], "hotspots": [...] }`

#### `GET /api/projects/:id/events`
Returns the 50 most recent audit log events for the specified project.
- **Responses:**
  - `200 OK`: `[ { "eventId": "...", "type": "SIMULATION_RUN", "status": "ok", "at": "...", "details": {...} } ]`

#### `GET /api/stream`
Server-Sent Events (SSE) feed emitting audit events in real-time.
- **Headers:** `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`.
- **Payload format:** `data: {"eventId":"...","type":"SIMULATION_RUN",...}\n\n`
- **Heartbeat:** `: heartbeat\n\n` emitted every 20 seconds.

#### `POST /api/demo/seed`
Idempotently creates the `"ShopLite Demo"` project and ingests `samples/shoplite.json`.
- **Responses:**
  - `201 Created`: `{ "status": "created", "projectId": "ShopLite Demo", "versionId": "...", "componentCount": 22, "edgeCount": 27 }`
  - `200 OK`: `{ "status": "duplicate", "message": "ShopLite Demo is already seeded." }`

#### `GET /api/demo/samples/:name`
Returns raw JSON manifest for bundled samples: `shoplite`, `shoplite-v2`, `invalid`.
- **Responses:**
  - `200 OK`: JSON manifest object.
  - `404 Not Found`: `{ "error": "Sample ... not found.", "availableSamples": ["shoplite", "shoplite-v2", "invalid"] }`

#### `POST /api/scan`
Heuristically extracts components and edges from submitted JS/Python file snippets.
- **Body:** `{ "files": [ { "path": "src/api.js", "content": "..." } ] }` (max 10 files).
- **Responses:**
  - `200 OK`: `{ "project": "ScannedSourceProject", "componentCount": 8, "edgeCount": 7, "valid": true, "errors": [], "manifest": { ... } }`
  - `400 Bad Request`: Empty files array or >10 files submitted.

#### `GET /api/health`
Health check and database ping endpoint.
- **Responses:**
  - `200 OK`: `{ "status": "ok", "db": "up", "time": "2026-11-01T..." }` (or `"db": "down"` if ping fails).

---

## 7. Impact Engine: Rules, Algorithms & Mathematical Scoring

The engine lives in `src/engine/` and consists entirely of pure, side-effect-free functions.

### 7.1 In-Memory Graph Model (`src/engine/buildGraph.js`)
Builds adjacency maps from components and dependency edges:
- **Edge Direction in Manifest:** `from` depends on `to` (Consumer $\to$ Provider).
- **Impact Flow:** When component $C$ changes, impact ripples in the **reverse** direction to all components that depend on $C$.
- `buildGraph` constructs:
  - `nodes`: `Map<componentId, ComponentNode>`
  - `reverseAdj`: `Map<toId, Edge[]>` (used for BFS impact propagation)
  - `forwardAdj`: `Map<fromId, Edge[]>`

### 7.2 BFS Reverse-Propagation Algorithm (`src/engine/propagate.js`)
Traverses consumers using Breadth-First Search:
1. **Initialize:** Queue starts with `[targetId, depth: 0, path: [targetId], hasDynamicOnPath: false]`.
2. **Reverse Edges:** At each node, look up `reverseAdj.get(currentNode)` to find immediate consumers.
3. **Cycle Guard:** A `visited` set prevents infinite loops. If a component is encountered along another path with a higher severity status, its status is updated to the worst rank.
4. **Depth Cap:** Propagation strictly terminates at `MAX_DEPTH = 5`.

### 7.3 Status Resolution & Edge Dynamism Rules
Statuses are ranked: $\text{BROKEN (3)} > \text{AT\_RISK (2)} > \text{UNCERTAIN (1)} > \text{SAFE (0)}$.

```javascript
// Destructive Changes: RENAME_FIELD, DELETE_FIELD, DELETE_ENDPOINT, CHANGE_FUNCTION_SIGNATURE
// Soft Changes:        CHANGE_FIELD_TYPE, CHANGE_CONFIG, UPGRADE_DEPENDENCY_MAJOR
```

| Change Type Category | Depth 1 Static | Depth 1 Dynamic | Depth 2 Static | Depth 2+ Dynamic on Path | Depth 3+ Static |
|---|---|---|---|---|---|
| **Destructive** | **BROKEN** | **UNCERTAIN** | **AT_RISK** | **UNCERTAIN** | **AT_RISK** (up to depth 5) |
| **Soft** | **AT_RISK** | **UNCERTAIN** | **AT_RISK** | **UNCERTAIN** | **STOP** (propagation ceases) |

#### Exact Exceptions as Coded:
1. **Dynamic Taint:** If *any* edge along the path from the target to the component has `dynamic: true`, the assigned status is strictly **`UNCERTAIN`**.
2. **Rename Write Override:** For `RENAME_FIELD`, if `edge.kind === 'writes'`, the consumer is **`BROKEN`** regardless of depth (writing to a nonexistent key causes fatal runtime schema error).
3. **Removed API Override:** For `UPGRADE_DEPENDENCY_MAJOR`, if `edge.meta.usesRemovedApi === true`, the consumer is **`BROKEN`**.
4. **Configuration Edge:** For `CHANGE_CONFIG`, if `edge.kind === 'configures'`, the consumer is **`AT_RISK`**.
5. **Safe Elements:** Any node in the graph not reached during traversal is classified as **`SAFE`**.

### 7.4 Blast-Radius Scoring Formula (`src/engine/score.js`)

#### Weights & Decay
$$\text{weight}(\text{status}) = \begin{cases} 1.0 & \text{BROKEN} \\ 0.5 & \text{AT\_RISK} \\ 0.25 & \text{UNCERTAIN} \\ 0.0 & \text{SAFE} \end{cases}$$

$$\text{decay}(\text{depth}) = \frac{1}{1 + 0.25 \times (\text{depth} - 1)}$$

- Depth 1: $\text{decay} = 1.0$
- Depth 2: $\text{decay} = 0.80$
- Depth 3: $\text{decay} = 0.667$
- Depth 4: $\text{decay} = 0.571$
- Depth 5: $\text{decay} = 0.50$

#### Score Normalization
$$\text{raw} = \sum_{c \in \text{affected}} \text{criticality}(c) \times \text{weight}(\text{status}(c)) \times \text{decay}(\text{depth}(c))$$

$$\text{max} = \sum_{v \in V \setminus \{\text{target}\}} \text{criticality}(v)$$

$$\text{score} = \text{round}\left( \min\left(100, \frac{\text{raw}}{\text{max}} \times 100 \times 1.5 \right) \right)$$

*(The $1.5$ multiplier ensures that localized changes in small or medium graphs register meaningful scores).*

#### Severity Bands
- `0 - 24`: **`LOW`**
- `25 - 49`: **`MEDIUM`**
- `50 - 74`: **`HIGH`**
- `75 - 100`: **`CRITICAL`**

### 7.5 Canonical Serialization & Deterministic Hashing (`src/engine/hash.js`)
To guarantee reproducible caching across platforms:
1. `sortKeys(obj)` recursively sorts all dictionary keys alphabetically.
2. `canonicalize(obj)` produces deterministic JSON with zero whitespace variation.
3. `sha256(canonical)` hashes manifest content to create `versionId = "<projectId>:<sha256(8)>"`.
4. `sha1(canonicalChange)` hashes change requests to create `simulationId = "<versionId>:<sha1(40)>"`.

### 7.6 Template Engine (`src/engine/templates.js`)
Generates deterministic, human-readable reasons and actionable remediation advice based on change type, intermediate nodes (`viaName`), and edge kinds:
- *Example Reason:* `"Reads renamed field \"user_name\" through GET /api/users/:id (calls)."`
- *Example Recommendation:* `"Update Profile Page to read \"username\" instead of \"user_name\"."`
- *Dynamic Access Reason:* `"Uses dynamic access — cannot statically determine if it depends on users.user_name. Needs manual review."`

### 7.7 Heuristic Source Scanner (`src/engine/scanner.js`)
Lightweight regex extractor converting up to 10 source files into a valid manifest:
1. **File Components:** Translates file paths to components (`page` or `service`).
2. **Function Declarations:** Matches `function name()`, `const name = () =>`, and `def name():`.
3. **Pattern 1 (API Calls):** Detects `fetch('/api/...')`, `axios.get('/api/...')`, `requests.get('/api/...')`.
4. **Pattern 2 (Static Property Reads):** Detects `data.prop` or `data['prop']`.
5. **Pattern 3 (Dynamic Access):** Detects `data[variable]` and emits an edge with `dynamic: true`.
6. **Pattern 4 (Inter-File Calls):** Detects references to functions registered in other files.

---

## 8. Database Architecture & MongoDB Collection Schemas

Database name: `bugbound` (overridden via `DB_NAME`). Setup is idempotent (`src/db/setup.js`).

### 1. `projects`
Stores high-level project metadata.
```javascript
{
  _id: "ShopLite Demo",     // string (Project name)
  name: "ShopLite Demo",    // string
  createdAt: ISODate("...") // date
}
```
- **Indexes:** `{ name: 1 }` (unique)

### 2. `graph_versions`
Immutable graph snapshots generated from manifest uploads.
```javascript
{
  _id: "ShopLite Demo:c1448b3c", // "<projectId>:<manifestHash8>"
  projectId: "ShopLite Demo",     // string
  version: "1.0.0",              // string
  manifestHash: "c1448b3c...",   // 64-char sha256 hex
  componentCount: 22,            // integer
  edgeCount: 27,                 // integer
  createdAt: ISODate("...")      // date
}
```
- **Indexes:**
  - `{ projectId: 1, manifestHash: 1 }` (unique)
  - `{ projectId: 1, createdAt: -1 }`

### 3. `components`
All architectural components for a given graph version.
- **Enforced `$jsonSchema` Validator:**
  ```javascript
  {
    $jsonSchema: {
      bsonType: "object",
      required: ["projectId", "versionId", "componentId", "type", "name", "criticality"],
      properties: {
        projectId:   { bsonType: "string" },
        versionId:   { bsonType: "string" },
        componentId: { bsonType: "string" },
        type: {
          enum: ["field", "table", "api", "function", "page", "service", "config", "package"]
        },
        name:        { bsonType: "string" },
        criticality: { bsonType: "int", minimum: 1, maximum: 5 }
      }
    }
  }
  ```
- **Indexes:**
  - `{ versionId: 1, componentId: 1 }` (unique)
  - `{ versionId: 1, type: 1 }`

### 4. `dependency_edges`
Directed dependencies connecting components within a version.
- **Enforced `$jsonSchema` Validator:**
  ```javascript
  {
    $jsonSchema: {
      bsonType: "object",
      required: ["projectId", "versionId", "from", "to", "kind", "dynamic"],
      properties: {
        projectId: { bsonType: "string" },
        versionId: { bsonType: "string" },
        from:      { bsonType: "string" },
        to:        { bsonType: "string" },
        kind: {
          enum: ["reads", "writes", "calls", "returns", "renders", "configures", "imports"]
        },
        dynamic:   { bsonType: "bool" }
      }
    }
  }
  ```
- **Indexes:**
  - `{ versionId: 1, to: 1 }` (reverse traversal)
  - `{ versionId: 1, from: 1 }` (forward traversal)

### 5. `simulations`
Summary of each what-if simulation run.
```javascript
{
  _id: "ShopLite:c1448b3c:47e5b...", // "<versionId>:<sha1(canonicalChange)>"
  projectId: "ShopLite",
  versionId: "ShopLite:c1448b3c",
  change: {
    type: "RENAME_FIELD",
    targetId: "db.users.user_name",
    params: { "from": "user_name", "to": "username" }
  },
  createdAt: ISODate("..."),
  score: 41,
  label: "MEDIUM",
  counts: { broken: 5, atRisk: 1, uncertain: 1, safe: 14 }
}
```
- **Indexes:**
  - `{ projectId: 1, createdAt: -1 }`
  - `{ projectId: 1, score: -1 }`

### 6. `impact_reports`
Detailed affected component records and propagation chains corresponding to a simulation.
```javascript
{
  _id: "ShopLite:c1448b3c:47e5b...", // matches simulations._id
  projectId: "ShopLite",
  versionId: "ShopLite:c1448b3c",
  simulationId: "ShopLite:c1448b3c:47e5b...",
  affected: [
    {
      componentId: "page.profile",
      name: "Profile Page",
      type: "page",
      status: "BROKEN",
      depth: 1,
      path: ["db.users.user_name", "page.profile"],
      criticality: 4,
      reason: "Reads renamed field \"user_name\" (reads).",
      recommendation: "Update Profile Page to read \"username\" instead of \"user_name\"."
    }
  ],
  chains: [
    ["db.users.user_name", "page.profile"],
    ["db.users.user_name", "svc.email", "svc.notification"]
  ]
}
```
- **Indexes:**
  - `{ projectId: 1 }`
  - `{ "affected.componentId": 1 }`

### 7. `events`
Immutable system audit log.
- **Enforced `$jsonSchema` Validator:**
  ```javascript
  {
    $jsonSchema: {
      bsonType: "object",
      required: ["eventId", "projectId", "type", "at", "status"],
      properties: {
        eventId:   { bsonType: "string" },
        projectId: { bsonType: "string" },
        type: {
          enum: [
            "MANIFEST_UPLOADED",
            "MANIFEST_DUPLICATE",
            "MANIFEST_REJECTED",
            "SIMULATION_RUN",
            "SIMULATION_CACHED"
          ]
        },
        at:        { bsonType: "date" },
        status: {
          enum: ["ok", "duplicate", "rejected"]
        }
      }
    }
  }
  ```
- **Indexes:**
  - `{ eventId: 1 }` (unique)
  - `{ projectId: 1, at: -1 }`

---

## 9. MongoDB Aggregation Pipelines (Verbatim Code)

Implemented in `src/services/analytics.js`:

### 9.1 `compareSimulations(simIdA, simIdB)`
Performs set operations (`$setDifference` and `$setIntersection`) across two simulations directly inside MongoDB:

```javascript
// src/services/analytics.js
const pipeline = [
  // Stage 1: Match only the two requested impact reports
  {
    $match: {
      _id: { $in: [simIdA, simIdB] }
    }
  },
  // Stage 2: Join with simulations to get score, label, and change details
  {
    $lookup: {
      from: 'simulations',
      localField: '_id',
      foreignField: '_id',
      as: 'sim'
    }
  },
  // Stage 3: Unwind joined simulation
  {
    $unwind: {
      path: '$sim',
      preserveNullAndEmptyArrays: true
    }
  },
  // Stage 4: Group all matching documents into a single array for set comparison
  {
    $group: {
      _id: null,
      docs: { $push: '$$ROOT' }
    }
  },
  // Stage 5: Separate docA and docB from the docs array
  {
    $project: {
      docA: {
        $arrayElemAt: [
          {
            $filter: {
              input: '$docs',
              as: 'd',
              cond: { $eq: ['$$d._id', simIdA] }
            }
          },
          0
        ]
      },
      docB: {
        $arrayElemAt: [
          {
            $filter: {
              input: '$docs',
              as: 'd',
              cond: { $eq: ['$$d._id', simIdB] }
            }
          },
          0
        ]
      }
    }
  },
  // Stage 6: Calculate set differences and intersection on affected componentIds
  {
    $project: {
      docA: 1,
      docB: 1,
      // $setDifference: components in A that are NOT in B
      onlyInAIds: {
        $setDifference: [
          { $ifNull: ['$docA.affected.componentId', []] },
          { $ifNull: ['$docB.affected.componentId', []] }
        ]
      },
      // $setDifference: components in B that are NOT in A
      onlyInBIds: {
        $setDifference: [
          { $ifNull: ['$docB.affected.componentId', []] },
          { $ifNull: ['$docA.affected.componentId', []] }
        ]
      },
      // $setIntersection: components affected in BOTH A and B
      inBothIds: {
        $setIntersection: [
          { $ifNull: ['$docA.affected.componentId', []] },
          { $ifNull: ['$docB.affected.componentId', []] }
        ]
      }
    }
  }
];
```

### 9.2 `blastRankings(projectId)`
Ranks historical simulations by severity score:

```javascript
// src/services/analytics.js
await db.collection('simulations').aggregate([
  // Stage 1: Match simulations for the specified project
  { $match: { projectId } },
  // Stage 2: Sort descending by score
  { $sort: { score: -1, createdAt: -1 } },
  // Stage 3: Top 10
  { $limit: 10 },
  // Stage 4: Clean projection
  {
    $project: {
      _id: 1,
      simulationId: '$_id',
      versionId: 1,
      change: 1,
      score: 1,
      label: 1,
      counts: 1,
      createdAt: 1
    }
  }
]).toArray();
```

### 9.3 `fragileComponents(projectId)`
Unwinds affected arrays and identifies components with highest failure frequency:

```javascript
// src/services/analytics.js
await db.collection('impact_reports').aggregate([
  // Stage 1: Filter impact reports for this project
  { $match: { projectId } },
  // Stage 2: Flatten affected components array
  { $unwind: '$affected' },
  // Stage 3: Map string statuses to numerical severity for ranking
  {
    $addFields: {
      severityRank: {
        $switch: {
          branches: [
            { case: { $eq: ['$affected.status', 'BROKEN'] }, then: 3 },
            { case: { $eq: ['$affected.status', 'AT_RISK'] }, then: 2 },
            { case: { $eq: ['$affected.status', 'UNCERTAIN'] }, then: 1 }
          ],
          default: 0
        }
      }
    }
  },
  // Stage 4: Group by componentId, count appearances and find max severity
  {
    $group: {
      _id: '$affected.componentId',
      componentId: { $first: '$affected.componentId' },
      name: { $first: '$affected.name' },
      type: { $first: '$affected.type' },
      criticality: { $first: '$affected.criticality' },
      impactCount: { $sum: 1 },
      maxSeverityRank: { $max: '$severityRank' }
    }
  },
  // Stage 5: Map numeric rank back to readable worst status
  {
    $addFields: {
      worstStatus: {
        $switch: {
          branches: [
            { case: { $eq: ['$maxSeverityRank', 3] }, then: 'BROKEN' },
            { case: { $eq: ['$maxSeverityRank', 2] }, then: 'AT_RISK' },
            { case: { $eq: ['$maxSeverityRank', 1] }, then: 'UNCERTAIN' }
          ],
          default: 'SAFE'
        }
      }
    }
  },
  // Stage 6: Sort by impact frequency descending, then severity
  { $sort: { impactCount: -1, maxSeverityRank: -1 } },
  // Stage 7: Limit top 10
  { $limit: 10 }
]).toArray();
```

### 9.4 `hotspots(versionId)`
Computes inbound graph degree to highlight high-dependency core providers:

```javascript
// src/services/analytics.js
await db.collection('dependency_edges').aggregate([
  // Stage 1: Match edges for this graph version
  { $match: { versionId } },
  // Stage 2: Group by the provider component ('to') and count incoming edges
  {
    $group: {
      _id: '$to',
      componentId: { $first: '$to' },
      dependentsCount: { $sum: 1 },
      consumerIds: { $push: '$from' }
    }
  },
  // Stage 3: Sort by dependents count descending
  { $sort: { dependentsCount: -1 } },
  // Stage 4: Limit top 10
  { $limit: 10 },
  // Stage 5: Lookup component details from components collection
  {
    $lookup: {
      from: 'components',
      let: { compId: '$componentId', verId: versionId },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$componentId', '$$compId'] },
                { $eq: ['$versionId', '$$verId'] }
              ]
            }
          }
        }
      ],
      as: 'comp'
    }
  },
  // Stage 6: Unwind component details
  {
    $unwind: {
      path: '$comp',
      preserveNullAndEmptyArrays: true
    }
  },
  // Stage 7: Clean projection
  {
    $project: {
      _id: 0,
      componentId: 1,
      name: { $ifNull: ['$comp.name', '$componentId'] },
      type: { $ifNull: ['$comp.type', 'unknown'] },
      criticality: { $ifNull: ['$comp.criticality', 3] },
      dependentsCount: 1,
      consumerIds: 1
    }
  }
]).toArray();
```

---

## 10. Real-Time Event Stream: Change Streams & SSE Flow with Polling Fallback

Implemented in `src/services/stream.js` and `src/db/events.js`:

```
 [Action: Manifest / Simulation]
             |
             v
   logEvent() in db/events.js
      +------+------+
      |             |
      v             v
 MongoDB Insert   Direct in-memory broadcast()
 (events coll)     (instant local dispatch)
      |
      | (Change Stream: operationType='insert')
      v
  stream.js changeStream listener
      |
      v
  broadcast(eventDoc)
      |
      +---> [SSE Client 1]  (data: {...}\n\n)
      +---> [SSE Client 2]
```

### Connection Management
1. **Endpoint:** `GET /api/stream`
2. **Headers:**
   - `Content-Type: text/event-stream`
   - `Cache-Control: no-cache, no-transform`
   - `Connection: keep-alive`
   - `X-Accel-Buffering: no`
3. **Registry:** Active client response objects are tracked in a module-level `Set<Response>`. Broken sockets are evicted on write error or `req.on('close')`.
4. **Heartbeat:** An interval fires every 20 seconds writing `: heartbeat\n\n` to prevent intermediary proxy timeouts.

### MongoDB Change Stream & Polling Fallback
```javascript
// src/services/stream.js
const pipeline = [{ $match: { operationType: 'insert' } }];
changeStream = db.collection('events').watch(pipeline, { fullDocument: 'updateLookup' });

changeStream.on('change', (change) => {
  if (change.fullDocument) {
    broadcast(change.fullDocument);
  }
});

changeStream.on('error', (err) => {
  console.warn('[stream] MongoDB change stream error:', err.message);
  startFallbackPolling(db);
});
```

#### Fallback Polling Mechanism
If MongoDB is running in standalone mode (no replica set), or network policies prohibit change streams, the stream manager switches to fallback polling:
- Interval: **Every 3,000 milliseconds**.
- Query: `db.collection('events').find({ at: { $gt: lastSeenAt } }).sort({ at: 1 })`.
- Updates `lastSeenAt` and invokes `broadcast(ev)` for each new document.

---

## 11. Deviations & Unimplemented Items from Initial Specifications

The following table documents deviations between the early design proposal (`PROJECT_CONTEXT.md` / `1_MASTER_PROMPT_BugBound.md`) and the final codebase:

| Spec / Planned Feature | Initial Specification | Actual Codebase Implementation | Rationale / Architectural Decision |
|---|---|---|---|
| **Frontend Architecture** | Single monolithic HTML file with inline Cytoscape tab switching. | Modular multi-page SPA with client Hash Router (`Router`), EventEmitter store (`BugBoundStore`), and 10 dedicated page controllers. | Scalability and readability: isolates complex canvas visualizers, charts, and state flows. |
| **Whiteboard Blast Sketch** | Simple gauge meter in report panel. | Dedicated `#/blast` route rendering hand-drawn SVG concentric rings on lined cream paper using Caveat font. | Superior judge demo visualizer showing spatial radius rather than only abstract numbers. |
| **Chain Reaction Explorer** | Simple path list in an accordion. | Dedicated `#/chain` route featuring progressive step-by-step depth flow cards with full JSON export. | Provides step-by-step auditability for engineers reviewing propagation logic. |
| **DNS Resolution** | Standard Node.js DNS defaults. | Hardcoded override `dns.setServers(['8.8.8.8', '1.1.1.1'])` in `src/db/index.js`. | Fixes persistent DNS SRV lookup timeouts with Atlas `mongodb+srv://` URIs on Windows / restricted resolvers. |
| **Rate Limiting** | Not specified in early prompt. | Implemented `createRateLimiter` sliding window (60 req/min) on heavy endpoints (`/manifest`, `/simulate`). | Protects compute-intensive graph algorithms and database bulk writes from abuse. |
| **Payload Limiting** | Default Express 100KB. | Configured `express.json({ limit: '5mb' })` with custom 413 error interceptor. | Necessary to support enterprise dependency manifests containing thousands of nodes. |
| **Full AST Parsing** | Out of scope. | Pure Regex heuristic scanner (`src/engine/scanner.js`) matching 4 patterns (API, static dot/bracket read, dynamic bracket, function call). | Keeps deployment lightweight with zero runtime binary parser dependencies. |
| **Authentication & RBAC** | Out of scope. | Intentionally not implemented. No auth middleware. | Adheres strictly to the project scope and 24-hour hackathon rules. |
| **Runtime Tracing & APM** | Out of scope. | Intentionally not implemented. Static dependency modeling only. | Runtime tracing requires agent bytecode injection and live execution environments, violating static modeling scope. |
| **Git Webhook Sync** | Out of scope. | Intentionally not implemented. Manifest ingestion is driven via REST API and UI upload. | Avoids external VCS dependencies and secret token management. |

