'use strict';

const assert = require('assert');
const { EmbeddingService, cosine } = require('../server/rag/embeddingService');
const {
  buildIssueChunks,
  buildPullRequestChunks,
  buildCommitTextChunks,
} = require('../server/rag/ingestionService');
const { RagRetrievalService } = require('../server/rag/retrievalService');
const { RagGenerationService } = require('../server/rag/generationService');

process.env.OPENAI_API_KEY = '';

class MemoryStore {
  constructor(embeddingService) {
    this.embeddingService = embeddingService;
    this.rows = [];
  }

  async upsertChunks(chunks) {
    const result = await this.embeddingService.embedMany(chunks.map(chunk => chunk.content));
    this.rows = chunks.map((chunk, index) => ({
      ...chunk,
      id: index + 1,
      embedding: result.embeddings[index],
    }));
    return { chunks: chunks.length, ...result };
  }

  async searchByEmbedding(queryEmbedding, options = {}) {
    const queryMetadata = options.metadata || {};
    return this.rows
      .map(row => ({
        id: row.id,
        sourceKey: row.sourceKey,
        documentType: row.documentType,
        repo: row.repo,
        title: row.title,
        content: row.content,
        sourceUrl: row.sourceUrl,
        metadata: row.metadata,
        score: cosine(queryEmbedding, row.embedding),
      }))
      .filter(row => row.score > 0.12)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK || 8)
      .map(row => ({
        ...row,
        similarity: Math.round(row.score * 100),
        reason: queryMetadata.errorType && row.metadata.errorType === queryMetadata.errorType
          ? `same error type (${queryMetadata.errorType})`
          : 'semantic match',
      }));
  }
}

async function run() {
  const issue = {
    id: 101,
    number: 7,
    title: 'ZeroDivisionError in payment total',
    body: 'Checkout crashes with ZeroDivisionError when quantity is zero in payment.py.',
    state: 'closed',
    html_url: 'https://github.com/acme/shop/issues/7',
    user: { login: 'alice' },
    labels: [{ name: 'bug' }, { name: 'payments' }],
    created_at: '2026-01-01T00:00:00Z',
    closed_at: '2026-01-02T00:00:00Z',
  };
  const issueComments = [
    { body: 'Fixed by validating quantity before division.', user: { login: 'bob' } },
    { body: 'Unrelated discussion.', user: { login: 'cara' } },
  ];
  const issueChunks = buildIssueChunks(issue, 'acme/shop', issueComments);
  assert(issueChunks.length >= 1, 'issue ingestion creates chunks');
  assert.strictEqual(issueChunks[0].metadata.issueNumber, 7);
  assert.strictEqual(issueChunks[0].metadata.fixRelated, true);

  const commitChunks = buildCommitTextChunks(
    'Fix ZeroDivisionError in payment.py\n\n- total / quantity\n+ if quantity == 0: return 0',
    { repo: 'acme/shop', commitHash: 'abc123' }
  );
  assert.strictEqual(commitChunks[0].metadata.commitHash, 'abc123');
  assert(commitChunks[0].metadata.fileNames.includes('payment.py'));

  const prChunks = buildPullRequestChunks({
    id: 55,
    number: 12,
    title: 'Guard zero quantity checkout',
    body: 'Adds validation to prevent division by zero.',
    state: 'closed',
    merged_at: '2026-01-03T00:00:00Z',
    html_url: 'https://github.com/acme/shop/pull/12',
    user: { login: 'dev' },
    labels: [{ name: 'bugfix' }],
    created_at: '2026-01-03T00:00:00Z',
  }, 'acme/shop');
  assert.strictEqual(prChunks[0].metadata.prNumber, 12);
  assert.strictEqual(prChunks[0].metadata.fixStatus, 'fixed');

  const embeddings = new EmbeddingService({ apiKey: '' });
  const store = new MemoryStore(embeddings);
  await store.upsertChunks([...issueChunks, ...commitChunks, ...prChunks]);
  const retrieval = new RagRetrievalService(store, embeddings);
  const similar = await retrieval.searchSimilar({
    text: 'ZeroDivisionError in checkout when quantity is zero',
    metadata: { errorType: 'ZeroDivisionError', fileNames: ['payment.py'] },
    topK: 3,
  });
  assert(similar.matches.length > 0, 'retrieval finds similar bug');
  assert(/ZeroDivisionError|zero/i.test(similar.matches[0].content));

  const noMatch = await retrieval.searchSimilar({
    text: 'WebGL shader flickers when resizing canvas',
    topK: 3,
  });
  assert.strictEqual(noMatch.matches.length, 0, 'no-match behavior returns empty matches');

  const generator = new RagGenerationService({ apiKey: '' });
  const analysis = await generator.generate({
    input: 'Checkout throws ZeroDivisionError for zero quantity.',
    matches: similar.matches,
  });
  assert(analysis.bugSummary, 'generation returns summary');
  assert(analysis.suggestedFix, 'generation returns suggested fix');
  assert(analysis.similarReferences.length > 0, 'generation includes similar references');
}

run()
  .then(() => console.log('RAG tests passed'))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
