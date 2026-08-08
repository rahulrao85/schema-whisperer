#!/usr/bin/env node
/**
 * Schema Whisperer — ONE command demo
 * Profiles ALL collections + writes enriched metadata back to DataHub.
 * Usage: node scripts/one-shot.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Whisperer } = require('../src/orchestrator');

async function main() {
  const whisperer = new Whisperer({
    mongoUri: process.env.MONGO_URI,
    mongoDb: process.env.MONGO_DB,
    mongoDatahubHost: process.env.MONGO_DATAHUB_HOST || 'atlas-cluster0',
    datahub: { gmsUrl: process.env.DATAHUB_GMS_URL, token: process.env.DATAHUB_TOKEN },
    llm: { apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL },
  });

  await whisperer.connect();
  const results = await whisperer.runAll({ writeToDataHub: true });

  console.log('\n===== DEMO SUMMARY =====');
  for (const r of results) {
    console.log(`\n📦 ${r.collection}`);
    console.log(`   Fields: ${r.profile.fieldCount} | Variants: ${r.profile.variants.length} | Rare: ${r.profile.rareFields.length} | Conflicts: ${r.profile.conflictedFields.length}`);
    console.log(`   Tags: ${r.tags.join(', ')}`);
    console.log(`   Write-back: ${r.writtenToDataHub ? '✅ SUCCESS' : '❌ ' + (r.dataHubError || r.dataHubNote || 'FAILED')}`);
  }

  await whisperer.close();
}

main().catch(e => { console.error('Failed:', e.message); process.exit(1); });
