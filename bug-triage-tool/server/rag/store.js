'use strict';

const { cosine } = require('./embeddingService');
const { cleanText, unique } = require('./text');

class RagStore {
  constructor(pool, embeddingService, options = {}) {
    this.pool = pool;
    this.embeddingService = embeddingService;
    this.logger = options.logger || console;
  }

  async ensureSchema() {
    await this.pool.query(`
      create table if not exists rag_documents (
        id bigserial primary key,
        source_key text not null,
        chunk_index int not null default 0,
        document_type text not null,
        repo text not null default '',
        title text not null default '',
        content text not null,
        embedding double precision[] not null default '{}',
        embedding_model text not null default '',
        source_url text,
        metadata jsonb not null default '{}',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (source_key, chunk_index)
      );
      create index if not exists idx_rag_documents_source_key on rag_documents(source_key);
      create index if not exists idx_rag_documents_repo on rag_documents(repo);
      create index if not exists idx_rag_documents_type on rag_documents(document_type);
      create index if not exists idx_rag_documents_metadata on rag_documents using gin(metadata);
    `);
  }

  async upsertChunks(chunks) {
    if (!chunks?.length) return { chunks: 0, provider: 'none', model: 'none', fallback: false };
    const texts = chunks.map(chunk => [
      chunk.title,
      chunk.documentType,
      chunk.repo,
      chunk.content,
      (chunk.metadata?.labels || []).join(' '),
      (chunk.metadata?.fileNames || []).join(' '),
    ].filter(Boolean).join('\n'));
    const embeddingResult = await this.embeddingService.embedMany(texts);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      await this.pool.query(
        `insert into rag_documents (
          source_key, chunk_index, document_type, repo, title, content,
          embedding, embedding_model, source_url, metadata
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (source_key, chunk_index) do update set
          document_type = excluded.document_type,
          repo = excluded.repo,
          title = excluded.title,
          content = excluded.content,
          embedding = excluded.embedding,
          embedding_model = excluded.embedding_model,
          source_url = excluded.source_url,
          metadata = excluded.metadata,
          updated_at = now()`,
        [
          chunk.sourceKey,
          chunk.chunkIndex || 0,
          chunk.documentType,
          chunk.repo || '',
          cleanText(chunk.title).slice(0, 240),
          chunk.content,
          embeddingResult.embeddings[i] || [],
          embeddingResult.model,
          chunk.sourceUrl || null,
          JSON.stringify(chunk.metadata || {}),
        ]
      );
    }

    return {
      chunks: chunks.length,
      provider: embeddingResult.provider,
      model: embeddingResult.model,
      fallback: embeddingResult.fallback,
    };
  }

  async searchByEmbedding(queryEmbedding, options = {}) {
    if (!queryEmbedding?.length) return [];
    const topK = Math.max(1, Math.min(Number(options.topK || 8), 25));
    const filters = options.filters || {};
    const params = [];
    const where = [];
    if (filters.repo) {
      params.push(filters.repo);
      where.push(`repo = $${params.length}`);
    }
    if (filters.documentType) {
      params.push(filters.documentType);
      where.push(`document_type = $${params.length}`);
    }

    const sql = `
      select *
      from rag_documents
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by updated_at desc
      limit 5000`;
    const { rows } = await this.pool.query(sql, params);
    if (!rows.length) return [];

    const queryMetadata = options.metadata || {};
    const scored = rows.map(row => {
      const semantic = Math.max(0, cosine(queryEmbedding, row.embedding || []));
      const boost = metadataBoost(queryMetadata, row.metadata || {});
      const score = Math.min(1, semantic + boost);
      return toResult(row, score, semantic, boost, queryMetadata);
    });

    return scored
      .filter(item => item.score > 0.08)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async getDocument(id) {
    const { rows } = await this.pool.query('select * from rag_documents where id = $1', [id]);
    return rows[0] ? toResult(rows[0], null, null, null, {}) : null;
  }

  async getSourceDetails(sourceKey) {
    const { rows } = await this.pool.query(
      'select * from rag_documents where source_key = $1 order by chunk_index asc',
      [sourceKey]
    );
    return rows.map(row => toResult(row, null, null, null, {}));
  }

  async count() {
    const { rows } = await this.pool.query('select count(*)::int as count from rag_documents');
    return rows[0]?.count || 0;
  }
}

function metadataBoost(query = {}, doc = {}) {
  let boost = 0;
  const queryFiles = new Set(query.fileNames || []);
  const docFiles = new Set(doc.fileNames || []);
  const queryLabels = new Set((query.labels || []).map(v => String(v).toLowerCase()));
  const docLabels = new Set((doc.labels || []).map(v => String(v).toLowerCase()));

  if (query.repo && doc.repo && query.repo === doc.repo) boost += 0.06;
  if (query.language && doc.language && query.language === doc.language) boost += 0.04;
  if (query.errorType && doc.errorType && query.errorType === doc.errorType) boost += 0.08;
  if ([...queryFiles].some(file => docFiles.has(file))) boost += 0.08;
  if ([...queryLabels].some(label => docLabels.has(label))) boost += 0.05;
  if (doc.fixStatus === 'fixed' || doc.fixRelated) boost += 0.03;
  return boost;
}

function reasonForMatch(query = {}, metadata = {}, semantic = 0, boost = 0) {
  const reasons = [];
  if (semantic >= 0.6) reasons.push('high semantic similarity');
  else if (semantic >= 0.35) reasons.push('moderate semantic similarity');
  else reasons.push('shared bug terminology');
  if (query.errorType && metadata.errorType === query.errorType) reasons.push(`same error type (${query.errorType})`);
  if (query.language && metadata.language === query.language) reasons.push(`same language (${query.language})`);
  const files = unique(query.fileNames || []).filter(file => (metadata.fileNames || []).includes(file));
  if (files.length) reasons.push(`same file/module (${files.slice(0, 2).join(', ')})`);
  if (boost > 0) reasons.push('metadata match boosted ranking');
  return reasons.join('; ');
}

function toResult(row, score, semantic, boost, queryMetadata) {
  const metadata = row.metadata || {};
  return {
    id: row.id,
    sourceKey: row.source_key,
    chunkIndex: row.chunk_index,
    documentType: row.document_type,
    repo: row.repo,
    title: row.title,
    content: row.content,
    sourceUrl: row.source_url,
    metadata,
    score,
    similarity: score === null ? null : Math.round(score * 100),
    semanticScore: semantic,
    metadataBoost: boost,
    reason: score === null ? '' : reasonForMatch(queryMetadata, metadata, semantic, boost),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { RagStore, metadataBoost, reasonForMatch };
