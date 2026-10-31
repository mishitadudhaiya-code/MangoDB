/**
 * public/js/pages/blast.js — Hand-Drawn Whiteboard "Blast Radius" Sketch Page Controller
 * Styled after Image 2 bottom-right:
 * - Cream paper canvas (#fbf7ee)
 * - Handwriting font (Caveat)
 * - Wobbly hand-drawn SVG nodes with deterministic seeded jitter per component
 * - Layered left-to-right depth flow
 * - Curved handwritten arrow paths
 * - Download SVG button
 */

window.BlastPage = {
  container: null,
  store: null,
  unsubscribe: null,

  mount(container, store) {
    this.container = container;
    this.store = store;

    this.render();
    this.unsubscribe = store.on('stateChanged', () => this.render());
  },

  unmount() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.container = null;
  },

  // Deterministic pseudo-random jitter based on string seed
  seededRandom(seedStr) {
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = (hash << 5) - hash + seedStr.charCodeAt(i);
      hash |= 0;
    }
    const x = Math.sin(hash++) * 10000;
    return x - Math.floor(x);
  },

  // Generates wobbly hand-drawn SVG rect path with jittered bezier points
  generateWobblyRect(x, y, w, h, seed) {
    const r = (offset) => (this.seededRandom(seed + offset) - 0.5) * 5;

    const p1x = x + r('1');
    const p1y = y + r('2');
    const p2x = x + w + r('3');
    const p2y = y + r('4');
    const p3x = x + w + r('5');
    const p3y = y + h + r('6');
    const p4x = x + r('7');
    const p4y = y + h + r('8');

    // Return closed curved path
    return `M ${p1x} ${p1y}
      Q ${(p1x + p2x) / 2 + r('9')} ${(p1y + p2y) / 2 + r('10')} ${p2x} ${p2y}
      Q ${(p2x + p3x) / 2 + r('11')} ${(p2y + p3y) / 2 + r('12')} ${p3x} ${p3y}
      Q ${(p3x + p4x) / 2 + r('13')} ${(p3y + p4y) / 2 + r('14')} ${p4x} ${p4y}
      Q ${(p4x + p1x) / 2 + r('15')} ${(p4y + p1y) / 2 + r('16')} ${p1x} ${p1y} Z`;
  },

  render() {
    if (!this.container) return;
    const { currentSimulation, graphData } = this.store.state;

    if (!currentSimulation) {
      this.container.innerHTML = `
        <div class="page-container">
          <div class="empty-state-card">
            <div class="empty-state-icon">✏️</div>
            <h3>No Active Simulation</h3>
            <p>Run a simulation to generate the hand-drawn whiteboard blast radius diagram.</p>
            <button class="btn btn-glowing-green" onclick="location.hash='#/simulate'">Open Simulator</button>
          </div>
        </div>
      `;
      return;
    }

    const sim = currentSimulation;
    const changeType = sim.change?.type || sim.changeType;
    const targetId = sim.change?.targetId || sim.target;
    let affected = sim.affected || [];

    // Top 25 limit if needed
    let extraCount = 0;
    if (affected.length > 25) {
      extraCount = affected.length - 25;
      affected = affected.slice(0, 25);
    }

    // SVG canvas dimensions
    const svgWidth = 960;
    const svgHeight = 560;

    // Build layered layout (target at depth 0 on the left, depth 1..N columns to the right)
    const layers = { 0: [{ id: targetId, name: targetId, status: 'TARGET', depth: 0 }] };
    affected.forEach(a => {
      const d = a.depth || 1;
      if (!layers[d]) layers[d] = [];
      layers[d].push(a);
    });

    const maxDepth = Math.max(...Object.keys(layers).map(Number), 1);
    const colWidth = (svgWidth - 120) / (maxDepth + 1);

    // Color definitions for whiteboard
    const statusFills = {
      TARGET: { fill: '#ff7675', stroke: '#d63031', text: '#2d3436' },
      BROKEN: { fill: '#fab1a0', stroke: '#e17055', text: '#2d3436' },
      AT_RISK: { fill: '#ffeaa7', stroke: '#fdcb6e', text: '#2d3436' },
      UNCERTAIN: { fill: '#fff3cd', stroke: '#e1b12c', text: '#2d3436', dashed: true },
      SAFE: { fill: '#e3fafc', stroke: '#b2f2bb', text: '#495057' }
    };

    // Calculate node coordinates
    const nodeCoords = {};
    let nodesSvg = '';

    Object.keys(layers).forEach(depthKey => {
      const d = Number(depthKey);
      const items = layers[d];
      const startX = 60 + d * colWidth;
      const totalH = items.length * 80;
      const startY = Math.max(80, (svgHeight - totalH) / 2);

      items.forEach((item, idx) => {
        const id = item.componentId || item.id;
        const x = startX;
        const y = startY + idx * 75;
        const w = 150;
        const h = 48;
        nodeCoords[id] = { x: x + w / 2, y: y + h / 2, left: x, right: x + w, top: y, bottom: y + h };

        const colors = statusFills[item.status] || statusFills.BROKEN;
        const pathData = this.generateWobblyRect(x, y, w, h, id);
        const displayName = (item.name || id).split('.').pop();

        nodesSvg += `
          <g class="sketch-node" transform="translate(0,0)">
            <!-- Hand-drawn drop shadow -->
            <path d="${pathData}" fill="rgba(0,0,0,0.06)" transform="translate(3,3)" />
            <!-- Node Body -->
            <path d="${pathData}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="2.2"
              ${colors.dashed ? 'stroke-dasharray="5,4"' : ''} />
            <!-- Node Name -->
            <text x="${x + w / 2}" y="${y + 22}" font-family="Caveat, cursive" font-size="16" font-weight="700"
              fill="${colors.text}" text-anchor="middle">${displayName}</text>
            <!-- Status tag -->
            <text x="${x + w / 2}" y="${y + 38}" font-family="JetBrains Mono, monospace" font-size="10"
              fill="#636e72" text-anchor="middle">${item.status}</text>
          </g>
        `;
      });
    });

    // Generate arrows connecting target -> depth 1 -> depth 2
    let edgesSvg = '';
    affected.forEach((item, idx) => {
      const toId = item.componentId || item.id;
      const pathArr = item.path || [targetId, toId];
      const fromId = pathArr.length > 1 ? pathArr[pathArr.length - 2] : targetId;

      const fromCoord = nodeCoords[fromId] || nodeCoords[targetId];
      const toCoord = nodeCoords[toId];

      if (fromCoord && toCoord) {
        const x1 = fromCoord.right;
        const y1 = fromCoord.y;
        const x2 = toCoord.left;
        const y2 = toCoord.y;
        const cx1 = (x1 + x2) / 2;
        const cy1 = y1;
        const cx2 = (x1 + x2) / 2;
        const cy2 = y2;

        const isDyn = !!item.dynamic;
        const edgeKind = item.kind || (idx % 2 === 0 ? 'calls' : 'reads');

        edgesSvg += `
          <g class="sketch-edge">
            <path d="M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}"
              fill="none" stroke="#2d3436" stroke-width="1.8"
              ${isDyn ? 'stroke-dasharray="4,3"' : ''}
              marker-end="url(#sketch-arrowhead)" />
            <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}"
              font-family="Caveat, cursive" font-size="13" fill="#636e72" text-anchor="middle">${edgeKind}</text>
          </g>
        `;
      }
    });

    this.container.innerHTML = `
      <div class="page-container blast-page">
        <!-- Top Title & Disclaimer -->
        <div class="page-header-row">
          <div>
            <h2>Blast Radius Whiteboard Sketch</h2>
            <p class="text-secondary">Organic visual sketch illustrating ripple paths across depth boundaries.</p>
          </div>
          <div class="disclaimer-banner">
            ⚠️ Estimates from a static dependency model, not guarantees.
          </div>
        </div>

        <!-- Sketch Framed Card -->
        <div class="whiteboard-frame-card">
          <div class="whiteboard-toolbar-row">
            <div class="whiteboard-title-box">
              <span class="whiteboard-main-title">Blast Radius of a Change</span>
              <span class="whiteboard-subtitle text-mono">${changeType} on ${targetId}</span>
            </div>
            <div class="whiteboard-actions">
              <button id="btn-download-blast-svg" class="btn btn-outline-cyan btn-sm">
                📥 Download as SVG
              </button>
            </div>
          </div>

          <!-- Whiteboard Paper Canvas (#fbf7ee) -->
          <div class="whiteboard-paper" id="whiteboard-paper-wrapper">
            <svg id="blast-radius-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" class="sketch-svg-element" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="sketch-arrowhead" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
                  <polygon points="0 0, 9 3.5, 0 7" fill="#2d3436" />
                </marker>
              </defs>

              <!-- Grid texture dots in SVG -->
              <pattern id="paper-dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="#e8e2d5" />
              </pattern>
              <rect width="${svgWidth}" height="${svgHeight}" fill="url(#paper-dots)" />

              <!-- Column Guide Lines -->
              ${Array.from({ length: maxDepth + 1 }).map((_, i) => `
                <text x="${60 + i * colWidth + 75}" y="36" font-family="Caveat, cursive" font-size="18" font-weight="700" fill="#a4b0be" text-anchor="middle">
                  ${i === 0 ? 'Origin (Target)' : `Depth ${i}`}
                </text>
                <line x1="${60 + i * colWidth + 75}" y1="46" x2="${60 + i * colWidth + 75}" y2="${svgHeight - 40}" stroke="#eae4d7" stroke-width="1" stroke-dasharray="4,6" />
              `).join('')}

              <!-- Edges Layer -->
              ${edgesSvg}

              <!-- Nodes Layer -->
              ${nodesSvg}

              <!-- Extra Count notice if > 25 -->
              ${extraCount > 0 ? `
                <text x="${svgWidth - 100}" y="${svgHeight - 20}" font-family="Caveat, cursive" font-size="16" fill="#e17055" font-weight="700">
                  + ${extraCount} more affected nodes...
                </text>
              ` : ''}

              <!-- Whiteboard Signature / Timestamp -->
              <text x="30" y="${svgHeight - 16}" font-family="Caveat, cursive" font-size="14" fill="#a4b0be">
                BugBound Impact Engine — Score: ${sim.score} (${sim.label})
              </text>
            </svg>
          </div>

          <!-- Whiteboard Legend -->
          <div class="whiteboard-legend-bar">
            <span class="legend-chip"><span class="legend-box" style="background: #ff7675;"></span> Target Node</span>
            <span class="legend-chip"><span class="legend-box" style="background: #fab1a0;"></span> Broken</span>
            <span class="legend-chip"><span class="legend-box" style="background: #ffeaa7;"></span> At Risk</span>
            <span class="legend-chip"><span class="legend-box" style="background: #fff3cd; border: 1px dashed #fdcb6e;"></span> Uncertain (Dynamic)</span>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  },

  bindEvents() {
    const dlBtn = document.getElementById('btn-download-blast-svg');
    if (dlBtn) {
      dlBtn.onclick = () => {
        const svgEl = document.getElementById('blast-radius-svg');
        if (!svgEl) return;
        const serializer = new XMLSerializer();
        const source = serializer.serializeToString(svgEl);
        const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `blast-radius-sketch-${Date.now()}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        window.showToast('Hand-drawn SVG diagram downloaded!', 'success');
      };
    }
  }
};
