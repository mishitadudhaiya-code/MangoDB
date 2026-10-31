/**
 * src/db/events.js — Event logging for audit trail
 * Inserts into the events collection. Swallows duplicate-key errors (11000)
 * to make repeated ingestion safe (idempotent).
 */
const { getDb } = require('./index');
const crypto = require('crypto');

/**
 * Log an event to the events collection.
 * @param {Object} opts
 * @param {string} opts.projectId - The project this event belongs to
 * @param {string} opts.type - Event type (MANIFEST_UPLOADED, MANIFEST_DUPLICATE, etc.)
 * @param {string} opts.status - 'ok', 'duplicate', or 'rejected'
 * @param {Object} [opts.details] - Free-form details
 * @param {string} [opts.eventId] - Optional deterministic eventId; generated if not provided
 * @returns {Object} The inserted event document (or null if duplicate)
 */
  try {
    const db = getDb();
    // Generate eventId if not provided
    if (!eventId) {
      eventId = `${projectId}:${type}:${crypto.randomUUID()}`;
    }

    const doc = {
      eventId,
      projectId,
      type,
      at: new Date(),
      status,
      details
    };

    await db.collection('events').insertOne(doc);
    return doc;
  } catch (err) {
    // Swallow duplicate key errors — idempotent ingestion
    if (err.code === 11000) {
      console.log(`Event already logged: ${eventId}`);
      return null;
    }
    // If DB is not connected, log warning instead of crashing
    console.warn(`[events] Could not log event ${type}:`, err.message);
    return null;
  }

module.exports = { logEvent };
