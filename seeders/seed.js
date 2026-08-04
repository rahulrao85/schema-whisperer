/**
 * Schema Whisperer — Test Data Seeder
 * ====================================
 * Creates MongoDB collections with DELIBERATELY evolving/messy schemas
 * so the profiler has something interesting to discover.
 *
 * This simulates real-world schemaless collections:
 *   - Schema drift across versions (v1/v2/v3 fields)
 *   - Rare fields that only appear on a few docs (DataHub's blind spot)
 *   - Type conflicts (a field that's string in most docs, number in some)
 *   - Nested documents & arrays
 *
 * Run: node seeders/seed.js
 * (uses MONGO_URI from .env, defaults to localhost)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { MongoClient } = require('mongodb');

const DB_NAME = process.env.MONGO_DB || 'whisper_demo';

// ---------- generators ----------

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * USERS collection — classic schema evolution
 * - v1 (early, ~15% of docs): only name + email
 * - v2 (mid, ~35%): added phone
 * - v3 (recent, ~50%): added userId, profile (nested), tags (array)
 * Plus a RARE field "legacyUuid" on only ~0.5% (DataHub will miss this)
 */
function genUsers(n = 5000) {
  const firstNames = ['Rahul', 'Priya', 'Aisha', 'Wei', 'Maria', 'John', 'Fatima', 'Chen', 'Sofia', 'Omar'];
  const lastNames = ['Rao', 'Sharma', 'Khan', 'Zhang', 'Garcia', 'Smith', 'Patel', 'Liu', 'Rossi', 'Ali'];
  const docs = [];

  for (let i = 0; i < n; i++) {
    const roll = Math.random();
    const doc = {
      _id: i,
      name: `${randomChoice(firstNames)} ${randomChoice(lastNames)}`,
      email: `user${i}@example.com`,
      createdAt: new Date(Date.now() - randomInt(1, 730) * 86400000),
    };

    if (roll > 0.15) {
      // v2: phone added
      doc.phone = `+1-${randomInt(200, 999)}-${randomInt(100, 999)}-${randomInt(1000, 9999)}`;
    }
    if (roll > 0.50) {
      // v3: userId + nested profile + array tags
      doc.userId = `USR-${randomInt(10000, 99999)}`;
      doc.profile = {
        country: randomChoice(['US', 'IN', 'CN', 'GB', 'DE', 'BR']),
        tier: randomChoice(['free', 'pro', 'enterprise']),
        signupIp: `${randomInt(1, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`,
      };
      doc.tags = [randomChoice(['beta', 'vip', 'churned', 'reactivated', 'new'])];
    }

    // TYPE CONFLICT: 5% of docs have createdAt as a STRING not a Date
    if (Math.random() < 0.05) {
      doc.createdAt = doc.createdAt.toISOString();
    }

    // RARE FIELD: legacyUuid on only 0.5% of docs — DataHub's 1000-sample will miss this
    if (Math.random() < 0.005) {
      doc.legacyUuid = `legacy-${randomInt(100000, 999999)}`;
    }

    docs.push(doc);
  }
  return docs;
}

/**
 * ORDERS collection — financial data with messy types
 * - amount is usually a number but ~8% is a string ("$49.99")
 * - status field with enum drift (old: "paid"/"unpaid", new: "completed"/"pending"/"refunded")
 * - nested shipping address
 */
function genOrders(n = 8000) {
  const statuses = ['paid', 'unpaid', 'completed', 'pending', 'refunded', 'shipped'];
  const docs = [];

  for (let i = 0; i < n; i++) {
    const roll = Math.random();
    const doc = {
      _id: i,
      orderId: `ORD-${randomInt(100000, 999999)}`,
      customerId: `USR-${randomInt(10000, 99999)}`,
      status: roll > 0.4 ? randomChoice(['completed', 'pending', 'refunded', 'shipped']) : randomChoice(['paid', 'unpaid']),
      orderDate: new Date(Date.now() - randomInt(1, 365) * 86400000),
    };

    // amount: 92% number, 8% string (type conflict)
    const amt = Math.round(randomInt(5, 500) + Math.random() * 99) / 1;
    doc.amount = Math.random() < 0.92 ? amt : `$${amt.toFixed(2)}`;

    doc.shipping = {
      country: randomChoice(['US', 'IN', 'GB', 'DE']),
      method: randomChoice(['standard', 'express', 'overnight']),
      cost: randomInt(0, 50),
    };

    // RARE: only 0.3% have a giftWrap boolean
    if (Math.random() < 0.003) {
      doc.giftWrap = true;
      doc.giftMessage = `Happy ${randomChoice(['Birthday', 'Holidays', 'Anniversary'])}!`;
    }

    docs.push(doc);
  }
  return docs;
}

/**
 * EVENTS collection — IoT/analytics with nullable + rare fields
 */
function genEvents(n = 10000) {
  const docs = [];
  for (let i = 0; i < n; i++) {
    const doc = {
      _id: i,
      type: randomChoice(['click', 'view', 'purchase', 'signup', 'error']),
      ts: new Date(Date.now() - randomInt(0, 30) * 86400000),
      sessionId: `sess-${randomInt(10000, 99999)}`,
    };
    // nullable: device only on 70% of docs
    if (Math.random() < 0.7) {
      doc.device = randomChoice(['ios', 'android', 'web', 'desktop']);
    }
    // VERY rare: error details on 0.2%
    if (Math.random() < 0.002 && doc.type === 'error') {
      doc.errorStack = `Error: something failed at line ${randomInt(1, 500)}`;
    }
    docs.push(doc);
  }
  return docs;
}

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
  const client = new MongoClient(uri);

  console.log(`Connecting to MongoDB at ${uri} ...`);
  await client.connect();
  const db = client.db(DB_NAME);

  // Drop existing demo data for a clean run
  console.log(`Resetting database "${DB_NAME}"...`);
  try {
    await db.dropDatabase();
  } catch (e) {
    /* ignore if not exists */
  }
  // re-get db handle since we dropped it
  const dbFresh = client.db(DB_NAME);

  console.log('Seeding users (5000 docs, evolving schema)...');
  await dbFresh.collection('users').insertMany(genUsers(5000));

  console.log('Seeding orders (8000 docs, type conflicts)...');
  await dbFresh.collection('orders').insertMany(genOrders(8000));

  console.log('Seeding events (10000 docs, rare fields)...');
  await dbFresh.collection('events').insertMany(genEvents(10000));

  console.log('\n✅ Seed complete. Collections seeded:');
  const cols = await dbFresh.listCollections().toArray();
  for (const c of cols) {
    const count = await dbFresh.collection(c.name).estimatedDocumentCount();
    console.log(`   - ${c.name}: ${count} docs`);
  }

  console.log('\nThese collections contain the exact blind spots Schema Whisperer is built to find:');
  console.log('  • users.legacyUuid — rare field (0.5%), DataHub 1000-sample will miss it');
  console.log('  • users.createdAt — type conflict (Date vs string)');
  console.log('  • orders.amount — type conflict (number vs "$49.99" string)');
  console.log('  • events.errorStack — very rare field (0.2%)');

  await client.close();
}

main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
