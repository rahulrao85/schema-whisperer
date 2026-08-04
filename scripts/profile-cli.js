#!/usr/bin/env node
/**
 * Schema Whisperer — CLI Profile Tool
 * ======================================
 * Quick way to profile a collection from the terminal.
 *
 * Usage:
 *   node scripts/profile-cli.js                     # profile all collections
 *   node scripts/profile-cli.js users               # profile single collection
 *   node scripts/profile-cli.js users --sample 100  # sample instead of full scan
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { MongoClient } = require('mongodb');
const { profileCollection, profileDatabase } = require('../src/profiler/profiler');
const { Reasoner } = require('../src/llm/reasoner');

const args = process.argv.slice(2);
const collectionName = args.find((a) => !a.startsWith('--'));
const sampleFlag = args.find((a) => a.startsWith('--sample'));
const sampleSize = sampleFlag ? parseInt(sampleFlag.split('=')[1] || sampleFlag.split(' ')[1]) : null;

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGO_DB || 'whisper_demo';

  console.log(`\n🔍 Schema Whisperer CLI`);
  console.log(`   MongoDB: ${uri}/${dbName}\n`);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const reasoner = new Reasoner({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL,
  });

  if (collectionName) {
    // Single collection profile
    console.log(`Profiling: ${collectionName}\n`);
    const profile = await profileCollection(db, collectionName, { sampleSize });
    const description = await reasoner.generateDescription(profile);
    const tags = await reasoner.inferTags(profile);
    const report = reasoner.generateReport(profile, description);

    console.log('--- PROFILE RESULT ---\n');
    console.log(`Collection: ${profile.collection}`);
    console.log(`Total docs: ${profile.totalDocs}`);
    console.log(`Fields found: ${profile.fieldCount}`);
    console.log(`Schema variants: ${profile.variants.length}`);
    console.log(`Rare fields: ${profile.rareFields.length}`);
    console.log(`Type conflicts: ${profile.conflictedFields.length}`);
    console.log(`\nDescription: ${description}`);
    console.log(`\nTags: ${tags.join(', ')}`);

    // Save report to examples/
    const fs = require('fs');
    const outPath = require('path').join(__dirname, '..', 'examples', `${collectionName}-profile.md`);
    fs.writeFileSync(outPath, report);
    console.log(`\n📄 Report saved: ${outPath}`);
  } else {
    // All collections
    console.log('Profiling all collections...\n');
    const profiles = await profileDatabase(db, { sampleSize });

    for (const p of profiles) {
      const description = await reasoner.generateDescription(p);
      console.log(`\n✅ ${p.collection}: ${p.fieldCount} fields, ${p.variants.length} variants, ${p.rareFields.length} rare`);
      console.log(`   ${description}`);

      const report = reasoner.generateReport(p, description);
      const tags = await reasoner.inferTags(p);

      const fs = require('fs');
      const outPath = require('path').join(__dirname, '..', 'examples', `${p.collection}-profile.md`);
      fs.writeFileSync(outPath, report);
    }

    console.log(`\n📄 Reports saved to examples/`);
  }

  await client.close();
}

main().catch((e) => {
  console.error('Profile failed:', e.message);
  process.exit(1);
});
