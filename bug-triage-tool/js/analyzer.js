'use strict';

/**
 * Analyzer - rule-based risky-pattern detector and finding lifecycle manager.
 */
const Analyzer = (() => {
  const DUPLICATE_THRESHOLD = 90;

  const RULES = [
    {
      id: 'division-by-zero',
      title: 'Possible division by zero',
      severity: 'high',
      errorType: 'ZeroDivisionRisk',
      tags: ['division', 'input-validation', 'runtime'],
      confidence: 78,
      detect: ctx => /\/\s*[a-zA-Z_]\w*/.test(ctx.content) &&
        !/(?:!==|!=|>|>=)\s*0|0\s*(?:!==|!=|<|<=)|zero|denominator|quantity|count/.test(ctx.lower),
      fix: 'Validate the denominator before division and define the behavior for zero or invalid values.',
    },
    {
      id: 'unsafe-index-access',
      title: 'Possible out-of-bounds index access',
      severity: 'medium',
      errorType: 'IndexBoundsRisk',
      tags: ['index', 'bounds-check', 'input-validation'],
      confidence: 76,
      detect: ctx => /\b\w+\s*\[\s*(?:\d+|[a-zA-Z_]\w*)\s*\]/.test(ctx.content) &&
        !/(?:length|len|size|count)\s*(?:>|>=|<=|<)|(?:>|>=|<=|<)\s*(?:length|len|size|count)/i.test(ctx.content),
      fix: 'Check the collection length or expected input shape before indexing.',
    },
    {
      id: 'unsafe-type-conversion',
      title: 'Unchecked type conversion',
      severity: 'medium',
      errorType: 'TypeConversionRisk',
      tags: ['type-conversion', 'input-validation'],
      confidence: 70,
      detect: ctx => /\b(?:int|float|Number|parseInt|parseFloat)\s*\(/.test(ctx.content) &&
        !/\b(?:try|catch|except|Number\.isNaN|isNaN|isdigit|isnumeric)\b/.test(ctx.content),
      fix: 'Validate the input and handle failed conversions explicitly.',
    },
    {
      id: 'unhandled-fetch',
      title: 'Unhandled async fetch failure',
      severity: 'high',
      errorType: 'UnhandledAsyncRisk',
      tags: ['javascript', 'async', 'fetch', 'error-handling'],
      confidence: 74,
      detect: ctx => /\bawait\s+fetch\s*\(|fetch\s*\(/.test(ctx.content) &&
        !/\b(?:try|catch|\.catch|response\.ok|res\.ok)\b/.test(ctx.content),
      fix: 'Wrap the request in try/catch, check response.ok, and surface a recoverable error path.',
    },
    {
      id: 'json-parse-no-guard',
      title: 'JSON.parse without error handling',
      severity: 'medium',
      errorType: 'ParseRisk',
      tags: ['javascript', 'json', 'error-handling'],
      confidence: 72,
      detect: ctx => /JSON\.parse\s*\(/.test(ctx.content) && !/\b(?:try|catch)\b/.test(ctx.content),
      fix: 'Catch SyntaxError from JSON.parse and reject or default invalid payloads safely.',
    },
    {
      id: 'dom-null-access',
      title: 'Possible DOM null dereference',
      severity: 'medium',
      errorType: 'NullReferenceRisk',
      tags: ['javascript', 'dom', 'null-check'],
      confidence: 68,
      detect: ctx => /getElementById|querySelector/.test(ctx.content) &&
        /\.(?:children|value|innerHTML|textContent|classList|addEventListener)\b/.test(ctx.content) &&
        !/\bif\s*\([^)]*!?\w+[^)]*\)|\?\./.test(ctx.content),
      fix: 'Guard the queried element before dereferencing it, or use optional chaining where a no-op is acceptable.',
    },
    {
      id: 'sql-string-concat',
      title: 'Possible SQL injection via string-built query',
      severity: 'critical',
      errorType: 'SQLInjectionRisk',
      tags: ['security', 'sql-injection', 'database'],
      confidence: 88,
      detect: ctx => /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(ctx.content) &&
        /(?:\+|\$\{|\%s|format\s*\(|f["'`])/.test(ctx.content) &&
        !/\b(?:prepare|bind_param|execute\(|parameterized|params)\b/i.test(ctx.content),
      fix: 'Use parameterized queries or prepared statements instead of interpolating user input.',
    },
    {
      id: 'ssl-verify-disabled',
      title: 'TLS certificate verification disabled',
      severity: 'critical',
      errorType: 'TLSVerificationRisk',
      tags: ['security', 'ssl', 'tls', 'mitm'],
      confidence: 95,
      detect: ctx => /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/i.test(ctx.content),
      fix: 'Keep certificate verification enabled and trust local or private certificates through the platform trust store.',
    },
    {
      id: 'eval-execution',
      title: 'Dynamic code execution from runtime data',
      severity: 'critical',
      errorType: 'CodeInjectionRisk',
      tags: ['security', 'code-injection'],
      confidence: 90,
      detect: ctx => /\b(?:eval|Function)\s*\(/.test(ctx.content),
      fix: 'Replace dynamic code execution with a parser, command map, or constrained expression evaluator.',
    },
    {
      id: 'hardcoded-secret',
      title: 'Possible hardcoded secret',
      severity: 'critical',
      errorType: 'SecretExposureRisk',
      tags: ['security', 'secret', 'credentials'],
      confidence: 82,
      detect: ctx => /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][^'"]{12,}['"]/i.test(ctx.content),
      fix: 'Move secrets to a secret manager or environment variable and rotate any exposed credential.',
    },
  ];

  function hash(text) {
    let h = 2166136261;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function normalizeSnippet(snippet) {
    return String(snippet || '').replace(/\s+/g, ' ').trim().substring(0, 500);
  }

  function firstRelevantSnippet(content, ruleId) {
    const lines = String(content || '').split('\n');
    const patterns = {
      'division-by-zero': /\//,
      'unsafe-index-access': /\[[^\]]+\]/,
      'unsafe-type-conversion': /\b(?:int|float|Number|parseInt|parseFloat)\s*\(/,
      'unhandled-fetch': /\bfetch\s*\(/,
      'json-parse-no-guard': /JSON\.parse\s*\(/,
      'dom-null-access': /getElementById|querySelector/,
      'sql-string-concat': /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i,
      'ssl-verify-disabled': /verify\s*=\s*False|rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED/i,
      'eval-execution': /\b(?:eval|Function)\s*\(/,
      'hardcoded-secret': /\b(?:api[_-]?key|secret|token|password)\b/i,
    };
    const re = patterns[ruleId];
    const idx = re ? lines.findIndex(line => re.test(line)) : -1;
    const start = Math.max(0, (idx < 0 ? 0 : idx) - 3);
    return lines.slice(start, start + 8).join('\n').trim() || String(content || '').substring(0, 1200);
  }

  function sourceKey(source) {
    if (source?.sourceKey) return source.sourceKey;
    if (source?.name) return `analysis:${source.name}`;
    return `analysis:${hash(source?.content || '')}`;
  }

  function buildFinding(rule, ctx, source, similar) {
    const snippet = firstRelevantSnippet(ctx.content, rule.id);
    const duplicate = similar[0]?.similarity >= DUPLICATE_THRESHOLD ? similar[0] : null;
    const keyMaterial = `${sourceKey(source)}:${rule.id}:${normalizeSnippet(snippet)}`;
    const findingFingerprint = hash(keyMaterial);

    return {
      title: `${rule.title}${source?.name ? ` in ${source.name}` : ''}`,
      description: `${rule.title}. ${rule.fix}`,
      status: duplicate ? 'duplicated' : 'open',
      priority: rule.severity,
      severity: rule.severity,
      confidence: rule.confidence,
      language: ctx.parsed.language,
      errorType: rule.errorType,
      tags: [...new Set(['detected', 'analysis', rule.id, ...rule.tags])],
      codeSnippetBefore: snippet,
      codeSnippetAfter: '',
      codeSnippetDiff: '',
      solution: rule.fix,
      suggestedFix: rule.fix,
      source: source?.type || 'analysis',
      sourceKey: `${sourceKey(source)}:finding:${findingFingerprint}`,
      sourceUrl: source?.url || null,
      duplicateOf: duplicate?.id || null,
      similarityLinks: similar.map(s => ({
        id: s.id,
        title: s.title,
        similarity: s.similarity,
        status: s.status,
        sourceUrl: s.sourceUrl || null,
      })),
      metadata: {
        ruleId: rule.id,
        sourceName: source?.name || '',
        sourceKey: sourceKey(source),
        analyzedAt: new Date().toISOString(),
        historicalMatches: similar.length,
      },
      findingFingerprint,
    };
  }

  function detect(content, options = {}) {
    const parsed = options.parsed || Parser.parse(content);
    const ctx = { content: String(content || ''), lower: String(content || '').toLowerCase(), parsed };
    const historicalTickets = options.tickets || DB.getAll();

    return RULES
      .filter(rule => rule.detect(ctx))
      .map(rule => {
        const snippet = firstRelevantSnippet(ctx.content, rule.id);
        const searchText = [
          rule.title,
          rule.errorType,
          rule.tags.join(' '),
          rule.fix,
          snippet,
        ].join('\n');
        const similar = SearchEngine.search(Parser.parse(searchText), historicalTickets, 5);
        return buildFinding(rule, ctx, { ...options.source, content }, similar);
      });
  }

  function saveFindings(findings) {
    const saved = findings.map(finding => DB.upsertDetectedIssue(finding));
    return {
      saved,
      created: saved.filter(s => s._lifecycle === 'created').length,
      updated: saved.filter(s => s._lifecycle === 'updated').length,
      confirmed: saved.filter(s => s._lifecycle === 'confirmed').length,
      duplicated: saved.filter(s => s.status === 'duplicated').length,
    };
  }

  function reconcileResolved(source, activeFindings) {
    const key = sourceKey(source);
    const active = new Set(activeFindings.map(f => f.findingFingerprint));
    return DB.markResolvedMissingFindings(key, active);
  }

  function analyzeAndPersist(content, options = {}) {
    const parsed = options.parsed || Parser.parse(content);
    const findings = detect(content, { ...options, parsed });
    const saved = saveFindings(findings);
    const resolved = options.reconcile === false
      ? []
      : reconcileResolved({ ...options.source, content }, findings);
    return { parsed, findings, ...saved, resolved };
  }

  return { detect, saveFindings, reconcileResolved, analyzeAndPersist, hash };
})();
