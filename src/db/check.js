/**
 * src/db/check.js — Print collections, validators, and indexes for judges
 * Run with: npm run db:check
 */
require('dotenv').config();
const { connect, getDb, close } = require('./index');
const { setup } = require('./setup');

async function main() {
  try {
    await connect();
    await setup();
    const db = getDb();

    console.log('\n=== BugBound Database Check ===\n');

    // List collections
    const collections = await db.listCollections().toArray();
    console.log('Collections:');
    for (const col of collections) {
      console.log(`  - ${col.name}`);
    }

    // Show validators
    console.log('\nValidators:');
    for (const col of collections) {
      if (col.options && col.options.validator) {
        console.log(`\n  ${col.name}:`);
        console.log(`    ${JSON.stringify(col.options.validator, null, 4).split('\n').join('\n    ')}`);
      }
    }

    // Show indexes
    console.log('\nIndexes:');
    for (const col of collections) {
      const indexes = await db.collection(col.name).indexes();
      if (indexes.length > 1) { // skip _id only
        console.log(`\n  ${col.name}:`);
        for (const idx of indexes) {
          const unique = idx.unique ? ' (UNIQUE)' : '';
          console.log(`    - ${idx.name}: ${JSON.stringify(idx.key)}${unique}`);
        }
      }
    }

    console.log('\n=== Check complete ===');
  } catch (err) {
    console.error('Database check failed:', err.message);
    process.exit(1);
  } finally {
    await close();
  }
}

main();
