/**
 * src/engine/buildGraph.js — Build in-memory graph from a manifest (pure function)
 * Creates node map, forward adjacency (from → edges), and reverse adjacency (to → edges).
 * Edge direction: from depends on to. Impact flows in reverse (to → from).
 */

/**
 * Build a graph from a validated manifest.
 * @param {Object} manifest - The manifest with components[] and edges[]
 * @returns {{ nodes: Map, reverseAdj: Map, forwardAdj: Map }}
 *   - nodes: Map<componentId, component>
 *   - reverseAdj: Map<componentId, edge[]> — for each "to" node, all edges pointing TO it (used for impact propagation)
 *   - forwardAdj: Map<componentId, edge[]> — for each "from" node, all edges FROM it
 */
function buildGraph(manifest) {
  const nodes = new Map();
  const reverseAdj = new Map();
  const forwardAdj = new Map();

  // Index components, applying default criticality of 3
  for (const c of manifest.components) {
    const node = {
      id: c.id,
      type: c.type,
      name: c.name,
      criticality: (c.criticality !== undefined && c.criticality !== null) ? Number(c.criticality) : 3,
      meta: c.meta || {}
    };
    nodes.set(c.id, node);
    reverseAdj.set(c.id, []);
    forwardAdj.set(c.id, []);
  }

  // Build adjacency lists
  for (const e of manifest.edges) {
    const edge = {
      from: e.from,
      to: e.to,
      kind: e.kind,
      dynamic: !!e.dynamic,
      meta: e.meta || {}
    };

    // Forward: from → to (dependency direction)
    if (forwardAdj.has(e.from)) {
      forwardAdj.get(e.from).push(edge);
    }

    // Reverse: to → [edges where this node is depended upon]
    // These are the edges where "to" is the provider; we find consumers via their "from"
    if (reverseAdj.has(e.to)) {
      reverseAdj.get(e.to).push(edge);
    }
  }

  return { nodes, reverseAdj, forwardAdj };
}

module.exports = { buildGraph };
