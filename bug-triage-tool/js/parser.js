'use strict';

/**
 * Parser — extracts searchable tokens from uploaded code or error logs
 */
const Parser = (() => {

  /* ── stop words ───────────────────────────────────────────────── */
  const STOP = new Set([
    'the','a','an','is','it','in','on','at','to','for','of','and','or',
    'but','not','with','this','that','are','was','be','have','had','has',
    'do','did','will','would','could','should','may','might','can','from',
    'by','as','if','then','else','return','var','let','const','function',
    'class','new','import','export','default','public','private','static',
    'void','int','str','bool','boolean','null','undefined','true','false',
    'self','def','pass','print','throw','try','catch','finally','while',
    'for','switch','case','break','continue','super','this','extends',
    'implements','interface','abstract','final','override','get','set',
    'type','enum','struct','namespace','using','include','define','end',
    'begin','then','when','unless','until','next','each','map','filter',
    'reduce','length','size','count','index','value','key','name','data',
  ]);

  /* ── tokenize raw text ─────────────────────────────────────────── */
  function tokenize(text) {
    if (!text || typeof text !== 'string') return [];

    // split camelCase → individual words
    const withSpaces = text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

    return withSpaces
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t));
  }

  /* -- language-neutral bug signatures ---------------------------------- */
  function extractBugSignatures(content) {
    if (!content || typeof content !== 'string') return [];

    const signatures = new Set();
    const hasSubscriptAccess = /\w+\s*\[[^\]]+\]/.test(content);
    const hasIndexedSequenceAccess = /\b\w+\s*\[\s*(?:\d+|[a-zA-Z_]\w*(?:\s*[+-]\s*\d+)?)\s*\]/.test(content);
    const hasSequenceContainer = /\b(?:array|vector|list|row|rows|items|scores|buffer|buf|arr|columns?|elements?)\b|std::vector/i.test(content);
    const hasBoundsGuard = /\b(?:if|while)\s*\([^)]*(?:<|>|<=|>=)[^)]*(?:length|size|count|len|\.size\s*\(\))[^)]*\)/i.test(content);
    const rules = [
      {
        name: 'index_bounds_access',
        tests: [
          /index(?:ed)?\s+(?:out\s+of\s+)?bounds?/i,
          /out[-\s]?of[-\s]?bounds?/i,
          /list index out of range/i,
          /arrayindexoutofboundsexception/i,
          /indexerror/i,
          /rangeerror/i,
        ],
      },
      {
        name: 'off_by_one_loop',
        tests: [
          /off[-\s]?by[-\s]?one/i,
          /for\s*\([^;]+;[^;]*(?:<=|>=)[^;]*(?:length|size|count|len)\b/i,
          /for\s+\w+\s+in\s+range\s*\([^)]*(?:len|length|size|count)[^)]*\)/i,
        ],
      },
      {
        name: 'missing_bounds_check',
        tests: [
          /bounds?[-\s]?check/i,
          /without\s+(?:validating|checking).*(?:index|length|size|range|bounds?)/i,
          /assumes?.*(?:columns?|items?|elements?|entries?).*(?:at least|minimum|\d+)/i,
          /\bif\s*\([^)]*(?:<|>|<=|>=)[^)]*(?:length|size|count|len)[^)]*\)/i,
        ],
      },
      {
        name: 'null_reference',
        tests: [
          /nullpointerexception/i,
          /nonetype object has no attribute/i,
          /cannot read propert(?:y|ies).*null/i,
          /undefined is not an object/i,
          /null\s+(?:reference|pointer|check|guard)/i,
        ],
      },
      {
        name: 'division_by_zero',
        tests: [
          /zerodivisionerror/i,
          /division by zero/i,
          /divide by zero/i,
          /\/\s*(?:0|count|quantity|total|len|length|size)\b/i,
        ],
      },
      {
        name: 'type_conversion',
        tests: [
          /invalid literal/i,
          /typeerror/i,
          /classcastexception/i,
          /parse(?:int|float|double)?/i,
          /(?:int|float|double|string)\s*\([^)]*\)/i,
        ],
      },
      {
        name: 'resource_leak',
        tests: [
          /memory leak/i,
          /resource leak/i,
          /not returned|never returned|never released|not closed/i,
          /finally|defer|try-with-resources|raii/i,
        ],
      },
      {
        name: 'unhandled_async_error',
        tests: [
          /unhandled(?:promise)?rejection/i,
          /uncaught exception/i,
          /no catch handler/i,
          /\bawait\b[\s\S]{0,120}(?:fetch|pipeline|promise)/i,
        ],
      },
    ];

    rules.forEach(rule => {
      if (rule.tests.some(re => re.test(content))) signatures.add(rule.name);
    });

    if (hasIndexedSequenceAccess) {
      signatures.add('indexed_sequence_access');
    }

    if (hasSubscriptAccess && signatures.has('off_by_one_loop')) {
      signatures.add('index_bounds_access');
      signatures.add('missing_bounds_check');
    }

    if (hasIndexedSequenceAccess && hasSequenceContainer && !hasBoundsGuard) {
      signatures.add('index_bounds_access');
      signatures.add('missing_bounds_check');
    }

    if (signatures.has('index_bounds_access')) {
      signatures.add('data_structure_bounds');
      signatures.add('invalid_index_access');
    }
    if (signatures.has('off_by_one_loop')) {
      signatures.add('loop_boundary_logic');
      signatures.add('invalid_index_access');
    }
    if (signatures.has('missing_bounds_check')) {
      signatures.add('input_shape_validation');
      signatures.add('invalid_index_access');
    }

    return [...signatures];
  }

  /* ── detect input type (log vs. source code) ───────────────────── */
  function detectType(content) {
    const LOG_SIGNALS = [
      /traceback \(most recent call last\)/i,
      /exception in thread/i,
      /at\s+[\w.]+\([^)]*\.(?:java|kt|scala):\d+\)/,
      /^\s+at\s+/m,
      /stack trace:/i,
      /\[(?:error|fatal|critical|warn)\]/i,
      /unhandled exception/i,
      /caused by:/i,
      /error:\s/i,
      /^\d{4}-\d{2}-\d{2}.*(?:ERROR|FATAL|WARN)/m,
    ];
    const CODE_SIGNALS = [
      /def\s+\w+\s*\(/,
      /function\s+\w+\s*\(/,
      /class\s+\w+[\s:{]/,
      /^\s*import\s+\w+/m,
      /#include\s*</,
      /public\s+static\s+void\s+main/,
      /int\s+main\s*\(/,
      /\bexport\s+default\b/,
      /\bconst\s+\w+\s*=/,
      /\blet\s+\w+\s*=/,
      /\bvar\s+\w+\s*=/,
    ];
    const logScore  = LOG_SIGNALS.filter(p => p.test(content)).length;
    const codeScore = CODE_SIGNALS.filter(p => p.test(content)).length;
    return logScore >= codeScore ? 'log' : 'code';
  }

  /* ── detect programming language ───────────────────────────────── */
  function detectLanguage(content) {
    const checks = [
      { lang: 'python',     re: /\bdef\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import/ },
      { lang: 'javascript', re: /\bconst\s+|let\s+|var\s+|=>\s*{|require\s*\(|module\.exports/ },
      { lang: 'java',       re: /public\s+(?:static\s+)?(?:void|class|interface)|System\.out\.print/ },
      { lang: 'cpp',        re: /#include\s*<|std::|cout\s*<<|int\s+main\s*\(/ },
      { lang: 'csharp',     re: /using\s+System|namespace\s+\w+|Console\.Write/ },
      { lang: 'php',        re: /<\?php|\$\w+\s*=|echo\s+/ },
      { lang: 'ruby',       re: /def\s+\w+\s*$|\bputs\b|require_relative/ },
      { lang: 'go',         re: /func\s+\w+|package\s+main|fmt\.Print/ },
      { lang: 'rust',       re: /fn\s+main\s*\(\)|let\s+mut\s+\w+|println!/ },
    ];
    for (const { lang, re } of checks) {
      if (re.test(content)) return lang;
    }
    return 'unknown';
  }

  /* ── extract named error types ─────────────────────────────────── */
  function extractErrors(content) {
    const results = [];
    const patterns = [
      // Python-style: FooError: message
      /\b(\w+(?:Error|Exception|Warning|Fault))\s*:\s*([^\n]{0,120})/g,
      // Java fully-qualified: java.lang.NullPointerException
      /(?:java\.[\w.]+\.)(\w+Exception|\w+Error)(?::\s*([^\n]{0,120}))?/g,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(content)) !== null) {
        results.push({ type: m[1], message: (m[2] || '').trim() });
      }
    }
    return results;
  }

  /* ── extract file & function names mentioned ───────────────────── */
  function extractIdentifiers(content) {
    const ids = [];
    // file paths
    (content.match(/[\w/\\-]+\.(?:py|js|ts|java|cpp|cs|php|rb|go|rs)\b/g) || [])
      .forEach(f => ids.push(f.replace(/\.\w+$/, '').split(/[/\\]/).pop()));
    // function/method names
    (content.match(/(?:def|function|void|int|string|public)\s+(\w+)\s*\(/g) || [])
      .forEach(m => { const n = m.match(/\s+(\w+)\s*\(/); if (n) ids.push(n[1]); });
    return ids.filter(id => id && id.length > 2 && !STOP.has(id.toLowerCase()));
  }

  /* ── main parse function ────────────────────────────────────────── */
  function parse(content) {
    const type     = detectType(content);
    const language = detectLanguage(content);
    const errors   = extractErrors(content);
    const ids      = extractIdentifiers(content);
    const tokens   = tokenize(content);
    const bugSignatures = extractBugSignatures(content);

    // Boost error type terms
    const errorTerms = errors.flatMap(e => [
      ...tokenize(e.type),
      ...tokenize(e.message),
    ]);

    const queryTokens = [
      ...new Set([
        ...errorTerms,
        ...bugSignatures,
        ...ids.map(s => s.toLowerCase()),
        ...tokens,
      ]),
    ].filter(Boolean);

    return { type, language, errors, identifiers: ids, tokens, bugSignatures, queryTokens, raw: content };
  }

  return { parse, tokenize, detectType, detectLanguage, extractErrors, extractBugSignatures };
})();
