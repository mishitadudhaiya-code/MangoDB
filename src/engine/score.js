/**
 * src/engine/score.js — Blast-radius scoring (pure function)
 *
 * Formula from spec section 8:
 *   weight(status) = BROKEN 1.0, AT_RISK 0.5, UNCERTAIN 0.25
 *   decay(depth)   = 1 / (1 + 0.25 * (depth - 1))
 *   raw   = sum( criticality * weight(status) * decay(depth) )  over affected components
 *   max   = sum( criticality ) over ALL components except the target
 *   score = round( min(100, raw / max * 100 * 1.5) )   // 1.5 boost so small graphs show meaningful scores
 *
 * Labels: 0-24 LOW, 25-49 MEDIUM, 50-74 HIGH, 75-100 CRITICAL
 */

const STATUS_WEIGHT = {
  BROKEN: 1.0,
  AT_RISK: 0.5,
  UNCERTAIN: 0.25
};

/**
 * Calculate depth decay factor.
 * @param {number} depth - The propagation depth (1 = direct)
 * @returns {number}
 */
function decay(depth) {
  return 1 / (1 + 0.25 * (depth - 1));
}

/**
 * Get the label for a blast-radius score.
 * @param {number} score - 0 to 100
 * @returns {string}
 */
function scoreLabel(score) {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

/**
 * Calculate the blast-radius score and counts.
 *
 * @param {Object} graph - { nodes: Map }
 * @param {string} targetId - The change target component ID
 * @param {Object[]} affected - Array of affected records from propagate()
 * @returns {{ score: number, label: string, counts: { broken: number, atRisk: number, uncertain: number, safe: number } }}
 */
function blastRadius(graph, targetId, affected) {
  const { nodes } = graph;

  // Count affected by status
  let broken = 0, atRisk = 0, uncertain = 0;
  for (const a of affected) {
    switch (a.status) {
      case 'BROKEN': broken++; break;
      case 'AT_RISK': atRisk++; break;
      case 'UNCERTAIN': uncertain++; break;
    }
  }

  // Safe = all components minus target minus affected
  const safe = Math.max(0, nodes.size - 1 - affected.length);

  // Calculate raw score
  let raw = 0;
  for (const a of affected) {
    const w = STATUS_WEIGHT[a.status] || 0;
    const d = decay(a.depth);
    raw += a.criticality * w * d;
  }

  // Calculate max (sum of criticality for all components except the target)
  let max = 0;
  for (const [id, node] of nodes) {
    if (id !== targetId) {
      max += node.criticality;
    }
  }

  // Score with 1.5 boost, clamped to 0-100
  let score = 0;
  if (max > 0) {
    score = Math.round(Math.min(100, (raw / max) * 100 * 1.5));
  }

  return {
    score,
    label: scoreLabel(score),
    counts: { broken, atRisk, uncertain, safe }
  };
}

module.exports = { blastRadius, scoreLabel, decay };
