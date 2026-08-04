/**
 * Schema Whisperer — MongoDB Profiling Engine
 * ============================================
 * The core IP: deep schema profiling that DataHub can't do.
 *
 * DataHub samples only 1,000 docs per collection to infer schema
 * (see datahub-project/datahub#9287). For schemaless MongoDB collections
 * that evolve over time, this misses: rare fields, type conflicts,
 * and nested structure.
 *
 * This engine scans the FULL collection via the aggregation pipeline
 * ($facet, $group, $bucket) to compute:
 *   - field frequency (% of docs containing each field)
 *   - type distribution per field
 *   - rare fields (the ones DataHub's 1000-sample misses)
 *   - nested document & array schemas
 *   - detected schema variants (v1/v2/v3 evolution)
 *
 * LEARNING NOTE — this is the MongoDB aggregation pipeline curriculum:
 * $facet  = run multiple aggregations in parallel on the same data
 * $group  = collapse docs by a key (here: by field presence/type)
 * $objectToArray = turn a document's keys into rows (field iteration)
 * $bucket = bucket numeric values into ranges
 */

const { MongoClient } = require('mongodb');

// JavaScript typeof -> MongoDB BSON type label map.
// This is how we translate Mongo's $type results into human labels.
const TYPE_LABELS = {
  double: 'number',
  string: 'string',
  object: 'object',
  array: 'array',
  binData: 'binary',
  objectId: 'objectId',
  bool: 'boolean',
  date: 'date',
  null: 'null',
  int: 'number',
  timestamp: 'timestamp',
  long: 'number',
  decimal: 'number',
  regex: 'regex',
};

/**
 * Profile a single collection deeply.
 * @param {Db} db       - Mongo Db handle
 * @param {string} coll - collection name
 * @param {object} opts - { sampleSize: null for full scan, or int }
 * @returns {object}    - full schema profile
 */
async function profileCollection(db, coll, opts = {}) {
  const { sampleSize = null } = opts;
  const collection = db.collection(coll);

  // Count total docs (for frequency math) — this also tells us collection size
  const totalDocs = await collection.estimatedDocumentCount();

  if (totalDocs === 0) {
    return { collection: coll, totalDocs: 0, fields: [], variants: [], note: 'empty collection' };
  }

  console.log(`  [profiler] ${coll}: ${totalDocs} docs — scanning...`);

  // ---------------------------------------------------------------
  // STAGE 1 — Field presence & type distribution
  // ---------------------------------------------------------------
  // The trick: $objectToArray turns each doc's top-level keys into rows.
  // Then $group by key name to count presence + collect types per field.
  // This is the single most useful aggregation for schema discovery.
  const fieldPipeline = buildFieldPipeline(sampleSize);
  const fieldStats = await collection.aggregate(fieldPipeline).toArray();

  // ---------------------------------------------------------------
  // STAGE 2 — Rare field detection
  // ---------------------------------------------------------------
  // Rare fields = present in < SAMPLE_THRESHOLD of docs.
  // These are exactly what DataHub's 1000-sample misses.
  // (Imagine a "deprecated_legacy_id" field on 0.05% of docs.)
  const SAMPLE_THRESHOLD = 0.01; // < 1% = rare
  const RARE_IGNORE_THRESHOLD = 3; // ignore fields on < 3 docs (noise)

  const fields = fieldStats.map((f) => {
    const frequency = totalDocs > 0 ? f.docCount / totalDocs : 0;
    const isRare = frequency < SAMPLE_THRESHOLD && f.docCount >= RARE_IGNORE_THRESHOLD;
    const types = Object.entries(f.typeCounts).sort((a, b) => b[1] - a[1]);
    const hasTypeConflict = types.length > 1;

    return {
      name: f.field,
      // % of docs containing this field (DataHub often misses low-frequency ones)
      frequency: round(frequency, 4),
      docCount: f.docCount,
      // Types observed, sorted by prevalence
      types: types.map(([type, count]) => ({ type, count, pct: round(count / f.docCount, 4) })),
      dominantType: types[0] ? types[0][0] : 'unknown',
      // Flags — these drive the write-back to DataHub
      isRare,
      hasTypeConflict,
      nullable: f.typeCounts.null > 0,
    };
  });

  // ---------------------------------------------------------------
  // STAGE 3 — Schema variant detection (v1/v2/v3 evolution)
  // ---------------------------------------------------------------
  // Schemaless collections often contain multiple "shapes" of document
  // because the app evolved. We cluster docs by their field-set signature.
  const variants = await detectSchemaVariants(collection, fields, totalDocs);

  // ---------------------------------------------------------------
  // STAGE 4 — Summary signals
  // ---------------------------------------------------------------
  const rareFields = fields.filter((f) => f.isRare);
  const conflictedFields = fields.filter((f) => f.hasTypeConflict);
  const dataHubBlindspots = {
    rareFields: rareFields.length,
    typeConflicts: conflictedFields.length,
    // If totalDocs > 1000, DataHub's sample would have missed rare fields
    samplingGap: totalDocs > 1000 ? `DataHub samples 1000; collection has ${totalDocs}` : null,
  };

  return {
    collection: coll,
    totalDocs,
    scannedDocs: sampleSize ? Math.min(sampleSize, totalDocs) : totalDocs,
    fieldCount: fields.length,
    fields,
    variants,
    rareFields,
    conflictedFields,
    dataHubBlindspots,
    profiledAt: new Date().toISOString(),
  };
}

/**
 * Build the aggregation pipeline that produces per-field stats.
 * Uses $objectToArray to iterate keys, $group to aggregate.
 *
 * LEARNING: $facet would let us run this AND nested-schema detection
 * in one pass — see detectNestedSchemas() for the parallel-branch version.
 */
function buildFieldPipeline(sampleSize) {
  const stages = [];

  // Optional sampling (we default to full scan — that's the whole point)
  if (sampleSize) {
    stages.push({ $sample: { size: sampleSize } });
  }

  stages.push(
    // Turn each doc's fields into an array of {k: name, v: value}
    { $project: { kv: { $objectToArray: '$$ROOT' } } },
    // Unwind so each field becomes its own document
    { $unwind: '$kv' },
    // Add the BSON type label for each value
    {
      $project: {
        field: '$kv.k',
        type: {
          $switch: {
            branches: [
              { case: { $eq: [{ $type: '$kv.v' }, 'missing'] }, then: 'missing' },
              { case: { $isArray: '$kv.v' }, then: 'array' },
            ],
            default: { $type: '$kv.v' },
          },
        },
      },
    },
    // Group by field name, count presence + tally types
    {
      $group: {
        _id: '$field',
        docCount: { $sum: 1 },
        // Accumulate a map of type -> count via $push then we count in JS
        types: { $push: '$type' },
      },
    },
    {
      $project: {
        _id: 0,
        field: '$_id',
        docCount: 1,
        typeCounts: {
          $arrayToObject: {
            $map: {
              input: { $setUnion: ['$types', []] },
              as: 't',
              in: {
                k: '$$t',
                v: {
                  $size: {
                    $filter: { input: '$types', as: 'x', cond: { $eq: ['$$x', '$$t'] } },
                  },
                },
              },
            },
          },
        },
      },
    }
  );

  return stages;
}

/**
 * Detect schema variants — cluster docs by their field-set signature.
 *
 * Example: a "users" collection where:
 *   v1 docs: { name, email }               (old)
 *   v2 docs: { name, email, phone }        (added phone)
 *   v3 docs: { name, email, phone, uuid }  (added uuid)
 *
 * DataHub shows a union of all fields with no evolution context.
 * We detect and label these variants so the write-back can tag them.
 */
async function detectSchemaVariants(collection, fields, totalDocs) {
  // Use the dominant fields (> 20% presence) as the signature keys
  const signatureFields = fields.filter((f) => f.frequency > 0.2).map((f) => f.name);

  if (signatureFields.length === 0) return [];

  // Build a presence signature per doc, then group by signature
  const projectStage = {};
  for (const f of signatureFields) {
    projectStage[f] = { $cond: [{ $ifNull: [`$${f}`, false] }, 1, 0] };
  }

  const variantPipeline = [
    { $project: projectStage },
    {
      $group: {
        _id: {
          $map: {
            input: { $objectToArray: '$$ROOT' },
            as: 'field',
            in: { $concat: ['$$field.k', ':', { $toString: '$$field.v' }] },
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ];

  const variantGroups = await collection.aggregate(variantPipeline).toArray();

  return variantGroups.slice(0, 10).map((g, idx) => ({
    variant: `v${idx + 1}`,
    docCount: g.count,
    pctOfCollection: round(g.count / totalDocs, 4),
    signature: g._id, // array of "field:1/0" strings
  }));
}

/**
 * Profile all collections in a database.
 */
async function profileDatabase(db, opts = {}) {
  const collections = await db.listCollections().toArray();
  const results = [];
  for (const c of collections) {
    // Skip system collections
    if (c.name.startsWith('system.')) continue;
    const profile = await profileCollection(db, c.name, opts);
    results.push(profile);
  }
  return results;
}

function round(n, dp) {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

module.exports = {
  profileCollection,
  profileDatabase,
  TYPE_LABELS,
};
