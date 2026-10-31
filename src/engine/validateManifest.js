/**
 * src/engine/validateManifest.js — Manifest validation (pure function)
 * Returns ALL errors at once so the user can fix everything in one pass.
 */

const VALID_TYPES = ['field', 'table', 'api', 'function', 'page', 'service', 'config', 'package'];
const VALID_KINDS = ['reads', 'writes', 'calls', 'returns', 'renders', 'configures', 'imports'];

/**
 * Validate a manifest object against the BugBound schema.
 * @param {Object} m - The manifest to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateManifest(m) {
  const errors = [];

  // Basic structure checks
  if (!m || typeof m !== 'object') {
    return { valid: false, errors: ['Manifest must be a non-null object.'] };
  }

  if (!m.project || typeof m.project !== 'string') {
    errors.push('Missing or invalid "project" field (must be a non-empty string).');
  }

  if (!m.version || typeof m.version !== 'string') {
    errors.push('Missing or invalid "version" field (must be a non-empty string).');
  }

  if (!Array.isArray(m.components)) {
    errors.push('"components" must be an array.');
    return { valid: false, errors };
  }

  if (!Array.isArray(m.edges)) {
    errors.push('"edges" must be an array.');
    return { valid: false, errors };
  }

  // Must have at least 2 components
  if (m.components.length < 2) {
    errors.push('Manifest must have at least 2 components.');
  }

  // Validate components and collect IDs
  const componentIds = new Set();
  const duplicateIds = new Set();

  for (let i = 0; i < m.components.length; i++) {
    const c = m.components[i];
    const prefix = `components[${i}]`;

    if (!c || typeof c !== 'object') {
      errors.push(`${prefix}: must be an object.`);
      continue;
    }

    if (!c.id || typeof c.id !== 'string') {
      errors.push(`${prefix}: missing or invalid "id".`);
    } else {
      if (componentIds.has(c.id)) {
        duplicateIds.add(c.id);
      }
      componentIds.add(c.id);
    }

    if (!c.type || !VALID_TYPES.includes(c.type)) {
      errors.push(`${prefix} (${c.id || '?'}): invalid "type" "${c.type}". Must be one of: ${VALID_TYPES.join(', ')}.`);
    }

    if (!c.name || typeof c.name !== 'string') {
      errors.push(`${prefix} (${c.id || '?'}): missing or invalid "name".`);
    }

    // Criticality: default 3 if missing, but validate if present
    if (c.criticality !== undefined && c.criticality !== null) {
      const crit = Number(c.criticality);
      if (!Number.isInteger(crit) || crit < 1 || crit > 5) {
        errors.push(`${prefix} (${c.id || '?'}): "criticality" must be an integer 1-5, got ${c.criticality}.`);
      }
    }
  }

  // Report duplicate IDs
  for (const dup of duplicateIds) {
    errors.push(`Duplicate component id: "${dup}".`);
  }

  // Validate edges
  for (let i = 0; i < m.edges.length; i++) {
    const e = m.edges[i];
    const prefix = `edges[${i}]`;

    if (!e || typeof e !== 'object') {
      errors.push(`${prefix}: must be an object.`);
      continue;
    }

    if (!e.from || typeof e.from !== 'string') {
      errors.push(`${prefix}: missing or invalid "from".`);
    } else if (!componentIds.has(e.from)) {
      errors.push(`${prefix}: "from" references unknown component "${e.from}".`);
    }

    if (!e.to || typeof e.to !== 'string') {
      errors.push(`${prefix}: missing or invalid "to".`);
    } else if (!componentIds.has(e.to)) {
      errors.push(`${prefix}: "to" references unknown component "${e.to}".`);
    }

    if (!e.kind || !VALID_KINDS.includes(e.kind)) {
      errors.push(`${prefix}: invalid "kind" "${e.kind}". Must be one of: ${VALID_KINDS.join(', ')}.`);
    }

    // No self-loops
    if (e.from && e.to && e.from === e.to) {
      errors.push(`${prefix}: self-loop detected (from "${e.from}" to itself).`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateManifest, VALID_TYPES, VALID_KINDS };
