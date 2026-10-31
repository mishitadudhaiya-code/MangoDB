/**
 * src/db/setup.js — Idempotent database setup
 * Creates collections with $jsonSchema validators, and all indexes from section 9.
 * Safe to run on every server start.
 */
const { getDb } = require('./index');

/**
 * Create a collection if it doesn't exist, optionally with a validator.
 */
async function ensureCollection(db, name, validator) {
  const collections = await db.listCollections({ name }).toArray();
  if (collections.length === 0) {
    const opts = {};
    if (validator) {
      opts.validator = validator;
      opts.validationLevel = 'strict';
      opts.validationAction = 'error';
    }
    await db.createCollection(name, opts);
    console.log(`  Created collection: ${name}`);
  } else {
    // Update validator if provided
    if (validator) {
      await db.command({
        collMod: name,
        validator: validator,
        validationLevel: 'strict',
        validationAction: 'error'
      });
      console.log(`  Updated validator for: ${name}`);
    } else {
      console.log(`  Collection exists: ${name}`);
    }
  }
}

/**
 * Create an index safely (ignores if it already exists).
 */
async function ensureIndex(db, collName, keys, options = {}) {
  try {
    const result = await db.collection(collName).createIndex(keys, options);
    console.log(`  Index on ${collName}: ${JSON.stringify(keys)} -> ${result}`);
  } catch (err) {
    // Index already exists with different options — that's fine for idempotent setup
    if (err.code === 85 || err.code === 86) {
      console.log(`  Index on ${collName}: ${JSON.stringify(keys)} (already exists)`);
    } else {
      throw err;
    }
  }
}

/**
 * Run the full idempotent setup: collections, validators, indexes.
 */
async function setup() {
  const db = getDb();
  console.log('Running database setup...');

  // --- Collections ---

  // projects: simple, no validator needed
  await ensureCollection(db, 'projects');

  // graph_versions: no schema validator (simple structure)
  await ensureCollection(db, 'graph_versions');

  // components: $jsonSchema validator
  await ensureCollection(db, 'components', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['projectId', 'versionId', 'componentId', 'type', 'name', 'criticality'],
      properties: {
        projectId: { bsonType: 'string', description: 'must be a string and is required' },
        versionId: { bsonType: 'string', description: 'must be a string and is required' },
        componentId: { bsonType: 'string', description: 'must be a string and is required' },
        type: {
          enum: ['field', 'table', 'api', 'function', 'page', 'service', 'config', 'package'],
          description: 'must be a valid component type'
        },
        name: { bsonType: 'string', description: 'must be a string and is required' },
        criticality: { bsonType: 'int', minimum: 1, maximum: 5, description: 'must be 1-5' }
      }
      // meta is free-form, not in required
    }
  });

  // dependency_edges: $jsonSchema validator
  await ensureCollection(db, 'dependency_edges', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['projectId', 'versionId', 'from', 'to', 'kind', 'dynamic'],
      properties: {
        projectId: { bsonType: 'string', description: 'must be a string and is required' },
        versionId: { bsonType: 'string', description: 'must be a string and is required' },
        from: { bsonType: 'string', description: 'must be a string and is required' },
        to: { bsonType: 'string', description: 'must be a string and is required' },
        kind: {
          enum: ['reads', 'writes', 'calls', 'returns', 'renders', 'configures', 'imports'],
          description: 'must be a valid edge kind'
        },
        dynamic: { bsonType: 'bool', description: 'must be a boolean and is required' }
      }
      // meta is free-form
    }
  });

  // simulations: no special validator
  await ensureCollection(db, 'simulations');

  // impact_reports: no special validator
  await ensureCollection(db, 'impact_reports');

  // events: $jsonSchema validator
  await ensureCollection(db, 'events', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['eventId', 'projectId', 'type', 'at', 'status'],
      properties: {
        eventId: { bsonType: 'string', description: 'must be a string and is required' },
        projectId: { bsonType: 'string', description: 'must be a string and is required' },
        type: {
          enum: ['MANIFEST_UPLOADED', 'MANIFEST_DUPLICATE', 'MANIFEST_REJECTED', 'SIMULATION_RUN', 'SIMULATION_CACHED'],
          description: 'must be a valid event type'
        },
        at: { bsonType: 'date', description: 'must be a date and is required' },
        status: {
          enum: ['ok', 'duplicate', 'rejected'],
          description: 'must be ok, duplicate, or rejected'
        }
      }
      // details is free-form
    }
  });

  // --- Indexes ---

  // projects
  await ensureIndex(db, 'projects', { name: 1 }, { unique: true });

  // graph_versions
  await ensureIndex(db, 'graph_versions', { projectId: 1, manifestHash: 1 }, { unique: true });
  await ensureIndex(db, 'graph_versions', { projectId: 1, createdAt: -1 });

  // components
  await ensureIndex(db, 'components', { versionId: 1, type: 1 });
  await ensureIndex(db, 'components', { versionId: 1, componentId: 1 }, { unique: true });

  // dependency_edges
  await ensureIndex(db, 'dependency_edges', { versionId: 1, to: 1 });
  await ensureIndex(db, 'dependency_edges', { versionId: 1, from: 1 });

  // simulations
  await ensureIndex(db, 'simulations', { projectId: 1, createdAt: -1 });
  await ensureIndex(db, 'simulations', { projectId: 1, score: -1 });

  // impact_reports
  await ensureIndex(db, 'impact_reports', { projectId: 1 });
  await ensureIndex(db, 'impact_reports', { 'affected.componentId': 1 });

  // events
  await ensureIndex(db, 'events', { eventId: 1 }, { unique: true });
  await ensureIndex(db, 'events', { projectId: 1, at: -1 });

  console.log('Database setup complete.');
}

module.exports = { setup };
