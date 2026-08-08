/**
 * Schema Whisperer — LLM Reasoning Layer
 * =======================================
 * Turns raw profiling stats into human-meaningful metadata:
 *   - A rich description of what the collection holds
 *   - Inferred business glossary terms from field names
 *   - Detected schema-evolution narrative ("v1 -> v2 -> v3")
 *   - Recommendations (which fields need attention)
 *
 * Uses OpenRouter (we already use this for Astra StockSense & Hermes).
 * Falls back gracefully if no key is configured — the agent still works,
 * just with rule-based instead of LLM-enhanced descriptions.
 */

const axios = require('axios');

const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

class Reasoner {
  constructor({ apiKey = null, model = DEFAULT_MODEL } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  }

  get available() {
    return !!this.apiKey;
  }

  /**
   * Generate a rich dataset description from a schema profile.
   * This is what gets written back to DataHub via updateDescription().
   */
  async generateDescription(profile) {
    const prompt = this.buildDescriptionPrompt(profile);

    if (!this.available) {
      // Graceful fallback — rule-based description
      return this.fallbackDescription(profile);
    }

    try {
      const resp = await axios.post(
        this.endpoint,
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'You are a data catalog expert. Given a MongoDB schema profile, ' +
                'write a clear, precise 2-3 sentence dataset description suitable for ' +
                'a data catalog (DataHub). Be factual. Note any schema evolution or ' +
                'quality issues observed. No marketing language.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 300,
        },
        { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 20000 }
      );
      const content = resp.data.choices[0]?.message?.content?.trim();
      if (content) return content;
      console.error('  [reasoner] LLM returned empty content, using fallback');
      return this.fallbackDescription(profile);
    } catch (err) {
      console.error(`  [reasoner] LLM call failed, using fallback: ${err.message}`);
      return this.fallbackDescription(profile);
    }
  }

  buildDescriptionPrompt(profile) {
    const fieldSummary = profile.fields
      .slice(0, 20)
      .map(
        (f) =>
          `  - ${f.name} (${f.dominantType}, ${Math.round(f.frequency * 100)}% presence)${
            f.hasTypeConflict ? ' [TYPE CONFLICT]' : ''
          }${f.isRare ? ' [RARE]' : ''}`
      )
      .join('\n');

    return `MongoDB collection: "${profile.collection}"
Total documents: ${profile.totalDocs}
Fields detected: ${profile.fieldCount}

Fields:
${fieldSummary}

Schema variants detected: ${profile.variants.length}
${profile.variants.map((v) => `  - ${v.variant}: ${v.docCount} docs (${Math.round(v.pctOfCollection * 100)}%)`).join('\n')}

Notable issues:
- Rare fields (often missed by samplers): ${profile.rareFields.map((f) => f.name).join(', ') || 'none'}
- Type conflicts: ${profile.conflictedFields.map((f) => `${f.name} (${f.types.map((t) => t.type).join('/')})`).join(', ') || 'none'}

Write the dataset description:`;
  }

  /**
   * Infer glossary terms / business meaning from field names.
   * Returns suggested tag names (not URNs — caller maps those).
   */
  async inferTags(profile) {
    // Rule-based inference first (always runs, even without LLM)
    const tags = new Set();
    const fieldNames = profile.fields.map((f) => f.name.toLowerCase());

    // PII detection — this is genuinely useful for data governance
    const piiPatterns = {
      email: /\bemail|e-mail|mail\b/,
      phone: /\bphone|mobile|cell|tel\b/,
      ssn: /\bssn|social|aadhaar|pan\b/,
      name: /\bname|first.?name|last.?name|full.?name\b/,
      address: /\baddress|street|city|zip|postal|state\b/,
      dob: /\bdob|birth|birthday\b/,
      ip: /\bip(_address)?\b/,
      financial: /\bcard|account|balance|salary|amount|price|cost\b/,
    };

    for (const [pii, pattern] of Object.entries(piiPatterns)) {
      if (fieldNames.some((n) => pattern.test(n))) {
        tags.add(`pii-${pii}`);
      }
    }

    // Schema-health tags from the profile signals
    if (profile.conflictedFields.length > 0) tags.add('type-conflict');
    if (profile.rareFields.length > 0) tags.add('schema-evolving');
    if (profile.variants.length > 1) tags.add('multi-schema');

    // LLM-enhanced: ask for additional semantic tags if available
    if (this.available) {
      try {
        const llmTags = await this.llmInferTags(profile);
        llmTags.forEach((t) => tags.add(t));
      } catch (err) {
        // rule-based tags are fine
      }
    }

    return [...tags];
  }

  async llmInferTags(profile) {
    const resp = await axios.post(
      this.endpoint,
      {
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'Suggest 2-5 short lowercase kebab-case tags for a data catalog dataset ' +
              'based on its fields. Respond ONLY with a JSON array of strings. ' +
              'Examples: "customer-data", "transactions", "user-analytics".',
          },
          {
            role: 'user',
            content: `Collection: ${profile.collection}\nFields: ${profile.fields.map((f) => f.name).slice(0, 15).join(', ')}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 100,
      },
      { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 15000 }
    );
    const text = resp.data.choices[0].message.content.trim();
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  }

  /**
   * Generate a full diagnosis document (markdown) for write-back.
   * This is the "report" the next engineer reads.
   */
  generateReport(profile, description) {
    const lines = [];
    lines.push(`# Schema Whisperer — Deep Profile: \`${profile.collection}\``);
    lines.push('');
    lines.push(`**Profiled:** ${profile.profiledAt}`);
    lines.push(`**Documents:** ${profile.totalDocs} (scanned ${profile.scannedDocs})`);
    lines.push('');
    lines.push('## Description');
    lines.push(description);
    lines.push('');
    lines.push('## DataHub Blindspots Addressed');
    lines.push('');
    if (profile.dataHubBlindspots.samplingGap) {
      lines.push(`- ⚠️ **Sampling gap:** ${profile.dataHubBlindspots.samplingGap}`);
    }
    lines.push(`- Rare fields found: **${profile.dataHubBlindspots.rareFields}** (missed by 1,000-doc sample)`);
    lines.push(`- Type conflicts found: **${profile.dataHubBlindspots.typeConflicts}**`);
    lines.push('');
    lines.push('## Schema Variants (Evolution)');
    if (profile.variants.length > 1) {
      for (const v of profile.variants) {
        lines.push(`- **${v.variant}** — ${v.docCount} docs (${Math.round(v.pctOfCollection * 100)}%)`);
      }
    } else {
      lines.push('- Single consistent schema detected.');
    }
    lines.push('');
    lines.push('## Field Inventory');
    lines.push('| Field | Type | Presence | Flags |');
    lines.push('|-------|------|----------|-------|');
    for (const f of profile.fields) {
      const flags = [];
      if (f.isRare) flags.push('rare');
      if (f.hasTypeConflict) flags.push('type-conflict');
      if (f.nullable) flags.push('nullable');
      lines.push(`| \`${f.name}\` | ${f.dominantType} | ${Math.round(f.frequency * 100)}% | ${flags.join(', ') || '-'} |`);
    }
    lines.push('');
    lines.push('---');
    lines.push('_Generated by Schema Whisperer — deep MongoDB profiling for DataHub._');

    return lines.join('\n');
  }

  fallbackDescription(profile) {
    const parts = [
      `MongoDB collection "${profile.collection}" containing ${profile.totalDocs} documents.`,
    ];
    if (profile.variants.length > 1) {
      parts.push(`Shows schema evolution across ${profile.variants.length} variants.`);
    }
    if (profile.conflictedFields.length) {
      parts.push(`Contains ${profile.conflictedFields.length} fields with type conflicts.`);
    }
    parts.push(`${profile.fieldCount} fields mapped via deep profiling.`);
    return parts.join(' ');
  }
}

module.exports = { Reasoner };
