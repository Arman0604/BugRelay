'use strict';

const crypto = require('crypto');

const FIX_RE = /\b(fix(?:ed|es)?|resolve(?:d|s)?|patch|workaround|root cause|regression|bug|crash|exception|error)\b/i;
const FILE_RE = /[\w./\\-]+\.(?:py|js|ts|tsx|jsx|java|cpp|c|h|hpp|cs|php|rb|go|rs|sql|json|yaml|yml|md)\b/g;

function cleanText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function extractFileNames(text) {
  return unique((String(text || '').match(FILE_RE) || []).map(name => name.replace(/\\/g, '/')));
}

function isFixRelated(text, labels = []) {
  const labelText = labels.join(' ');
  return FIX_RE.test(`${labelText}\n${text || ''}`);
}

function chunkText(text, options = {}) {
  const maxChars = options.maxChars || 1400;
  const overlap = options.overlap || 180;
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(cleaned.length, start + maxChars);
    if (end < cleaned.length) {
      const paragraphBreak = cleaned.lastIndexOf('\n\n', end);
      const sentenceBreak = cleaned.lastIndexOf('. ', end);
      const spaceBreak = cleaned.lastIndexOf(' ', end);
      const preferred = [paragraphBreak, sentenceBreak, spaceBreak].find(idx => idx > start + maxChars * 0.55);
      if (preferred) end = preferred + (preferred === sentenceBreak ? 1 : 0);
    }
    const chunk = cleaned.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= cleaned.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

function buildChunks({ sourceKey, documentType, repo, title, content, metadata = {}, sourceUrl = null }) {
  const labels = metadata.labels || [];
  const fileNames = unique([...(metadata.fileNames || []), ...extractFileNames(content)]);
  return chunkText(content).map((chunk, index) => ({
    sourceKey,
    chunkIndex: index,
    documentType,
    repo: repo || metadata.repo || '',
    title: cleanText(title).slice(0, 240) || 'Untitled RAG document',
    content: chunk,
    sourceUrl,
    metadata: {
      ...metadata,
      labels,
      fileNames,
      fixRelated: metadata.fixRelated ?? isFixRelated(chunk, labels),
      contentHash: stableHash(chunk),
    },
  }));
}

function documentText(parts) {
  return cleanText(parts.filter(Boolean).join('\n\n'));
}

module.exports = {
  cleanText,
  stableHash,
  unique,
  extractFileNames,
  isFixRelated,
  chunkText,
  buildChunks,
  documentText,
};
