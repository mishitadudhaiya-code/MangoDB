/**
 * public/js/pages/about.js — How It Works Page Controller (Judge / Architecture Guide)
 * Explains: Problem statement, 4-step architecture flow, status propagation rules,
 * blast radius scoring formula, MongoDB feature mapping, limitations, and tech stack.
 */

window.AboutPage = {
  container: null,
  store: null,

  mount(container, store) {
    this.container = container;
    this.store = store;
    this.render();
  },

  unmount() {
    this.container = null;
  },

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="page-container about-page">
        <!-- Header -->
        <div class="page-header-row">
          <div>
            <h2>How BugBound Works (Architecture & Judge Guide)</h2>
            <p class="text-secondary">Comprehensive overview of the static dependency propagation engine, MongoDB Atlas integration, and blast radius mechanics.</p>
          </div>
        </div>

        <!-- 1. Problem Statement -->
        <div class="panel-card about-section-card">
          <div class="panel-card-title">1. The Problem: The Hidden Ripple Effect</div>
          <p class="about-text">
            In modern microservice and monolith architectures, renaming a database field, altering an environment timeout, or deleting an API endpoint often causes catastrophic cascading failures across distant frontend views, background workers, and billing engines.
          </p>
          <p class="about-text">
            Standard unit tests often pass because mocks hide breaking downstream dependencies. <strong>BugBound</strong> solves this by building a graph of your system and computing the ripple effect of any proposed change <em>before</em> you commit or deploy.
          </p>
        </div>

        <!-- 2. 4-Step Diagram (HTML / CSS) -->
        <div class="panel-card about-section-card">
          <div class="panel-card-title">2. Architecture Pipeline: From Code to Blast Radius</div>
          <div class="pipeline-flow-steps">
            <!-- Step 1 -->
            <div class="pipeline-step-box">
              <div class="step-badge">Step 1</div>
              <div class="step-icon">📦</div>
              <div class="step-title">Manifest Ingestion</div>
              <div class="step-desc">System architecture ingested via JSON manifest or heuristic regex code scanner. Validated against strict schema rules.</div>
            </div>

            <div class="step-connector-arrow">➔</div>

            <!-- Step 2 -->
            <div class="pipeline-step-box">
              <div class="step-badge">Step 2</div>
              <div class="step-icon">🌐</div>
              <div class="step-title">Dependency Graph</div>
              <div class="step-desc">Pure in-memory directed graph with cycle detection, multi-path resolution, and dynamic bracket edge tagging.</div>
            </div>

            <div class="step-connector-arrow">➔</div>

            <!-- Step 3 -->
            <div class="pipeline-step-box">
              <div class="step-badge">Step 3</div>
              <div class="step-icon">⚡</div>
              <div class="step-title">What-If Simulation</div>
              <div class="step-desc">Simulates one of 7 change types. Propagates depth-limited ripple effects with worst-status-wins resolution.</div>
            </div>

            <div class="step-connector-arrow">➔</div>

            <!-- Step 4 -->
            <div class="pipeline-step-box">
              <div class="step-badge">Step 4</div>
              <div class="step-icon">🎯</div>
              <div class="step-title">Blast Intelligence</div>
              <div class="step-desc">Computes a 0–100 score, assigns severity badge, generates cascading chain view, and caches results in MongoDB Atlas.</div>
            </div>
          </div>
        </div>

        <!-- 3. Status Rules Table -->
        <div class="panel-card about-section-card">
          <div class="panel-card-title">3. Propagation Status Rules & Triggers</div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Badge</th>
                  <th>Weight</th>
                  <th>Trigger Condition</th>
                  <th>Impact & Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="text-mono font-bold">BROKEN</td>
                  <td><span class="status-pill pill-broken">BROKEN</span></td>
                  <td class="text-mono font-bold">10 pts</td>
                  <td>Target component deleted, renamed without adapter, or signature broken.</td>
                  <td>Direct compile or runtime failure. Callers and query consumers crash immediately.</td>
                </tr>
                <tr>
                  <td class="text-mono font-bold">AT_RISK</td>
                  <td><span class="status-pill pill-at_risk">AT_RISK</span></td>
                  <td class="text-mono font-bold">6 pts</td>
                  <td>Config timeout altered, field type shifted (e.g. string to int), or downstream of broken.</td>
                  <td>Component may experience subtle degradation, timeouts, or type mismatches.</td>
                </tr>
                <tr>
                  <td class="text-mono font-bold">UNCERTAIN</td>
                  <td><span class="status-pill pill-uncertain">UNCERTAIN</span></td>
                  <td class="text-mono font-bold">4 pts</td>
                  <td>Reached via dynamic bracket edge (e.g. <code>data[key]</code>) or reflection.</td>
                  <td>Cannot guarantee safety via static analysis alone; requires engineer manual review.</td>
                </tr>
                <tr>
                  <td class="text-mono font-bold">SAFE</td>
                  <td><span class="status-pill pill-safe">SAFE</span></td>
                  <td class="text-mono font-bold">0 pts</td>
                  <td>Not reachable in the dependency tree from the modified component.</td>
                  <td>Verified unaffected by the change. No testing or code updates needed.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 4. Blast-Radius Formula -->
        <div class="panel-card about-section-card">
          <div class="panel-card-title">4. Blast Radius Mathematical Formula</div>
          <div class="formula-box">
            <code>Score = Math.min(100, Math.round( ∑ (StatusWeight × Criticality × (1 / Depth)) ))</code>
          </div>
          <p class="about-text" style="margin-top: 0.6rem;">
            Where <strong>StatusWeight</strong> is 10 for BROKEN, 6 for AT_RISK, 4 for UNCERTAIN; <strong>Criticality</strong> is a 1–5 weighting factor; and <strong>Depth</strong> discounts the penalty as the ripple moves further from the origin.
          </p>
          <div class="score-thresholds-grid">
            <div class="threshold-chip low">
              <span class="font-bold">LOW (0–19)</span>
              <span>Minimal local impact</span>
            </div>
            <div class="threshold-chip medium">
              <span class="font-bold">MEDIUM (20–39)</span>
              <span>Isolated service ripple</span>
            </div>
            <div class="threshold-chip high">
              <span class="font-bold">HIGH (40–69)</span>
              <span>Critical service or view impacted</span>
            </div>
            <div class="threshold-chip critical">
              <span class="font-bold">CRITICAL (70–100)</span>
              <span>Widespread production failure risk</span>
            </div>
          </div>
        </div>

        <!-- 5. MongoDB Feature Map -->
        <div class="panel-card about-section-card">
          <div class="panel-card-title">5. MongoDB Atlas Feature Architecture</div>
          <div class="mongo-feature-grid">
            <div class="mongo-feature-item">
              <span class="mongo-feature-title">7 Specialized Collections</span>
              <span class="mongo-feature-desc">projects, graph_versions, components, dependency_edges, simulations, impact_reports, and audit events.</span>
            </div>
            <div class="mongo-feature-item">
              <span class="mongo-feature-title">JSON Schema Validators</span>
              <span class="mongo-feature-desc">Enforced at the collection layer: rejects malformed manifests or corrupted simulations at the database boundary.</span>
            </div>
            <div class="mongo-feature-item">
              <span class="mongo-feature-title">Compound Unique Indexes</span>
              <span class="mongo-feature-desc">Indexed on canonical change hashes and manifest SHA-256 for sub-millisecond idempotent simulation cache hits.</span>
            </div>
            <div class="mongo-feature-item">
              <span class="mongo-feature-title">Aggregation Pipelines</span>
              <span class="mongo-feature-desc">Multi-stage $group, $sort, and $lookup pipelines aggregate fragile components and architectural hotspots.</span>
            </div>
            <div class="mongo-feature-item">
              <span class="mongo-feature-title">Change Streams / SSE</span>
              <span class="mongo-feature-desc">Audit events broadcast directly to connected clients via Server-Sent Events (SSE).</span>
            </div>
            <div class="mongo-feature-item">
              <span class="mongo-feature-title">Atomic Set Operations</span>
              <span class="mongo-feature-desc">Efficient diffing in history compare calculates exact intersection and exclusive sets.</span>
            </div>
          </div>
        </div>

        <!-- 6. Limitations & Tech Stack -->
        <div class="analytics-tables-grid">
          <div class="panel-card">
            <div class="panel-card-title">6. Model Limitations</div>
            <p class="about-text">
              • Static analysis does not evaluate arbitrary runtime code (e.g. <code>eval()</code> or dynamic remote imports) without manifests.
            </p>
            <p class="about-text">
              • Dynamic edges flag nodes as <strong>UNCERTAIN</strong> rather than guessing runtime branch outcomes.
            </p>
            <p class="about-text">
              • Propagation stops at depth 5 to avoid infinite loops on large cyclic architectures.
            </p>
          </div>

          <div class="panel-card">
            <div class="panel-card-title">7. Technology Stack</div>
            <p class="about-text">
              • <strong>Backend:</strong> Node.js, Express, MongoDB Node Driver (Native).
            </p>
            <p class="about-text">
              • <strong>Database:</strong> MongoDB Atlas M0 Free Tier (cluster0.5gpkms7.mongodb.net).
            </p>
            <p class="about-text">
              • <strong>Graph & UI:</strong> Cytoscape.js, Chart.js, Vanilla CSS, JetBrains Mono, Inter, Caveat.
            </p>
            <p class="about-text">
              • <strong>Deployment:</strong> Render Cloud (mangodb-90n3.onrender.com).
            </p>
          </div>
        </div>
      </div>
    `;
  }
};
