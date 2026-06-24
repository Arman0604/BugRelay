'use strict';

const { cleanText, extractFileNames } = require('./text');

class RagRetrievalService {
  constructor(store, embeddingService, options = {}) {
    this.store = store;
    this.embeddingService = embeddingService;
    this.logger = options.logger || console;
  }

  async searchSimilar({ text, codeSnippet, metadata = {}, topK = 8, filters = {} }) {
    const queryText = cleanText([text, codeSnippet].filter(Boolean).join('\n\n'));
    if (!queryText) return { matches: [], reason: 'empty-query' };

    try {
      const embeddingResult = await this.embeddingService.embedOne(queryText);
      const queryMetadata = {
        ...metadata,
        fileNames: [...new Set([...(metadata.fileNames || []), ...extractFileNames(queryText)])],
      };
      const matches = await this.store.searchByEmbedding(embeddingResult.embedding, {
        topK,
        filters,
        metadata: queryMetadata,
      });
      return {
        matches,
        embeddingProvider: embeddingResult.provider,
        embeddingModel: embeddingResult.model,
        fallback: embeddingResult.fallback,
      };
    } catch (err) {
      this.logger.warn?.('[rag] retrieval failed:', err.message);
      return { matches: [], reason: 'retrieval-error', error: err.message, fallback: true };
    }
  }
}

module.exports = { RagRetrievalService };
