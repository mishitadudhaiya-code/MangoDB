/**
 * src/engine/hash.js — Canonicalization and hashing helpers (pure functions)
 */
const crypto = require('crypto');

/**
 * Canonicalize an object by sorting keys recursively, then stringify.
 * Used to produce deterministic hashes for manifests and changes.
 * @param {*} obj
 * @returns {string}
 */
function canonicalize(obj) {
  return JSON.stringify(sortKeys(obj));
}

/**
 * Recursively sort object keys.
 * @param {*} val
 * @returns {*}
 */
function sortKeys(val) {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return val.map(sortKeys);
  if (typeof val === 'object') {
    const sorted = {};
    for (const key of Object.keys(val).sort()) {
      sorted[key] = sortKeys(val[key]);
    }
    return sorted;
  }
  return val;
}

/**
 * SHA-256 hex hash of a string.
 * @param {string} str
 * @returns {string}
 */
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * SHA-1 hex hash of a string.
 * @param {string} str
 * @returns {string}
 */
function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

module.exports = { canonicalize, sha256, sha1, sortKeys };
