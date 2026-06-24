'use strict';

/**
 * SearchEngine — TF-IDF + cosine similarity over the ticket database
 */
const SearchEngine = (() => {

  /* ── build document text for a ticket ─────────────────────────── */
  function ticketToText(t) {
    return [
      t.title,
      t.description,
      t.errorType,
      t.solution,
      (t.tags || []).join(' '),
      t.codeSnippetBefore,
      t.codeSnippetAfter,
    ].filter(Boolean).join(' ');
  }

  function signatureTokens(signatures) {
    return (signatures || []).flatMap(sig => [sig, sig, sig]);
  }

  /* ── term frequency (normalised) ─────────────────────────────── */
  function buildTF(tokens) {
    const freq = {};
    tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
    const total = tokens.length || 1;
    const tf = {};
    Object.keys(freq).forEach(k => { tf[k] = freq[k] / total; });
    return tf;
  }

  /* ── build corpus IDF + per-doc TF-IDF vectors ────────────────── */
  function buildCorpus(tickets) {
    // Tokenise every ticket
    const docs = tickets.map(t => {
      const text = ticketToText(t);
      const signatures = Parser.extractBugSignatures(text);
      return {
        id: t.id,
        signatures,
        tokens: [
          ...Parser.tokenize(text),
          ...signatureTokens(signatures),
        ],
      };
    });

    const N = Math.max(docs.length, 1);

    // Document frequency per term
    const df = {};
    docs.forEach(d => {
      [...new Set(d.tokens)].forEach(tok => { df[tok] = (df[tok] || 0) + 1; });
    });

    // IDF: smooth to avoid division by zero
    const idf = {};
    Object.keys(df).forEach(tok => {
      idf[tok] = Math.log((N + 1) / (df[tok] + 1)) + 1;
    });

    // TF-IDF vector per doc
    const vectors = docs.map(d => {
      const tf = buildTF(d.tokens);
      const vec = {};
      Object.keys(tf).forEach(tok => {
        vec[tok] = tf[tok] * (idf[tok] || 1);
      });
      return { id: d.id, vec, signatures: d.signatures };
    });

    return { idf, vectors };
  }

  /* ── cosine similarity between two sparse vectors ─────────────── */
  function cosine(a, b) {
    let dot = 0, normA = 0, normB = 0;
    Object.keys(a).forEach(k => {
      normA += a[k] * a[k];
      if (b[k]) dot += a[k] * b[k];
    });
    Object.keys(b).forEach(k => { normB += b[k] * b[k]; });
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /* ── keyword boost (exact error-type match) ───────────────────── */
  function keywordBoost(ticket, errors) {
    if (!errors || errors.length === 0) return 1;
    const errTypes = errors.map(e => e.type.toLowerCase());
    const ticketText = ticketToText(ticket).toLowerCase();
    const matches = errTypes.filter(e => ticketText.includes(e.toLowerCase())).length;
    return 1 + (matches * 0.5);
  }

  function signatureScore(querySignatures, ticketSignatures) {
    if (!querySignatures || querySignatures.length === 0) return 0;
    if (!ticketSignatures || ticketSignatures.length === 0) return 0;

    const query = new Set(querySignatures);
    const ticket = new Set(ticketSignatures);
    let matches = 0;
    query.forEach(sig => {
      if (ticket.has(sig)) matches++;
    });

    const union = new Set([...query, ...ticket]).size || 1;
    return matches / union;
  }

  function normalizeCode(text) {
    return String(text || '')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function codeTokens(text) {
    return normalizeCode(text)
      .replace(/([()[\]{};<>!=+\-*/%])/g, ' $1 ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function jaccard(a, b) {
    const left = new Set(a);
    const right = new Set(b);
    if (!left.size || !right.size) return 0;
    let matches = 0;
    left.forEach(item => {
      if (right.has(item)) matches++;
    });
    return matches / new Set([...left, ...right]).size;
  }

  function codeMatchScore(queryText, ticket) {
    const query = normalizeCode(queryText);
    if (!query) return 0;

    const snippets = [
      { text: ticket.codeSnippetBefore, weight: 1 },
      { text: ticket.codeSnippetAfter, weight: 0.55 },
      { text: ticket.codeSnippetDiff, weight: 0.45 },
    ].filter(item => item.text);

    let best = 0;
    for (const snippet of snippets) {
      const candidate = normalizeCode(snippet.text);
      if (!candidate) continue;
      if (candidate === query) best = Math.max(best, 1 * snippet.weight);
      else if (candidate.includes(query) || query.includes(candidate)) best = Math.max(best, 0.96 * snippet.weight);
      else best = Math.max(best, jaccard(codeTokens(query), codeTokens(candidate)) * snippet.weight);
    }
    return best;
  }

  function exactCodeMatches(queryText, tickets, topK = 8) {
    return (tickets || [])
      .map(ticket => ({ ticket, score: codeMatchScore(queryText, ticket) }))
      .filter(item => item.score >= 0.72)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(item => ({
        ...item.ticket,
        similarity: Math.min(99, Math.max(88, Math.round(item.score * 100))),
        _rawScore: item.score,
        _matchType: 'code',
      }));
  }

  /* ── main search ──────────────────────────────────────────────── */
  function search(parsed, tickets, topK = 20) {
    if (!parsed || !parsed.queryTokens || parsed.queryTokens.length === 0) return [];
    if (!tickets || tickets.length === 0) return [];

    const { idf, vectors } = buildCorpus(tickets);
    const rawInput = parsed.raw || '';

    // Build query vector using corpus IDF; give partial credit for unseen terms
    const qTF = buildTF(parsed.queryTokens);
    const qVec = {};
    parsed.queryTokens.forEach(tok => {
      qVec[tok] = qTF[tok] * (idf[tok] ?? 0.5);
    });

    // Score every ticket
    const querySignatures = parsed.bugSignatures || [];
    const rawScores = vectors.map(({ id, vec, signatures }) => {
      const ticket = tickets.find(t => t.id === id);
      const codeScore = ticket ? codeMatchScore(rawInput, ticket) : 0;
      return {
        id,
        raw: cosine(qVec, vec) + (signatureScore(querySignatures, signatures) * 0.35) + (codeScore * 1.8),
        codeScore,
      };
    });

    // Apply keyword boost for matched error types
    const boosted = rawScores.map(s => {
      const ticket = tickets.find(t => t.id === s.id);
      const boost  = ticket ? keywordBoost(ticket, parsed.errors) : 1;
      return { id: s.id, score: s.raw * boost, codeScore: s.codeScore };
    });

    // Sort descending
    boosted.sort((a, b) => b.score - a.score);

    const maxScore = boosted[0]?.score || 0;

    // Map to result objects with percentage similarity
    const results = [];
    for (const { id, score } of boosted) {
      if (score < 0.008) break; // filter noise

      const ticket = tickets.find(t => t.id === id);
      if (!ticket) continue;

      // Scale: best match → up to 98%; linear relative to max
      const pct = maxScore > 0
        ? Math.min(98, Math.round((score / maxScore) * 95) + 3)
        : 0;

      results.push({ ...ticket, similarity: Math.max(pct, Math.round((boosted.find(s => s.id === id)?.codeScore || 0) * 100)), _rawScore: score });
    }

    return results.slice(0, topK);
  }

  /* ── quick search by keyword (for database tab filter) ─────────── */
  function quickFilter(query, tickets) {
    const q = query.toLowerCase().trim();
    if (!q) return tickets;
    return tickets.filter(t => {
      const text = ticketToText(t).toLowerCase();
      return text.includes(q) || t.id.toLowerCase().includes(q);
    });
  }

  return { search, quickFilter, exactCodeMatches };
})();
