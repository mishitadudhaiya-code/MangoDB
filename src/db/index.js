/**
 * src/db/index.js — MongoDB connection manager
 * Uses the official mongodb driver. Caches the client across requests.
 */
const { MongoClient } = require('mongodb');

let client = null;
let db = null;

/**
 * Connect to MongoDB Atlas (or local) using MONGODB_URI.
 * Returns the database instance. Caches the connection.
 */
async function connect() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is required. Set it in .env');
  }

  const dbName = process.env.DB_NAME || 'bugbound';

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);

  // Verify connection
  await db.command({ ping: 1 });
  console.log(`Connected to MongoDB database: ${dbName}`);

  return db;
}

/**
 * Get the cached database instance. Throws if not connected.
 */
function getDb() {
  if (!db) {
    throw new Error('Database not connected. Call connect() first.');
  }
  return db;
}

/**
 * Get the cached MongoClient instance.
 */
function getClient() {
  if (!client) {
    throw new Error('Database not connected. Call connect() first.');
  }
  return client;
}

/**
 * Close the connection gracefully.
 */
async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = { connect, getDb, getClient, close };
