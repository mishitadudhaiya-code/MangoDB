/**
 * src/engine/simulate.js — Orchestrates a full simulation (pure function)
 * Validates the change, runs propagation, computes score.
 */

const { buildGraph } = require('./buildGraph');
const { propagate } = require('./propagate');
const { blastRadius } = require('./score');

// Valid change types and their required params
const CHANGE_TYPES = {
  RENAME_FIELD: { requiredParams: ['from', 'to'], targetTypes: ['field', 'api'] },
  DELETE_FIELD: { requiredParams: [], targetTypes: ['field'] },
  CHANGE_FIELD_TYPE: { requiredParams: ['from', 'to'], targetTypes: ['field'] },
  DELETE_ENDPOINT: { requiredParams: [], targetTypes: ['api'] },
  CHANGE_FUNCTION_SIGNATURE: { requiredParams: [], targetTypes: ['function'] },
  CHANGE_CONFIG: { requiredParams: ['key'], targetTypes: ['config'] },
  UPGRADE_DEPENDENCY_MAJOR: { requiredParams: ['from', 'to'], targetTypes: ['package'] }
};

/**
 * Validate a change object against the graph.
 * @param {Object} graph - { nodes: Map }
 * @param {Object} change - { type, targetId, params }
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateChange(graph, change) {
  const errors = [];

  if (!change || typeof change !== 'object') {
    return { valid: false, errors: ['Change must be a non-null object.'] };
  }

  if (!change.type || !CHANGE_TYPES[change.type]) {
    errors.push(`Invalid change type "${change.type}". Must be one of: ${Object.keys(CHANGE_TYPES).join(', ')}.`);
  }

  if (!change.targetId || typeof change.targetId !== 'string') {
    errors.push('Missing or invalid "targetId".');
  } else if (!graph.nodes.has(change.targetId)) {
    errors.push(`Target component "${change.targetId}" not found in the graph.`);
  }

  // Check required params
  if (change.type && CHANGE_TYPES[change.type]) {
    const spec = CHANGE_TYPES[change.type];
    const params = change.params || {};

    for (const p of spec.requiredParams) {
      if (!params[p] && params[p] !== 0) {
        errors.push(`Missing required param "${p}" for change type "${change.type}".`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Run a full simulation.
 * @param {Object} manifestOrGraph - Either a manifest (with components/edges) or a pre-built graph
 * @param {Object} change - { type, targetId, params }
 * @returns {{ change, affected, chains, score, label, counts }}
 * @throws {Object} { status: 400|422, errors: string[] }
 */
function simulate(manifestOrGraph, change) {
  // Build graph if we got a manifest
  let graph;
  if (manifestOrGraph.nodes instanceof Map) {
    graph = manifestOrGraph;
  } else {
    graph = buildGraph(manifestOrGraph);
  }

  // Validate the change
  const validation = validateChange(graph, change);
  if (!validation.valid) {
    const err = new Error('Invalid change');
    err.status = 422;
    err.errors = validation.errors;
    throw err;
  }

  // Run propagation
  const affected = propagate(graph, change);

  // Extract unique chains (paths) from affected
  const chains = affected.map(a => a.path);

  // Calculate blast radius
  const { score, label, counts } = blastRadius(graph, change.targetId, affected);

  return {
    change,
    affected,
    chains,
    score,
    label,
    counts
  };
}

module.exports = { simulate, validateChange, CHANGE_TYPES };
