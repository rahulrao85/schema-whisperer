#!/usr/bin/env node
/**
 * Reset DataHub demo state — clears description + tags from the 3 demo
 * datasets so the video can show the "before" (no metadata) state first.
 *
 * Usage: node scripts/reset-demo.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { DataHubClient } = require('../src/datahub/datahub');

const COLLECTIONS = ['users', 'orders', 'events'];
const TAG_NAMES = ['pii-email', 'pii-phone', 'pii-name', 'pii-financial', 'pii-ssn',
                   'type-conflict', 'schema-evolving', 'multi-schema'];

async function main() {
  const client = new DataHubClient({
    gmsUrl: process.env.DATAHUB_GMS_URL,
    token: process.env.DATAHUB_TOKEN,
  });

  for (const col of COLLECTIONS) {
    const urn = `urn:li:dataset:(urn:li:dataPlatform:mongodb,atlas-cluster0.whisper_demo.${col},PROD)`;
    console.log(`Resetting: ${col}`);

    // 1. Clear editable description
    try {
      await client.graphql(`
        mutation($urn: String!, $input: DatasetUpdateInput!) {
          updateDataset(urn: $urn, input: $input) { urn }
        }`, { urn, input: { editableProperties: { description: '' } } });
      console.log(`  ✓ description cleared`);
    } catch (e) {
      console.log(`  ✗ description: ${e.message.split('Root cause')[0].trim()}`);
    }

    // 2. Remove each tag (verified: removeTag takes TagAssociationInput)
    for (const tag of TAG_NAMES) {
      try {
        await client.graphql(`
          mutation($input: TagAssociationInput!) {
            removeTag(input: $input)
          }`, { input: { tagUrn: `urn:li:tag:${tag}`, resourceUrn: urn } });
      } catch (e) { /* tag wasn't attached — fine */ }
    }
    console.log(`  ✓ tags removed`);

    // 3. Verify
    const check = await client.graphql(`
      query($urn: String!) {
        dataset(urn: $urn) {
          editableProperties { description }
          tags { tags { tag { name } } }
        }
      }`, { urn });
    const d = check.dataset || {};
    const desc = (d.editableProperties && d.editableProperties.description) || '';
    const tags = (d.tags && d.tags.tags || []).map(t => t.tag.name);
    console.log(`  → description: "${desc ? desc.slice(0, 50) + '...' : '(empty)'}"`);
    console.log(`  → tags: ${tags.length ? tags.join(', ') : '(none)'}`);
    console.log('');
  }
  console.log('Reset complete. DataHub is in clean "before" state.');
}

main().catch(e => { console.error('Reset failed:', e.message); process.exit(1); });
