BugBound
One tiny code change. How much of your application does it break?

BugBound helps developers understand the potential impact of a proposed change before deployment. It builds a dependency graph from a project manifest, simulates how a change can propagate through that graph, and reports affected components, uncertainty, and a weighted blast-radius score.
Project links
- Live deployment: https://mangodb-90n3.onrender.com/
- GitHub repository:https://github.com/mishitadudhaiya-code/MangoDB.git
- Demo video (maximum 7 minutes): https://drive.google.com/drive/folders/1041NmHTlq6nl6vh2jmIbagVmPCvlzmZv?usp=sharing
- Presentation deck:https://1drv.ms/p/c/387273257bbb7860/IQDXQyWxpE42S5eoGRbJCYzPATBaTT3wQUY3GGDJROSkJn8?e=AtBQJN
- Hackathon: UNCHARTED 2026 — NEXUS × SVNIT Surat
The demo-video URL in the earlier README was a placeholder. It has deliberately not been presented as a working video link. Verify the deployment, repository permissions, video, and presentation links before submitting the official form.

1. Problem
Modern applications contain dependencies that are not always obvious from the code being changed. A small modification can affect multiple downstream components:
- Renaming a database field may break a dashboard that reads it through an intermediate API.
- Changing a timeout configuration may cause failures in downstream workers.
- Upgrading a package may break a consumer that relies on a deprecated API.
Unit tests may not expose every cross-component dependency, while running a complete end-to-end test suite can be slow and expensive.
2. Proposed solution
BugBound models application dependencies as a directed graph. A developer selects a component and a change type, then runs a what-if simulation. BugBound propagates the potential impact through the dependency graph and presents the resulting component statuses, affected paths, and blast-radius score.

The result is a static architectural estimate to help engineers decide where to focus manual review and regression testing. It is not a guarantee of runtime behaviour.
3. Who it is for
- Full-stack engineers and tech leads: assess the potential impact of refactors and changes.
- DevOps and release engineers: inspect dependency risk before releases or migrations.
- QA teams: identify downstream consumers and uncertain dependency paths that may need regression testing.
4. Key features
- Interactive dependency graph: visualizes components such as fields, APIs, functions, pages, services, configuration, and packages, along with directed dependency edges.
- Animated impact propagation: reveals the simulated chain reaction level by level.
- Severity classification:
  - BROKEN: a statically identified consumer is affected by a deleted or renamed component, or a broken contract.
  - AT_RISK: a downstream dependency or configuration-related impact needs attention.
  - UNCERTAIN: a path involves dynamic access that cannot be resolved statically; it is flagged for manual review rather than guessed.
  - SAFE: a component is not affected by the simulated change.
- Blast-radius score (0–100): weights affected components by business criticality, severity, and distance from the changed component.
- Deterministic and idempotent simulations: canonical hashing identifies manifests and changes; repeated identical simulations can reuse cached results.
- Simulation comparison: compares two simulations and identifies components unique to either result or common to both.
- Analytics: presents blast-radius trends, fragile-component rankings, and dependency hotspots.
- Live event feed: streams events to connected clients using Server-Sent Events (SSE), backed by MongoDB Change Streams with a polling fallback.
- ShopLite demo: seeds a sample e-commerce dependency graph for demonstrating the workflow.
5. How it works
High-level architecture
┌──────────────────────────────────────────────────────────────────┐
│                           Browser UI                              │
│  Interactive dependency graph • What-if simulation panel         │
│  Impact report and score • History and comparison • Live feed     │
└───────────────────────────────┬──────────────────────────────────┘
                                │ HTTP REST / SSE
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Node.js / Express server                        │
│              Project, simulation, analytics and demo routes       │
│                  Request limits and error handling                 │
└───────────────────────┬───────────────────────┬──────────────────┘
                        │                       │
                        ▼                       ▼
┌──────────────────────────────┐   ┌────────────────────────────────┐
│        BugBound Engine       │   │          MongoDB Atlas          │
│                              │   │                                │
│ Manifest validation          │   │ Graph versions and components  │
│ Graph construction           │   │ Dependency edges               │
│ Reverse dependency traversal │   │ Simulations and impact reports │
│ Impact propagation           │   │ Events / change stream         │
│ Blast-radius scoring         │   │                                │
└──────────────────────────────┘   └────────────────────────────────┘
Dependency and propagation model
In the manifest, from depends on to. Therefore, when to changes, the potential impact propagates backwards to from.
Change type	Depth 1, static edge	Depth 1, dynamic edge	Depth 2+, static edge	Dynamic edge on path
RENAME_FIELD, DELETE_FIELD, DELETE_ENDPOINT, CHANGE_FUNCTION_SIGNATURE	BROKEN	UNCERTAIN	AT_RISK	UNCERTAIN
CHANGE_FIELD_TYPE, CHANGE_CONFIG, UPGRADE_DEPENDENCY_MAJOR	AT_RISK	UNCERTAIN	AT_RISK (depth 2 only)	UNCERTAIN


Additional rules:
- If edge.meta.usesRemovedApi === true for UPGRADE_DEPENDENCY_MAJOR, the status is BROKEN.
- If edge.kind === "writes" for RENAME_FIELD, the writer is BROKEN because it writes to a key that no longer exists.
- When multiple paths reach a node, the most severe status takes precedence: BROKEN > AT_RISK > UNCERTAIN.
- Propagation has a depth limit of 5 to bound traversal on cyclic graphs.
Blast-radius calculation
The score combines component criticality, impact severity, and distance from the changed component.
\[
\operatorname{decay}(d)=\frac{1}{1+0.25(d-1)}
\]
\[
\operatorname{weight}(s)=
\begin{cases}
1.0 & \text{BROKEN}\\
0.5 & \text{AT\_RISK}\\
0.25 & \text{UNCERTAIN}
\end{cases}
\]
\[
\operatorname{raw}=
\sum_{\text{affected}}
\left(\text{criticality}\times\operatorname{weight}(s)\times\operatorname{decay}(d)\right)
\]
\[
\operatorname{max}=
\sum_{\text{all components except target}}\text{criticality}
\]
\[
\operatorname{score}=
\operatorname{round}\left(
\min\left(100,\frac{\operatorname{raw}}{\operatorname{max}}\times100\times1.5\right)
\right)
\]
Score bands:
- 0–24: LOW
- 25–49: MEDIUM
- 50–74: HIGH
- 75–100: CRITICAL
6. MongoDB implementation
BugBound uses the official MongoDB Node.js driver. The implementation described in the project includes:
Requirement / capability	MongoDB feature	Use in BugBound
Stable simulation and event identity	IDs and unique compound indexes	Stable simulation identifiers and idempotent event handling
Efficient dependency queries	Compound indexes	Supports reverse dependency traversal and project-level history/rankings
Data integrity	$jsonSchema collection validation	Validates required fields in components, dependency edges, and events
Analytics	Aggregation pipelines	Computes blast-radius rankings, fragile components, and hotspots
Simulation comparison	$setDifference and $setIntersection	Finds components only in simulation A, only in B, or in both
Live updates	Change Streams (watch())	Watches inserted events and forwards them to clients through SSE
Idempotent ingestion	Unique-index duplicate handling	Recognizes duplicate manifests and repeated simulation requests
Failure handling	Application-level validation and HTTP status codes	Handles invalid payloads, oversized requests, and rate limits


7. Demo walkthrough
Use the following sequence to demonstrate the main workflow. Confirm that the deployed version contains these controls and sample results before recording the final video.
1. Load the ShopLite demo. Select Load ShopLite Demo to seed and display the sample e-commerce dependency graph.
2. Run a field-rename simulation. Select the Rename user_name quick scenario and run the impact simulation.
3. Explain the result. Show the animated propagation, affected nodes, severity labels, uncertain dynamic dependency paths, and blast-radius score.
4. Repeat an identical simulation. Run the same scenario again to demonstrate cached/idempotent behaviour, if shown by the deployed build.
5. Compare two simulations. Run another scenario, open History, select two simulations, and use the comparison view to inspect differences.
6. Show validation and duplicate handling. Use the invalid-manifest and duplicate-upload demo controls, if available in the deployed build, to explain request validation and idempotency.
The earlier README described an illustrative Rename user_name result with a score of approximately 48 (MEDIUM). Treat this as a sample walkthrough value, not a guaranteed result for every run or deployment.
8. API reference
The following routes are documented by the project:
Method	Endpoint	Description
GET	/api/health	Health check and MongoDB connectivity check
POST	/api/projects	Create a project
GET	/api/projects	List projects
POST	/api/projects/:id/manifest	Upload, validate, hash, and ingest a manifest
GET	/api/projects/:id/versions	List graph versions for a project
GET	/api/versions/:vid/graph	Fetch graph components and edges
POST	/api/versions/:vid/simulate	Run a what-if simulation
GET	/api/projects/:id/simulations	List a project's simulation history
GET	/api/simulations/:sid	Retrieve a simulation report
GET	/api/compare?a=:id&b=:id	Compare two simulations
GET	/api/projects/:id/analytics	Retrieve rankings, fragile components, and hotspots
GET	/api/projects/:id/events	Retrieve recent project events
GET	/api/stream	Subscribe to the SSE event stream
POST	/api/demo/seed	Seed the ShopLite demo
GET	/api/demo/samples/:name	Retrieve a sample manifest


9. Technology stack
- Runtime: Node.js 20+
- Backend: Express 4
- Database: MongoDB Atlas using the official MongoDB Node.js driver (no ORM/ODM)
- Frontend: HTML5, CSS3, and JavaScript
- Graph visualization: Cytoscape.js
- Analytics charts: Chart.js
- Live updates: Server-Sent Events (SSE) and MongoDB Change Streams
- Testing: Node.js built-in node:test and node:assert
- Utilities: cors, compression, and dotenv
10. Local setup and testing
Prerequisites
- Node.js 20 or later
- A MongoDB Atlas cluster or a local MongoDB instance
Installation
# 1. Clone the repository
git clone https://github.com/mishitadudhaiya-code/MangoDB.git
cd MangoDB

# 2. Install dependencies
npm install

# 3. Create your local environment file
cp .env.example .env

# 4. Add your MongoDB connection string to .env
# Do not commit .env or expose credentials.

# 5. Check the database connection and indexes
npm run db:check

# 6. Run the automated tests
npm test

# 7. Start the application
npm start
Open http://localhost:3000 in your browser.
On Windows PowerShell, if cp is unavailable, use Copy-Item .env.example .env.

Environment and secrets
Set the required MongoDB connection string in your local .env file. Use the variable name specified in .env.example. Never commit .env, API keys, passwords, database credentials, or private user data. The .env.example file should contain placeholders only.
11. Deployment and judge access
Live application: https://mangodb-90n3.onrender.com/

Deployment is compulsory under the UNCHARTED 2026 participant rules. Before submitting:
- Open the deployed URL in a private/incognito browser window and verify that it is reachable.
- Test the core workflow on the deployed instance, including the demo and a simulation.
- If login is required, add judge access instructions or dedicated test credentials in the official submission form. Do not publish personal passwords or production secrets in this README.
- Ensure the GitHub repository is accessible to judges.
- Ensure the demo video is no longer than 7 minutes and is accessible without requesting permission.
- Ensure the PPT covers the problem, solution, implementation, technology choices, and impact.
Judge access instructions: [Add steps or dedicated test-account details if authentication is enabled. Do not add personal account passwords.]
12. Limitations and engineering boundaries
- Static estimate, not runtime guarantee: BugBound models dependencies represented in the supplied manifest. It does not execute the application code or observe production memory.
- Dynamic access is uncertain: dynamic property access such as obj[variableKey] cannot always be resolved statically. BugBound flags these paths for manual review instead of guessing.
- Manifest-based input: the dependency graph is derived from a JSON manifest; the quality and completeness of the manifest affect the analysis.
- Depth cutoff: propagation stops at depth 5 to bound computation on cyclic graphs.
13. Submission and code-freeze compliance
This project is being submitted for UNCHARTED 2026, organized by NEXUS — Official DoCSE & DoAI Cell, SVNIT Surat.

According to the participant rulebook:
- The official build window is 30 October 2026, 9:00 PM to 31 October 2026, 9:00 PM IST.
- The official submission form is released at 9:00 PM on 31 October 2026 and must be completed by 10:00 PM IST.
- The submission must include the live deployment URL, accessible GitHub repository, demo video of at most 7 minutes, presentation deck, and any required access instructions.
- The submitted project is frozen after the official deadline. No new features, source-code bug fixes, GitHub commits, or changes to the deployed app that alter submitted code or functionality are permitted after the deadline, unless the organizers explicitly authorize an exception.
- The team may prepare its final presentation, provided the submitted project itself is not modified.
Important: Confirm the exact submission deadline and any event updates through the official channels. Do not push commits or modify the submitted application after the deadline unless the organizers explicitly authorize it.
14. Team
- Project: BugBound
- Hackathon: UNCHARTED 2026 — NEXUS × SVNIT Surat
- Team name: MangoDB
- Team members: Mishita Dudhaiya, Margi Chaudhary, Heshika Pareek.