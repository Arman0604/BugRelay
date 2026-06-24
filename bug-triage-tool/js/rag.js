'use strict';

const RagClient = (() => {
  function metadataFromParsed(parsed, extra = {}) {
    return {
      ...extra,
      language: parsed?.language || '',
      errorType: parsed?.errors?.[0]?.type || '',
      labels: [
        ...(parsed?.bugSignatures || []),
        ...(parsed?.errors || []).map(error => error.type),
      ].filter(Boolean),
    };
  }

  function analyze(text, parsed, options = {}) {
    return Auth.request('POST', '/api/rag/analyze', {
      text,
      metadata: metadataFromParsed(parsed, options.metadata || {}),
      topK: options.topK || 8,
      filters: options.filters || {},
    });
  }

  function ingestCommit(commitText, metadata = {}) {
    return Auth.request('POST', '/api/rag/ingest', { commitText, metadata });
  }

  function ingestRepo(repo, token = '', maxItems = 25) {
    return Auth.request('POST', '/api/rag/ingest', { repo, token, maxItems });
  }

  function ingestRepoAsync(repo, token = '', maxItems = 10) {
    return Auth.requestAsync('POST', '/api/rag/ingest', {
      repo,
      token,
      maxItems,
      includeComments: false,
      includeCommitDetails: false,
    });
  }

  function getDetails(documentId) {
    return Auth.request('GET', `/api/rag/similar/${encodeURIComponent(documentId)}`);
  }

  function matchesToResults(matches = []) {
    return matches.map(match => ({
      id: match.metadata?.ticketId || `RAG-${match.id}`,
      title: match.title,
      description: match.content,
      status: match.metadata?.fixStatus === 'fixed' ? 'resolved' : 'open',
      priority: 'medium',
      language: match.metadata?.language || 'unknown',
      errorType: match.metadata?.errorType || '',
      tags: [
        match.documentType,
        match.repo,
        ...(match.metadata?.labels || []),
      ].filter(Boolean),
      solution: match.content,
      source: match.documentType || 'rag',
      sourceUrl: match.sourceUrl,
      similarity: match.similarity,
      metadata: match.metadata || {},
      _ragDocumentId: match.id,
      _ragReason: match.reason,
    }));
  }

  function documentAsTicket(documentId) {
    const payload = getDetails(documentId);
    const doc = payload.document;
    if (!doc) return null;
    const related = payload.relatedChunks || [];
    return {
      id: `RAG-${doc.id}`,
      title: doc.title,
      description: doc.content,
      status: doc.metadata?.fixStatus === 'fixed' ? 'resolved' : 'open',
      visibility: 'public',
      priority: 'medium',
      language: doc.metadata?.language || 'unknown',
      errorType: doc.metadata?.errorType || '',
      tags: [doc.documentType, doc.repo, ...(doc.metadata?.labels || [])].filter(Boolean),
      codeSnippetBefore: '',
      codeSnippetAfter: '',
      codeSnippetDiff: '',
      solution: related.map(chunk => chunk.content).join('\n\n').slice(0, 4000) || doc.content,
      suggestedFix: doc.content,
      suggestedFixes: [],
      category: '',
      logContent: '',
      severity: 'medium',
      confidence: doc.similarity,
      similarityLinks: [],
      metadata: doc.metadata || {},
      source: doc.documentType || 'rag',
      sourceUrl: doc.sourceUrl,
      createdBy: doc.metadata?.author || 'RAG Knowledge Base',
      createdAt: doc.metadata?.timestamp || doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  return { analyze, ingestCommit, ingestRepo, ingestRepoAsync, getDetails, matchesToResults, documentAsTicket };
})();

window.RagClient = RagClient;
