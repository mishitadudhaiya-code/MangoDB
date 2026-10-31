/**
 * src/engine/templates.js — Deterministic reason and recommendation templates
 * Built from change type, status, edge kind, and params.
 */

/**
 * Generate a human-readable reason for why a component is affected.
 * @param {Object} opts
 * @param {string} opts.changeType - The change type (RENAME_FIELD, etc.)
 * @param {string} opts.status - BROKEN, AT_RISK, UNCERTAIN
 * @param {string} opts.edgeKind - The edge kind (reads, writes, calls, etc.)
 * @param {Object} opts.params - Change params
 * @param {string} opts.targetName - Name of the change target
 * @param {string} opts.viaName - Name of the intermediate component (for depth 2+)
 * @param {number} opts.depth - Depth in the propagation chain
 * @param {boolean} opts.isDynamic - Whether any edge on the path is dynamic
 * @returns {string}
 */
function buildReason({ changeType, status, edgeKind, params, targetName, viaName, depth, isDynamic }) {
  if (isDynamic && status === 'UNCERTAIN') {
    return `Uses dynamic access — cannot statically determine if it depends on ${targetName}. Needs manual review.`;
  }

  const via = depth > 1 && viaName ? ` through ${viaName} (${edgeKind})` : ` (${edgeKind})`;

  switch (changeType) {
    case 'RENAME_FIELD':
      if (status === 'BROKEN' && edgeKind === 'writes') {
        return `Writes to renamed field "${params.from}"${via}.`;
      }
      if (status === 'BROKEN') {
        return `Reads renamed field "${params.from}"${via}.`;
      }
      return `Potentially affected by rename of "${params.from}" to "${params.to}"${via}.`;

    case 'DELETE_FIELD':
      if (status === 'BROKEN') {
        return `Depends on deleted field${via}.`;
      }
      return `Potentially affected by field deletion${via}.`;

    case 'CHANGE_FIELD_TYPE':
      return `Field type changed from "${params.from}" to "${params.to}" — may cause type errors${via}.`;

    case 'DELETE_ENDPOINT':
      if (status === 'BROKEN') {
        return `Calls deleted endpoint${via}.`;
      }
      return `Potentially affected by endpoint deletion${via}.`;

    case 'CHANGE_FUNCTION_SIGNATURE':
      if (status === 'BROKEN') {
        return `Calls function with changed signature — ${params.description || 'signature changed'}${via}.`;
      }
      return `Potentially affected by function signature change${via}.`;

    case 'CHANGE_CONFIG':
      return `Depends on config "${params.key}" (changed from "${params.from}" to "${params.to}")${via}.`;

    case 'UPGRADE_DEPENDENCY_MAJOR':
      if (status === 'BROKEN') {
        return `Uses API removed in major upgrade from ${params.from} to ${params.to}${via}.`;
      }
      return `Potentially affected by major version upgrade from ${params.from} to ${params.to}${via}.`;

    default:
      return `Potentially affected by ${changeType}${via}.`;
  }
}

/**
 * Generate a recommendation for how to fix the affected component.
 * @param {Object} opts - Same as buildReason
 * @returns {string}
 */
function buildRecommendation({ changeType, status, edgeKind, params, componentName, targetName, isDynamic }) {
  if (isDynamic && status === 'UNCERTAIN') {
    return `Manually inspect ${componentName} for dynamic references to ${targetName}.`;
  }

  switch (changeType) {
    case 'RENAME_FIELD':
      if (edgeKind === 'writes') {
        return `Update ${componentName} to write "${params.to}" instead of "${params.from}".`;
      }
      return `Update ${componentName} to read "${params.to}" instead of "${params.from}".`;

    case 'DELETE_FIELD':
      return `Remove references to the deleted field in ${componentName}, or provide a fallback.`;

    case 'CHANGE_FIELD_TYPE':
      return `Update ${componentName} to handle the new type "${params.to}" (was "${params.from}").`;

    case 'DELETE_ENDPOINT':
      return `Update ${componentName} to remove calls to the deleted endpoint, or use an alternative.`;

    case 'CHANGE_FUNCTION_SIGNATURE':
      return `Update ${componentName} to match the new function signature: ${params.description || 'check parameters'}.`;

    case 'CHANGE_CONFIG':
      return `Review ${componentName} for sensitivity to config "${params.key}" change (${params.from} → ${params.to}).`;

    case 'UPGRADE_DEPENDENCY_MAJOR':
      if (status === 'BROKEN') {
        return `Migrate ${componentName} away from removed API before upgrading to ${params.to}.`;
      }
      return `Test ${componentName} for compatibility with version ${params.to}.`;

    default:
      return `Review ${componentName} for impact from ${changeType}.`;
  }
}

module.exports = { buildReason, buildRecommendation };
