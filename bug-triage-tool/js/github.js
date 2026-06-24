'use strict';

/**
 * GitHub - fetch issues/PRs and convert to bug tickets.
 */
const GitHub = (() => {

  const BASE = 'https://api.github.com';
  const PER_PAGE = 100;
  const MAX_IMPORT_ISSUES = 200;
  const MAX_SAFE_RATE_LIMIT_WAIT_MS = 30_000;
  const MAX_RETRIES = 2;
  let _token = null;

  function setToken(tok) { _token = tok ? tok.trim() : null; }

  function _headers() {
    const h = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (_token) h['Authorization'] = `Bearer ${_token}`;
    return h;
  }

  class GitHubRateLimitError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'GitHubRateLimitError';
      this.retryAt = details.retryAt || null;
      this.status = details.status || 403;
    }
  }

  /* -- map a GitHub issue to a ticket ---------------------------------- */
  function issueToTicket(issue, repo) {
    const body = issue.body || '';
    const sourceKey = `github:${repo}:issue:${issue.id}`;

    // Heuristic: look for code blocks in the body.
    // Only treat a block as source code if it actually looks like code, not a log.
    const codeBlocks = [...body.matchAll(/```(\w*)\n([\s\S]*?)```/g)];
    const _sourceCodeBlock = (raw) => {
      if (!raw) return '';
      const trimmed = raw.trim();
      return Parser.detectType(trimmed) === 'code' ? trimmed : '';
    };
    const firstCode = _sourceCodeBlock(codeBlocks[0]?.[2]);
    const lastCode  = codeBlocks.length > 1
      ? _sourceCodeBlock(codeBlocks[codeBlocks.length - 1][2])
      : '';

    // Extract error type from title / body.
    const errMatch = (issue.title + ' ' + body).match(
      /\b(\w+(?:Error|Exception|Fault|Warning|Panic))\b/
    );
    const errorType = errMatch ? errMatch[1] : '';

    // Priority heuristic from labels.
    const labelNames = (issue.labels || []).map(l => l.name.toLowerCase());
    let priority = 'medium';
    if (labelNames.some(l => ['critical','blocker','severity: critical'].includes(l))) priority = 'critical';
    else if (labelNames.some(l => ['high','severity: high','p0','p1'].includes(l))) priority = 'high';
    else if (labelNames.some(l => ['low','trivial','severity: low'].includes(l))) priority = 'low';

    const status = issue.state === 'closed' ? 'resolved' : 'open';

    const tags = [
      ...(issue.labels || []).map(l => l.name.toLowerCase().replace(/\s+/g, '-')),
      repo.split('/')[1],
      errorType ? errorType.toLowerCase() : null,
    ].filter(Boolean);

    return {
      title:             `[${repo}] ${issue.title}`.substring(0, 120),
      description:       body.substring(0, 1500) || `GitHub issue #${issue.number} from ${repo}`,
      status,
      priority,
      language:          Parser.detectLanguage(body + firstCode),
      errorType,
      tags:              [...new Set(tags)],
      codeSnippetBefore: firstCode,
      codeSnippetAfter:  lastCode !== firstCode ? lastCode : '',
      codeSnippetDiff:   '',
      solution:          status === 'resolved' ? 'See linked PR / commit for fix.' : '',
      source:            'github',
      sourceUrl:         issue.html_url,
      sourceKey,
      githubIssueId:     issue.id,
      createdAt:         issue.created_at,
      resolvedAt:        issue.closed_at || null,
      metadata: {
        sourceKey,
        githubIssueId: issue.id,
        githubIssueNumber: issue.number,
        githubNodeId: issue.node_id,
        githubRepo: repo,
        importedFrom: 'github',
      },
    };
  }

  /* -- GitHub request helpers ------------------------------------------ */
  function _nextPageUrl(res) {
    const link = res.headers.get('Link') || '';
    const next = link.split(',').find(part => part.includes('rel="next"'));
    const match = next?.match(/<([^>]+)>/);
    return match ? match[1] : null;
  }

  function _checkpointKey(owner, repo) {
    return `github:${owner}/${repo}:issues`;
  }

  function _pageUrl(owner, repo, page) {
    const url = new URL(`${BASE}/repos/${owner}/${repo}/issues`);
    url.searchParams.set('state', 'all');
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('page', String(page));
    return url.toString();
  }

  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function _retryAtFromHeaders(res) {
    const retryAfter = Number(res.headers.get('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return new Date(Date.now() + retryAfter * 1000);
    }

    const resetSeconds = Number(res.headers.get('X-RateLimit-Reset'));
    if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
      return new Date(resetSeconds * 1000);
    }

    return null;
  }

  function _isRateLimitResponse(res, payload) {
    if (res.status === 429) return true;
    if (res.status !== 403) return false;
    const remaining = res.headers.get('X-RateLimit-Remaining');
    const message = String(payload?.message || '').toLowerCase();
    return remaining === '0' ||
      message.includes('rate limit') ||
      message.includes('secondary rate limit') ||
      message.includes('abuse detection');
  }

  async function _readPayload(res) {
    try { return await res.json(); }
    catch { return null; }
  }

  async function _fetchIssuePage(url, attempt = 0) {
    const res = await fetch(url, { headers: _headers() });
    const payload = await _readPayload(res);

    if (res.ok) {
      return {
        issues: Array.isArray(payload) ? payload : [],
        nextUrl: _nextPageUrl(res),
      };
    }

    if (_isRateLimitResponse(res, payload)) {
      const retryAt = _retryAtFromHeaders(res);
      const waitMs = retryAt ? retryAt.getTime() - Date.now() : Infinity;

      if (attempt < MAX_RETRIES && waitMs >= 0 && waitMs <= MAX_SAFE_RATE_LIMIT_WAIT_MS) {
        await _sleep(waitMs + 1000);
        return _fetchIssuePage(url, attempt + 1);
      }

      const retryText = retryAt ? ` Retry after ${retryAt.toLocaleString()}.` : '';
      throw new GitHubRateLimitError(
        `GitHub API rate limit reached.${retryText} Saved issues have been kept; rerun the import later to resume.`,
        { retryAt, status: res.status }
      );
    }

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await _sleep((attempt + 1) * 1000);
      return _fetchIssuePage(url, attempt + 1);
    }

    if (res.status === 404) throw new Error('Repository not found or not accessible.');
    const message = payload?.message ? `: ${payload.message}` : '';
    throw new Error(`GitHub API error ${res.status}${message}`);
  }

  async function fetchIssues(owner, repo, onProgress, maxPages = Math.ceil(MAX_IMPORT_ISSUES / PER_PAGE)) {
    const allIssues = [];
    let page = 1;
    let url = _pageUrl(owner, repo, page);

    while (url && page <= maxPages && allIssues.length < MAX_IMPORT_ISSUES) {
      const { issues, nextUrl } = await _fetchIssuePage(url);
      allIssues.push(...issues.slice(0, MAX_IMPORT_ISSUES - allIssues.length));
      onProgress?.(`Fetched page ${page}: ${issues.length} open/closed issues (${allIssues.length} total).`);
      url = nextUrl;
      page++;
    }
    return allIssues;
  }

  function _upsertIssue(issue, owner, repo) {
    const repoFullName = `${owner}/${repo}`;
    const ticketData = issueToTicket(issue, repoFullName);
    const uniqueKey = `github:${repoFullName}:issue:${issue.id}`;
    return DB.upsertImportedTicket(ticketData, uniqueKey);
  }

  /* -- ingest issues from a repo into the DB ---------------------------- */
  async function ingestRepo(repoFullName, onProgress) {
    const [owner, repo] = repoFullName.trim().split('/');
    if (!owner || !repo) throw new Error('Invalid repo format. Use owner/repo');

    const checkpointKey = _checkpointKey(owner, repo);
    const checkpoint = DB.getIngestionCheckpoint(checkpointKey);
    let added = checkpoint?.added || 0;
    let updated = checkpoint?.updated || 0;
    let fetched = checkpoint?.fetched || 0;
    let page = checkpoint?.nextPage || 1;
    let url = checkpoint?.nextUrl || _pageUrl(owner, repo, page);
    let status = 'success';
    let retryAt = null;

    if (checkpoint?.status === 'in_progress' || checkpoint?.status === 'rate_limited' || checkpoint?.status === 'interrupted') {
      onProgress?.(`Resuming ${repoFullName} from page ${page} (${fetched}/${MAX_IMPORT_ISSUES} issues processed)...`);
    } else {
      onProgress?.(`Fetching up to ${MAX_IMPORT_ISSUES} open and closed issues from ${repoFullName}...`);
    }

    DB.saveIngestionCheckpoint(checkpointKey, {
      type: 'github',
      source: repoFullName,
      status: 'in_progress',
      nextPage: page,
      nextUrl: url,
      added,
      updated,
      fetched,
    });

    try {
      while (url && fetched < MAX_IMPORT_ISSUES) {
        const currentPage = page;
        const { issues, nextUrl } = await _fetchIssuePage(url);
        const remaining = MAX_IMPORT_ISSUES - fetched;
        const issuesToPersist = issues.slice(0, remaining);
        onProgress?.(`Fetched page ${currentPage}: saving ${issuesToPersist.length} issues in one batch.`);

        const payload = DB.bulkUpsert(issuesToPersist.map(issue => issueToTicket(issue, repoFullName)));
        fetched += issuesToPersist.length;
        added += Number(payload.added || 0);
        updated += Number(payload.updated || 0);

        const first = payload.tickets?.[0];
        const last = payload.tickets?.[payload.tickets.length - 1];
        if (payload.tickets?.length) {
          onProgress?.(`Saved batch: ${payload.added || 0} new, ${payload.updated || 0} updated (${first.id} to ${last.id}).`);
        }

        DB.saveIngestionCheckpoint(checkpointKey, {
          type: 'github',
          source: repoFullName,
          status: 'in_progress',
          nextPage: currentPage,
          nextUrl: url,
          lastIssueId: issuesToPersist[issuesToPersist.length - 1]?.id || null,
          lastIssueNumber: issuesToPersist[issuesToPersist.length - 1]?.number || null,
          added,
          updated,
          fetched,
        });

        if (fetched >= MAX_IMPORT_ISSUES) {
          onProgress?.(`Reached the ${MAX_IMPORT_ISSUES}-issue import limit for this repo.`);
          break;
        }

        page = currentPage + 1;
        url = nextUrl;
        if (url) {
          DB.saveIngestionCheckpoint(checkpointKey, {
            type: 'github',
            source: repoFullName,
            status: 'in_progress',
            nextPage: page,
            nextUrl: url,
            added,
            updated,
            fetched,
          });
        }
      }
    } catch (err) {
      if (!(err instanceof GitHubRateLimitError)) {
        DB.saveIngestionCheckpoint(checkpointKey, {
          type: 'github',
          source: repoFullName,
          status: 'interrupted',
          nextPage: page,
          nextUrl: url,
          added,
          updated,
          fetched,
          error: err.message,
        });
        DB.logIngestion({
          type: 'github',
          source: repoFullName,
          count: added,
          updated,
          fetched,
          status: 'interrupted',
          error: err.message,
        });
        throw err;
      }

      status = 'rate_limited';
      retryAt = err.retryAt;
      DB.saveIngestionCheckpoint(checkpointKey, {
        type: 'github',
        source: repoFullName,
        status,
        nextPage: page,
        nextUrl: url,
        added,
        updated,
        fetched,
        retryAt: retryAt?.toISOString() || null,
      });
      onProgress?.(err.message);
    }

    if (status === 'success') {
      DB.clearIngestionCheckpoint(checkpointKey);
      if (fetched === 0) onProgress?.('No issues found.');
    }

    const summary = {
      type: 'github',
      source: repoFullName,
      count: added,
      updated,
      fetched,
      status,
      retryAt: retryAt?.toISOString() || null,
    };
    DB.logIngestion(summary);

    return summary;
  }

  /* -- parse a commit message / diff into a ticket ---------------------- */
  function parseCommit(commitText) {
    const lines = commitText.trim().split('\n');
    const subject = lines[0] || 'Commit-based fix';
    const body    = lines.slice(1).join('\n').trim();

    const errMatch = commitText.match(/\b(\w+(?:Error|Exception|Bug|Fix|Issue))\b/i);
    const errorType = errMatch ? errMatch[1] : '';

    const diffLines = lines.filter(l => l.startsWith('+') || l.startsWith('-'));
    const diff = diffLines.join('\n');

    return {
      title:             subject.substring(0, 120),
      description:       body || subject,
      status:            'resolved',
      priority:          'medium',
      language:          Parser.detectLanguage(commitText),
      errorType,
      tags:              ['commit', errorType.toLowerCase()].filter(Boolean),
      codeSnippetBefore: '',
      codeSnippetAfter:  '',
      codeSnippetDiff:   diff.substring(0, 2000),
      solution:          body || 'See commit diff.',
      source:            'commit',
      sourceUrl:         null,
      createdAt:         new Date().toISOString(),
      resolvedAt:        new Date().toISOString(),
    };
  }

  /* ── log heuristics ─────────────────────────────────────────────── */
  const LOG_CATEGORIES = [
    { name: 'Payment',       re: /payment|transaction|billing|invoice|checkout|stripe|paypal|refund|charge/i },
    { name: 'Authentication',re: /auth|login|logout|token|jwt|session|oauth|sso|password|credential/i },
    { name: 'Database',      re: /database|db|sql|postgres|mysql|mongo|redis|query|connection pool/i },
    { name: 'Network',       re: /network|http|https|request|response|cors|dns|ssl|tls|socket/i },
    { name: 'API',           re: /api|endpoint|route|graphql|rest|webhook|grpc/i },
    { name: 'Performance',   re: /timeout|latency|slow|memory|cpu|throughput|rate.?limit|queue/i },
    { name: 'Storage',       re: /storage|s3|disk|file|upload|download|bucket/i },
    { name: 'Security',      re: /security|injection|xss|csrf|unauthorized|forbidden|privilege/i },
  ];

  const LOG_FIXES = [
    { re: /timeout/i,            fixes: ['Implement retry mechanism with exponential backoff', 'Add circuit breaker pattern', 'Increase timeout threshold for critical paths'] },
    { re: /connection.*pool|pool.*exhaust/i, fixes: ['Increase connection pool size', 'Audit long-running queries', 'Enable connection pooling idle timeout'] },
    { re: /out.?of.?memory|OOM/i,fixes: ['Profile and reduce memory allocations', 'Add heap size limits', 'Implement pagination for large data sets'] },
    { re: /rate.?limit/i,        fixes: ['Implement request throttling', 'Add retry-after backoff', 'Cache frequently-used responses'] },
    { re: /NullPointer|null.*dereference|undefined/i, fixes: ['Add null/undefined guard checks', 'Validate API response shapes before use'] },
    { re: /auth|unauthorized|403/i, fixes: ['Verify token expiry handling', 'Audit role/permission configuration', 'Add token refresh logic'] },
    { re: /500|Internal Server Error/i, fixes: ['Add structured error handling and logging', 'Review recent deployments for regressions', 'Enable detailed server-side error tracing'] },
    { re: /disk|storage|ENOSPC/i,fixes: ['Expand storage capacity', 'Add disk-usage alerting', 'Purge old logs/artifacts'] },
    { re: /sql|query|database/i, fixes: ['Review slow query log', 'Add appropriate indexes', 'Use parameterized queries to avoid injection'] },
  ];

  function _detectCategory(text) {
    for (const { name, re } of LOG_CATEGORIES) {
      if (re.test(text)) return name;
    }
    return 'General';
  }

  function _suggestFixes(text) {
    for (const { re, fixes } of LOG_FIXES) {
      if (re.test(text)) return fixes;
    }
    return ['Review server logs for root cause', 'Add monitoring and alerting for this error type'];
  }

  function _buildLogSolution(primaryError, category, suggestedFixes) {
    const issue = primaryError
      ? `${primaryError.type}${primaryError.message ? `: ${primaryError.message}` : ''}`
      : `${category} production log issue`;
    return [
      `Investigate the ${category.toLowerCase()} failure reported by the production log: ${issue}.`,
      `Recommended fix: ${suggestedFixes.join('; ')}.`,
      'After applying the fix, redeploy and verify that this error no longer appears in production logs.',
    ].join(' ');
  }

  /* -- parse a production log dump into a ticket ------------------------ */
  function parseProductionLog(logText, title) {
    const parsed = Parser.parse(logText);
    const errors = parsed.errors;
    const primaryError = errors[0];

    const category     = _detectCategory(logText);
    const suggestedFixes = _suggestFixes(logText);
    const solution = _buildLogSolution(primaryError, category, suggestedFixes);

    return {
      title:             title || (primaryError
        ? `${primaryError.type}: ${primaryError.message.substring(0, 80)}`
        : 'Production log error'),
      // Raw log stored in description and logContent — never in code sections.
      description:       logText.substring(0, 2000),
      logContent:        logText,
      category,
      suggestedFixes,
      status:            'open',
      priority:          'high',
      language:          parsed.language,
      errorType:         primaryError?.type || '',
      tags:              ['production', 'log', ...(primaryError ? [primaryError.type.toLowerCase()] : [])],
      codeSnippetBefore: '',
      codeSnippetAfter:  '',
      codeSnippetDiff:   '',
      solution,
      source:            'log',
      sourceUrl:         null,
      createdAt:         new Date().toISOString(),
      resolvedAt:        null,
    };
  }

  return { setToken, ingestRepo, parseCommit, parseProductionLog, issueToTicket };
})();
