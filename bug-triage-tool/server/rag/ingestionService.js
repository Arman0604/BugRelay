'use strict';

const { buildChunks, cleanText, documentText, extractFileNames, isFixRelated, stableHash, unique } = require('./text');

const DEFAULT_MAX_ITEMS = 25;

class RagIngestionService {
  constructor(store, options = {}) {
    this.store = store;
    this.logger = options.logger || console;
  }

  async ingestGitHubRepo({ repo, token = '', maxItems = DEFAULT_MAX_ITEMS, includeComments = false, includeCommitDetails = false }) {
    const repoFullName = normalizeRepo(repo);
    const limit = Math.max(1, Math.min(Number(maxItems || DEFAULT_MAX_ITEMS), 100));
    const client = new GitHubClient(token);
    const chunks = [];

    this.logger.info?.(`[rag] ingesting GitHub repo ${repoFullName}`);
    const [issues, pulls, commits] = await Promise.all([
      client.list(`${repoFullName}/issues`, { state: 'all', per_page: limit }),
      client.list(`${repoFullName}/pulls`, { state: 'all', per_page: limit }),
      client.list(`${repoFullName}/commits`, { per_page: limit }),
    ]);

    for (const issue of issues.filter(item => !item.pull_request).slice(0, limit)) {
      let comments = [];
      if (includeComments) {
        try {
          comments = await client.list(`${repoFullName}/issues/${issue.number}/comments`, { per_page: 30 });
        } catch (err) {
          this.logger.warn?.(`[rag] comments skipped for ${repoFullName}#${issue.number}: ${err.message}`);
        }
      }
      chunks.push(...buildIssueChunks(issue, repoFullName, comments));
    }

    for (const pr of pulls.slice(0, limit)) {
      chunks.push(...buildPullRequestChunks(pr, repoFullName));
    }

    for (const commitSummary of commits.slice(0, limit)) {
      let commit = commitSummary;
      if (includeCommitDetails) {
        try {
          commit = await client.get(`${repoFullName}/commits/${commitSummary.sha}`);
        } catch (err) {
          this.logger.warn?.(`[rag] commit detail skipped for ${commitSummary.sha}: ${err.message}`);
        }
      }
      chunks.push(...buildCommitChunks(commit, repoFullName));
    }

    const result = await this.store.upsertChunks(chunks);
    return {
      type: 'github-rag',
      source: repoFullName,
      issues: issues.filter(item => !item.pull_request).length,
      pullRequests: pulls.length,
      commits: commits.length,
      chunks: result.chunks,
      embeddingProvider: result.provider,
      embeddingModel: result.model,
      fallback: result.fallback,
    };
  }

  async ingestCommitText(commitText, metadata = {}) {
    const chunks = buildCommitTextChunks(commitText, metadata);
    const result = await this.store.upsertChunks(chunks);
    return { type: 'commit-rag', source: metadata.repo || 'manual-commit', chunks: result.chunks, ...result };
  }

  async ingestTicket(ticket) {
    const chunks = buildTicketChunks(ticket);
    const result = await this.store.upsertChunks(chunks);
    return { type: 'ticket-rag', source: ticket.sourceKey || ticket.id, chunks: result.chunks, ...result };
  }

  async ingestDocuments(documents = []) {
    const chunks = documents.flatMap(document => buildGenericDocumentChunks(document));
    const result = await this.store.upsertChunks(chunks);
    return { type: 'documents-rag', source: 'manual-documents', chunks: result.chunks, ...result };
  }
}

class GitHubClient {
  constructor(token = '') {
    this.token = token;
  }

  headers() {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'BugRelayAI-RAG',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  async list(pathname, params = {}) {
    const url = new URL(`https://api.github.com/repos/${pathname}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return this.request(url.toString());
  }

  async get(pathname) {
    return this.request(`https://api.github.com/repos/${pathname}`);
  }

  async request(url) {
    const response = await fetch(url, { headers: this.headers() });
    let payload = null;
    try { payload = await response.json(); }
    catch { payload = null; }
    if (!response.ok) {
      throw new Error(payload?.message || `GitHub API returned ${response.status}`);
    }
    return payload;
  }
}

function normalizeRepo(repo) {
  const value = String(repo || '').trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(value)) throw new Error('Repository must use owner/repo format');
  return value;
}

function labelsOf(item) {
  return (item.labels || []).map(label => typeof label === 'string' ? label : label.name).filter(Boolean);
}

function baseMetadata(type, repo, extra = {}) {
  return {
    importedFrom: 'github-rag',
    documentType: type,
    repo,
    ...extra,
  };
}

function buildIssueChunks(issue, repo, comments = []) {
  const labels = labelsOf(issue);
  const fixComments = comments.filter(comment => isFixRelated(comment.body, labels));
  const content = documentText([
    `GitHub issue #${issue.number}: ${issue.title}`,
    issue.body || '',
    fixComments.map(comment => `Fix-related comment by ${comment.user?.login || 'unknown'}:\n${comment.body}`).join('\n\n'),
  ]);
  const metadata = baseMetadata('issue', repo, {
    repo,
    issueId: issue.id,
    issueNumber: issue.number,
    author: issue.user?.login || '',
    timestamp: issue.created_at,
    closedAt: issue.closed_at || null,
    labels,
    fileNames: extractFileNames(content),
    fixStatus: issue.state === 'closed' ? 'fixed' : 'open',
    fixRelated: issue.state === 'closed' || fixComments.length > 0,
  });
  return buildChunks({
    sourceKey: `github:${repo}:issue:${issue.id}`,
    documentType: 'issue',
    repo,
    title: `[${repo}] issue #${issue.number}: ${issue.title}`,
    content,
    sourceUrl: issue.html_url,
    metadata,
  });
}

function buildPullRequestChunks(pr, repo) {
  const labels = labelsOf(pr);
  const content = documentText([
    `GitHub pull request #${pr.number}: ${pr.title}`,
    pr.body || '',
    pr.merged_at ? `Merged at ${pr.merged_at}.` : '',
  ]);
  const metadata = baseMetadata('pull_request', repo, {
    repo,
    prId: pr.id,
    prNumber: pr.number,
    author: pr.user?.login || '',
    timestamp: pr.created_at,
    mergedAt: pr.merged_at || null,
    labels,
    fileNames: extractFileNames(content),
    fixStatus: pr.merged_at || pr.state === 'closed' ? 'fixed' : 'open',
    fixRelated: isFixRelated(content, labels),
  });
  return buildChunks({
    sourceKey: `github:${repo}:pull:${pr.id}`,
    documentType: 'pull_request',
    repo,
    title: `[${repo}] PR #${pr.number}: ${pr.title}`,
    content,
    sourceUrl: pr.html_url,
    metadata,
  });
}

function buildCommitChunks(commit, repo) {
  const sha = commit.sha || stableHash(JSON.stringify(commit)).slice(0, 12);
  const message = commit.commit?.message || commit.message || '';
  const files = (commit.files || []).map(file => file.filename).filter(Boolean);
  const patches = (commit.files || [])
    .map(file => [file.filename, file.patch].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n');
  const content = documentText([
    `Git commit ${sha}`,
    message,
    files.length ? `Files changed: ${files.join(', ')}` : '',
    patches,
  ]);
  const metadata = baseMetadata('commit', repo, {
    repo,
    commitHash: sha,
    author: commit.commit?.author?.name || commit.author?.login || '',
    timestamp: commit.commit?.author?.date || commit.created_at || null,
    fileNames: unique([...files, ...extractFileNames(content)]),
    fixStatus: isFixRelated(message) ? 'fixed' : 'unknown',
    fixRelated: isFixRelated(content),
  });
  return buildChunks({
    sourceKey: `github:${repo}:commit:${sha}`,
    documentType: 'commit',
    repo,
    title: `[${repo}] commit ${sha.slice(0, 7)}: ${message.split('\n')[0] || 'Commit'}`,
    content,
    sourceUrl: commit.html_url,
    metadata,
  });
}

function buildCommitTextChunks(commitText, metadata = {}) {
  const text = cleanText(commitText);
  const hash = metadata.commitHash || stableHash(text).slice(0, 16);
  const repo = metadata.repo || '';
  return buildChunks({
    sourceKey: metadata.sourceKey || `manual:commit:${hash}`,
    documentType: 'commit',
    repo,
    title: metadata.title || text.split('\n')[0] || 'Manual commit',
    content: text,
    sourceUrl: metadata.sourceUrl || null,
    metadata: {
      ...metadata,
      documentType: 'commit',
      commitHash: hash,
      fileNames: unique([...(metadata.fileNames || []), ...extractFileNames(text)]),
      fixStatus: 'fixed',
      fixRelated: true,
    },
  });
}

function buildTicketChunks(ticket) {
  const metadata = ticket.metadata || {};
  const repo = metadata.githubRepo || metadata.repo || '';
  const content = documentText([
    ticket.title,
    ticket.description,
    ticket.errorType,
    (ticket.tags || []).join(' '),
    ticket.codeSnippetBefore,
    ticket.codeSnippetAfter,
    ticket.codeSnippetDiff,
    ticket.solution || ticket.suggestedFix,
  ]);
  return buildChunks({
    sourceKey: ticket.sourceKey || `ticket:${ticket.id}`,
    documentType: ticket.source || 'ticket',
    repo,
    title: ticket.title,
    content,
    sourceUrl: ticket.sourceUrl,
    metadata: {
      ...metadata,
      documentType: ticket.source || 'ticket',
      ticketId: ticket.id,
      repo,
      labels: ticket.tags || [],
      language: ticket.language,
      errorType: ticket.errorType,
      author: ticket.createdBy || '',
      timestamp: ticket.createdAt,
      fileNames: unique([...(metadata.fileNames || []), ...extractFileNames(content)]),
      fixStatus: ticket.status === 'resolved' ? 'fixed' : ticket.status,
      fixRelated: ticket.status === 'resolved' || Boolean(ticket.solution || ticket.suggestedFix),
    },
  });
}

function buildGenericDocumentChunks(document) {
  const content = documentText([document.title, document.content || document.text, document.solution]);
  const sourceKey = document.sourceKey || `document:${stableHash(content).slice(0, 20)}`;
  return buildChunks({
    sourceKey,
    documentType: document.documentType || document.type || 'document',
    repo: document.repo || document.metadata?.repo || '',
    title: document.title || sourceKey,
    content,
    sourceUrl: document.sourceUrl || null,
    metadata: {
      ...(document.metadata || {}),
      labels: document.labels || document.metadata?.labels || [],
      fileNames: unique([...(document.fileNames || []), ...extractFileNames(content)]),
    },
  });
}

module.exports = {
  RagIngestionService,
  buildIssueChunks,
  buildPullRequestChunks,
  buildCommitChunks,
  buildCommitTextChunks,
  buildTicketChunks,
  buildGenericDocumentChunks,
};
