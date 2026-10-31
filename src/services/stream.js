/**
 * src/services/stream.js — Server-Sent Events (SSE) & MongoDB Change Stream Manager
 * Features:
 * 1. SSE client connection registry with heartbeats every 20s
 * 2. MongoDB Change Stream on `events` collection (inserts only)
 * 3. Fallback polling every 3s if change streams are unsupported (e.g. non-replica set)
 * 4. In-process instant broadcast hook for zero-latency UI updates
 */
const { getDb } = require('../db/index');

const clients = new Set();
let heartbeatInterval = null;
let changeStream = null;
let pollInterval = null;
let lastSeenAt = new Date();

/**
 * Broadcast an event document to all connected SSE clients.
 * @param {Object} eventDoc
 */
function broadcast(eventDoc) {
  if (clients.size === 0) return;
  const payload = `data: ${JSON.stringify(eventDoc)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch (_err) {
      clients.delete(client);
    }
  }
}

/**
 * Handle new SSE client connection: GET /api/stream
 */
function handleStreamConnection(req, res) {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial comment/greeting
  res.write(': connected to BugBound event stream\n\n');

  clients.add(res);

  // Clean up on client disconnect
  req.on('close', () => {
    clients.delete(res);
  });
}

/**
 * Start heartbeat timer (every 20 seconds).
 */
function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    for (const client of clients) {
      try {
        client.write(': heartbeat\n\n');
      } catch (_err) {
        clients.delete(client);
      }
    }
  }, 20000);
}

/**
 * Fallback poller when Change Streams are unavailable (e.g. standalone Mongo)
 */
function startFallbackPolling(db) {
  if (pollInterval) return;
  console.log('[stream] Starting fallback polling on events every 3s');

  pollInterval = setInterval(async () => {
    try {
      if (clients.size === 0) return;
      const newEvents = await db.collection('events')
        .find({ at: { $gt: lastSeenAt } })
        .sort({ at: 1 })
        .toArray();

      for (const ev of newEvents) {
        if (ev.at > lastSeenAt) lastSeenAt = ev.at;
        broadcast(ev);
      }
    } catch (_err) {
      // Ignore polling errors
    }
  }, 3000);
}

/**
 * Initialize change stream on events collection, with fallback to polling.
 */
async function initChangeStream() {
  startHeartbeat();

  try {
    const db = getDb();

    // Pipeline: match inserts only
    const pipeline = [
      { $match: { operationType: 'insert' } }
    ];

    changeStream = db.collection('events').watch(pipeline, { fullDocument: 'updateLookup' });

    changeStream.on('change', (change) => {
      if (change.fullDocument) {
        if (change.fullDocument.at && change.fullDocument.at > lastSeenAt) {
          lastSeenAt = change.fullDocument.at;
        }
        broadcast(change.fullDocument);
      }
    });

    changeStream.on('error', (err) => {
      console.warn('[stream] MongoDB change stream error:', err.message);
      if (changeStream) {
        changeStream.close().catch(() => {});
        changeStream = null;
      }
      startFallbackPolling(db);
    });

    console.log('[stream] MongoDB Change Stream initialized on events collection');
  } catch (err) {
    console.warn('[stream] MongoDB Change Streams unavailable (requires replica set):', err.message);
    try {
      const db = getDb();
      startFallbackPolling(db);
    } catch (_dbErr) {
      console.warn('[stream] DB not connected yet; polling will start on first connection.');
    }
  }
}

/**
 * Close streams and intervals gracefully.
 */
function closeStream() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (pollInterval) clearInterval(pollInterval);
  if (changeStream) changeStream.close().catch(() => {});
  clients.clear();
}

module.exports = {
  handleStreamConnection,
  broadcast,
  initChangeStream,
  closeStream,
  getClientsCount: () => clients.size
};
