'use strict';

const { cleanText } = require('./text');

class EmbeddingService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = options.model || process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-small';
    this.fallbackModel = 'local-hash-384';
    this.dimensions = Number(process.env.RAG_LOCAL_EMBEDDING_DIMS || 384);
    this.logger = options.logger || console;
  }

  hasOpenAI() {
    return Boolean(this.apiKey);
  }

  async embedMany(texts) {
    const input = texts.map(text => cleanText(text).slice(0, 8000));
    if (!input.length) return { embeddings: [], provider: 'none', model: 'none', fallback: false };

    if (this.hasOpenAI()) {
      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: this.model, input }),
        });
        if (!response.ok) {
          const payload = await safeJson(response);
          throw new Error(payload?.error?.message || `OpenAI embeddings failed with ${response.status}`);
        }
        const payload = await response.json();
        const embeddings = (payload.data || [])
          .sort((a, b) => a.index - b.index)
          .map(item => item.embedding);
        return { embeddings, provider: 'openai', model: this.model, fallback: false };
      } catch (err) {
        this.logger.warn?.('[rag] embedding fallback:', err.message);
      }
    }

    return {
      embeddings: input.map(text => localEmbedding(text, this.dimensions)),
      provider: 'local',
      model: this.fallbackModel,
      fallback: true,
    };
  }

  async embedOne(text) {
    const result = await this.embedMany([text]);
    return { ...result, embedding: result.embeddings[0] || localEmbedding(text, this.dimensions) };
  }
}

async function safeJson(response) {
  try { return await response.json(); }
  catch { return null; }
}

function tokenHash(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tokenize(text) {
  return cleanText(text)
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9_./-]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2 && !/^\d+$/.test(token));
}

function localEmbedding(text, dimensions = 384) {
  const vector = new Array(dimensions).fill(0);
  for (const token of tokenize(text)) {
    const h = tokenHash(token);
    const idx = h % dimensions;
    const sign = (h & 1) === 0 ? 1 : -1;
    vector[idx] += sign * (1 + Math.min(token.length, 20) / 20);
  }
  return normalize(vector);
}

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map(value => value / norm);
}

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = { EmbeddingService, localEmbedding, cosine };
