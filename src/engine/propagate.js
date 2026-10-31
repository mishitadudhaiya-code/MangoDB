/**
 * src/engine/propagate.js — BFS-based impact propagation (pure function)
 *
 * Implements section 8 of the spec exactly:
 * - BFS over REVERSE edges from the change target
 * - Visited set to handle cycles safely
 * - Depth limit of 5
 * - Status assignment based on change type, depth, and edge dynamism
 * - Worst-status-wins when a node is reachable via multiple paths
 * - Template-based reason and recommendation
 */

const { buildReason, buildRecommendation } = require('./templates');

// Status severity ranking (higher = worse)
const STATUS_RANK = { BROKEN: 3, AT_RISK: 2, UNCERTAIN: 1, SAFE: 0 };

// "Destructive" change types: depth 1 static → BROKEN
const DESTRUCTIVE_TYPES = new Set([
  'RENAME_FIELD', 'DELETE_FIELD', 'DELETE_ENDPOINT', 'CHANGE_FUNCTION_SIGNATURE'
]);

// "Soft" change types: depth 1 static → AT_RISK, propagation stops after depth 2 for static
const SOFT_TYPES = new Set([
  'CHANGE_FIELD_TYPE', 'CHANGE_CONFIG', 'UPGRADE_DEPENDENCY_MAJOR'
]);

const MAX_DEPTH = 5;

/**
 * Determine the status for a reached node.
 *
 * Rules from spec section 8:
 * - Destructive changes: depth 1 static → BROKEN, depth 1 dynamic → UNCERTAIN,
 *   depth 2+ static → AT_RISK, depth 2+ with any dynamic on path → UNCERTAIN
 * - Soft changes: depth 1 static → AT_RISK, depth 1 dynamic → UNCERTAIN,
 *   depth 2 static → AT_RISK, depth 2+ with dynamic → UNCERTAIN,
 *   depth 3+ static → STOP (don't propagate)
 *
 * Special cases:
 * - RENAME_FIELD + edge.kind === 'writes' → BROKEN
 * - UPGRADE_DEPENDENCY_MAJOR + edge.meta.usesRemovedApi → BROKEN
 * - kind === 'configures' for config changes → AT_RISK
 *
 * @param {string} changeType
 * @param {number} depth
 * @param {Object} edge - The edge that reached this node
 * @param {boolean} hasDynamicOnPath - Whether any edge on the path is dynamic
 * @returns {string|null} Status string, or null if propagation should stop
 */
function determineStatus(changeType, depth, edge, hasDynamicOnPath) {
  const isDynamic = edge.dynamic || hasDynamicOnPath;

  // Any dynamic edge on the path → UNCERTAIN (except where overridden below)
  if (isDynamic) {
    return 'UNCERTAIN';
  }

  if (DESTRUCTIVE_TYPES.has(changeType)) {
    // Special case: RENAME_FIELD + writes edge → always BROKEN
    if (changeType === 'RENAME_FIELD' && edge.kind === 'writes') {
      return 'BROKEN';
    }
    if (depth === 1) {
      return 'BROKEN';
    }
    // Depth 2+, static edge
    return 'AT_RISK';
  }

  if (SOFT_TYPES.has(changeType)) {
    // Special case: UPGRADE_DEPENDENCY_MAJOR + usesRemovedApi → BROKEN
    if (changeType === 'UPGRADE_DEPENDENCY_MAJOR' && edge.meta && edge.meta.usesRemovedApi === true) {
      return 'BROKEN';
    }
    // Special case: configures edge for config changes → AT_RISK
    if (changeType === 'CHANGE_CONFIG' && edge.kind === 'configures') {
      return 'AT_RISK';
    }

    if (depth === 1) {
      return 'AT_RISK';
    }
    if (depth === 2) {
      return 'AT_RISK';
    }
    // Depth 3+ for soft changes with static edges: stop propagation
    return null;
  }

  // Fallback (should not happen with valid change types)
  return depth === 1 ? 'AT_RISK' : (depth <= 2 ? 'AT_RISK' : null);
}

/**
 * Run BFS impact propagation from the change target.
 *
 * BFS algorithm:
 * 1. Start with the target component in the queue at depth 0
 * 2. For each node, find all edges where this node is the "to" (reverse edges)
 *    — these are the consumers that depend on this node
 * 3. Determine their status based on change type, depth, and edge properties
 * 4. Track visited nodes to survive cycles
 * 5. If a node is reached via multiple paths, keep the WORST status and shortest path
 * 6. Stop at MAX_DEPTH (5)
 *
 * @param {Object} graph - { nodes: Map, reverseAdj: Map }
 * @param {Object} change - { type, targetId, params }
 * @returns {Object[]} Array of affected component records
 */
function propagate(graph, change) {
  const { nodes, reverseAdj } = graph;
  const { type: changeType, targetId, params } = change;

  const targetNode = nodes.get(targetId);
  if (!targetNode) {
    return [];
  }

  // Map of componentId → { status, depth, path, hasDynamicOnPath, edge }
  const affected = new Map();

  // BFS queue: [componentId, depth, path, hasDynamicOnPath]
  const queue = [[targetId, 0, [targetId], false]];
  const visited = new Set();

  while (queue.length > 0) {
    const [currentId, depth, path, hasDynamicOnPath] = queue.shift();

    // Don't revisit to prevent infinite loops in cycles
    // But we DO process a node again if we found a worse status for it
    if (depth > 0) {
      visited.add(currentId);
    }

    // Get reverse edges: edges where currentId is the "to" (provider)
    const edges = reverseAdj.get(currentId) || [];

    for (const edge of edges) {
      const consumerId = edge.from;
      const nextDepth = depth + 1;

      // Skip the target itself (shouldn't happen but guard)
      if (consumerId === targetId) continue;

      // Depth limit
      if (nextDepth > MAX_DEPTH) continue;

      // Track dynamic edges on the path
      const pathHasDynamic = hasDynamicOnPath || edge.dynamic;

      // Determine status for this consumer
      const status = determineStatus(changeType, nextDepth, edge, pathHasDynamic);

      // null means stop propagation for this branch
      if (status === null) continue;

      const newPath = [...path, consumerId];
      const consumerNode = nodes.get(consumerId);
      if (!consumerNode) continue;

      // Check if we already have a result for this component
      const existing = affected.get(consumerId);
      if (existing) {
        // Keep worst status (highest rank), or shortest path if same status
        const newRank = STATUS_RANK[status];
        const oldRank = STATUS_RANK[existing.status];
        if (newRank > oldRank || (newRank === oldRank && newPath.length < existing.path.length)) {
          affected.set(consumerId, {
            status, depth: nextDepth, path: newPath,
            hasDynamicOnPath: pathHasDynamic, edge
          });
        }
        // Don't re-enqueue if already visited (cycle prevention)
        continue;
      }

      affected.set(consumerId, {
        status, depth: nextDepth, path: newPath,
        hasDynamicOnPath: pathHasDynamic, edge
      });

      // Enqueue for further propagation (only if not visited)
      if (!visited.has(consumerId)) {
        queue.push([consumerId, nextDepth, newPath, pathHasDynamic]);
      }
    }
  }

  // Build the result array with reason and recommendation
  const result = [];
  for (const [componentId, info] of affected) {
    const node = nodes.get(componentId);
    const viaNode = info.path.length >= 2 ? nodes.get(info.path[info.path.length - 2]) : null;

    const templateOpts = {
      changeType,
      status: info.status,
      edgeKind: info.edge.kind,
      params: params || {},
      targetName: targetNode.name,
      viaName: viaNode ? viaNode.name : null,
      componentName: node.name,
      depth: info.depth,
      isDynamic: info.hasDynamicOnPath
    };

    result.push({
      componentId,
      name: node.name,
      type: node.type,
      status: info.status,
      depth: info.depth,
      path: info.path,
      criticality: node.criticality,
      reason: buildReason(templateOpts),
      recommendation: buildRecommendation(templateOpts)
    });
  }

  return result;
}

module.exports = { propagate, STATUS_RANK };
