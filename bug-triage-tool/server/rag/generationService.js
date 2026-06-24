'use strict';

const { cleanText } = require('./text');

class RagGenerationService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = options.model || process.env.RAG_GENERATION_MODEL || 'gpt-4.1-mini';
    this.logger = options.logger || console;
  }

  async generate({ input, matches = [], metadata = {} }) {
    if (!cleanText(input)) return fallbackAnalysis({ input, matches, metadata, reason: 'empty input' });
    if (!matches.length) return fallbackAnalysis({ input, matches, metadata, reason: 'no retrieved context' });

    if (this.apiKey) {
      try {
        const payload = await this.callOpenAI({ input, matches, metadata });
        const parsed = parseJsonPayload(payload);
        if (parsed) {
          return {
            ...normalizeAnalysis(parsed, matches),
            generatedBy: 'openai',
            model: this.model,
            fallback: false,
          };
        }
      } catch (err) {
        this.logger.warn?.('[rag] generation fallback:', err.message);
      }
    }

    return fallbackAnalysis({ input, matches, metadata, reason: 'local fallback' });
  }

  async callOpenAI({ input, matches, metadata }) {
    const context = matches.slice(0, 6).map((match, index) => ({
      index: index + 1,
      title: match.title,
      type: match.documentType,
      repo: match.repo,
      sourceUrl: match.sourceUrl,
      similarity: match.similarity,
      reason: match.reason,
      metadata: {
        issueNumber: match.metadata?.issueNumber,
        prNumber: match.metadata?.prNumber,
        commitHash: match.metadata?.commitHash,
        fileNames: match.metadata?.fileNames,
        labels: match.metadata?.labels,
        fixStatus: match.metadata?.fixStatus,
      },
      content: match.content.slice(0, 1800),
    }));
    const prompt = [
      'You are BugRelayAI RAG analysis. Use only the retrieved context below.',
      'If a fix is not directly supported by the context, mark it as a suggestion.',
      'Return strict JSON with keys: bugSummary, likelyRootCause, suggestedFix, similarReferences, confidenceLevel, duplicateAssessment.',
      'similarReferences must be an array with title, sourceUrl, similarity, and relevance.',
      '',
      `User input:\n${cleanText(input).slice(0, 6000)}`,
      '',
      `Input metadata:\n${JSON.stringify(metadata || {})}`,
      '',
      `Retrieved context:\n${JSON.stringify(context)}`,
    ].join('\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: prompt,
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      const payload = await safeJson(response);
      throw new Error(payload?.error?.message || `OpenAI generation failed with ${response.status}`);
    }
    const payload = await response.json();
    return extractOutputText(payload);
  }
}

async function safeJson(response) {
  try { return await response.json(); }
  catch { return null; }
}

function extractOutputText(payload) {
  if (payload.output_text) return payload.output_text;
  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n');
}

function parseJsonPayload(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); }
  catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); }
    catch { return null; }
  }
}

function normalizeAnalysis(payload, matches) {
  return {
    bugSummary: String(payload.bugSummary || 'Bug summary unavailable.'),
    likelyRootCause: String(payload.likelyRootCause || 'Root cause is unclear from retrieved context.'),
    suggestedFix: String(payload.suggestedFix || 'No context-backed fix was found. Treat any next step as a suggestion.'),
    similarReferences: Array.isArray(payload.similarReferences)
      ? payload.similarReferences
      : matches.map(toReference),
    confidenceLevel: String(payload.confidenceLevel || confidenceFromMatches(matches)),
    duplicateAssessment: String(payload.duplicateAssessment || duplicateAssessment(matches)),
  };
}

function fallbackAnalysis({ input, matches, reason }) {
  const top = matches[0];
  return {
    bugSummary: summarizeInput(input),
    likelyRootCause: top
      ? `Most similar prior context is "${top.title}". The likely root cause should be checked against that retrieved fix context.`
      : 'No similar historical bug was found in the RAG knowledge base.',
    suggestedFix: top
      ? `Suggestion based on retrieved context: review ${top.title} and apply the same guard, validation, rollback, or patch pattern only if it matches this code path.`
      : 'No context-backed fix is available. Fall back to the existing static analyzer and inspect logs, stack traces, recent changes, and input validation.',
    similarReferences: matches.map(toReference),
    confidenceLevel: confidenceFromMatches(matches),
    duplicateAssessment: duplicateAssessment(matches),
    generatedBy: 'local',
    model: 'local-extractive',
    fallback: true,
    reason,
  };
}

function summarizeInput(input) {
  const text = cleanText(input);
  if (!text) return 'No bug input was provided.';
  return text.split('\n').find(line => line.trim().length > 20)?.slice(0, 220) || text.slice(0, 220);
}

function confidenceFromMatches(matches) {
  const score = matches[0]?.similarity || 0;
  if (score >= 80) return 'high';
  if (score >= 55) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

function duplicateAssessment(matches) {
  const top = matches[0];
  if (!top) return 'new bug: no similar retrieved incident found';
  if ((top.similarity || 0) >= 85) return `possible duplicate of ${top.title}`;
  return 'likely new or related bug: retrieved context is similar but not definitive';
}

function toReference(match) {
  return {
    title: match.title,
    sourceUrl: match.sourceUrl,
    similarity: match.similarity,
    relevance: match.reason || 'semantic match',
  };
}

module.exports = { RagGenerationService, fallbackAnalysis, normalizeAnalysis };
