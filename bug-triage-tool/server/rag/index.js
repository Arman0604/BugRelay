'use strict';

const { EmbeddingService } = require('./embeddingService');
const { RagStore } = require('./store');
const { RagIngestionService } = require('./ingestionService');
const { RagRetrievalService } = require('./retrievalService');
const { RagGenerationService } = require('./generationService');

function createRagServices({ pool, logger = console }) {
  const embeddingService = new EmbeddingService({ logger });
  const store = new RagStore(pool, embeddingService, { logger });
  const ingestion = new RagIngestionService(store, { logger });
  const retrieval = new RagRetrievalService(store, embeddingService, { logger });
  const generation = new RagGenerationService({ logger });

  async function analyze({ text, codeSnippet, metadata = {}, topK = 8, filters = {} }) {
    const retrievalResult = await retrieval.searchSimilar({ text, codeSnippet, metadata, topK, filters });
    const analysis = await generation.generate({
      input: [text, codeSnippet].filter(Boolean).join('\n\n'),
      matches: retrievalResult.matches,
      metadata,
    });
    return { ...retrievalResult, analysis };
  }

  return { embeddingService, store, ingestion, retrieval, generation, analyze };
}

module.exports = { createRagServices };
