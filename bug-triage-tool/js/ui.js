'use strict';

/**
 * UI — All DOM manipulation, event handlers, and rendering
 */
const UI = (() => {

  /* ── State ──────────────────────────────────────────────── */
  let currentResults = [];
  let activeTab = 'results';
  let authMode = 'login';
  let sortedTicketCacheSource = null;
  let sortedTicketCache = [];

  /* ── DOM refs (lazily resolved) ──────────────────────────── */
  const $ = id => document.getElementById(id);
  const $$ = sel => document.querySelectorAll(sel);

  /* ════════════════════════════════════════════════════════════
   * TOAST NOTIFICATIONS
   * ════════════════════════════════════════════════════════════ */
  function toast(message, type = 'info', duration = 3500) {
    const icons = { success: 'OK', error: '!', warning: '!', info: 'i' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || 'i'}</span>
      <span>${message}</span>`;
    $('toast-container').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, duration);
  }

  /* ════════════════════════════════════════════════════════════
   * NAVBAR STATS
   * ════════════════════════════════════════════════════════════ */
  function applyTicketQuickFilter(filter = {}) {
    $('db-search-input').value = '';
    $('db-filter-status').value = filter.status || '';
    $('db-filter-priority').value = filter.priority || '';
    switchTab('database');
    renderDatabase();
  }

  function refreshStats() {
    const s = DB.getStats();
    $('nav-stats').innerHTML = `
      <button class="stat-badge total" type="button" data-ticket-filter="all" title="Show all tickets">
        <span class="dot"></span>
        ${s.total} Tickets
      </button>
      <button class="stat-badge open" type="button" data-ticket-filter="open" title="Show open tickets">
        <span class="dot"></span>
        ${s.open} Open
      </button>
      <button class="stat-badge resolved" type="button" data-ticket-filter="resolved" title="Show resolved tickets">
        <span class="dot"></span>
        ${s.resolved} Resolved
      </button>
      ${s.critical > 0 ? `<button class="stat-badge critical" type="button" data-ticket-filter="critical" title="Show critical tickets">
        <span class="dot"></span>
        ${s.critical} Critical
      </button>` : ''}
    `;
    $('nav-stats').querySelectorAll('[data-ticket-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.ticketFilter;
        if (kind === 'open') applyTicketQuickFilter({ status: 'open' });
        else if (kind === 'resolved') applyTicketQuickFilter({ status: 'resolved' });
        else if (kind === 'critical') applyTicketQuickFilter({ priority: 'critical' });
        else applyTicketQuickFilter();
      });
    });

  }

  /* ════════════════════════════════════════════════════════════
   * CHIP / BADGE HELPERS
   * ════════════════════════════════════════════════════════════ */
  function statusChip(status) {
    const labels = {
      open: 'Open',
      confirmed: 'Confirmed',
      duplicated: 'Duplicated',
      pending_approval: 'Pending Approval',
      resolved: 'Resolved',
    };
    return `<span class="chip chip-status-${status}">${labels[status] || status}</span>`;
  }

  function priorityChip(p) {
    return `<span class="chip chip-priority-${p}">${p.charAt(0).toUpperCase() + p.slice(1)}</span>`;
  }

  function langChip(lang) {
    if (!lang || lang === 'unknown') return '';
    return `<span class="chip chip-lang">${lang}</span>`;
  }

  function sourceChip(src) {
    const icons = { github: 'GH', manual: 'Manual', commit: 'Commit', log: 'Log', issue: 'Issue', pull_request: 'PR', rag: 'RAG' };
    return `<span class="chip chip-source">${icons[src] || '?'} ${src}</span>`;
  }

  function visibilityChip(visibility) {
    return `<span class="chip chip-source">${visibility === 'public' ? 'Public' : 'Private'}</span>`;
  }

  /* ════════════════════════════════════════════════════════════
   * SIMILARITY CIRCLE
   * ════════════════════════════════════════════════════════════ */
  function ticketSortValue(id) {
    const m = String(id || '').match(/^BUG-(\d+)$/);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  }

  function sortTicketsById(tickets) {
    return [...tickets].sort((a, b) =>
      ticketSortValue(a.id) - ticketSortValue(b.id) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    );
  }

  function getSortedTickets() {
    const tickets = DB.getAll();
    if (tickets === sortedTicketCacheSource) return sortedTicketCache;
    sortedTicketCacheSource = tickets;
    sortedTicketCache = sortTicketsById(tickets);
    return sortedTicketCache;
  }
  function similarityCircle(pct) {
    const r = 22;
    const circ = 2 * Math.PI * r;
    const dash = (pct / 100) * circ;
    const cls = pct >= 65 ? 'high' : pct >= 35 ? 'medium' : 'low';
    const color = pct >= 65 ? '#10b981' : pct >= 35 ? '#f59e0b' : '#ef4444';
    return `
      <div class="similarity-badge ${cls}">
        <svg width="52" height="52" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="${r}" fill="none" stroke="rgba(15,23,42,0.08)" stroke-width="3"/>
          <circle cx="26" cy="26" r="${r}" fill="none" stroke="${color}"
            stroke-width="3" stroke-linecap="round"
            stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
            style="filter:drop-shadow(0 0 3px ${color})"/>
        </svg>
        <div class="sim-text">${pct}%</div>
      </div>`;
  }

  /* ════════════════════════════════════════════════════════════
   * RESULT CARDS
   * ════════════════════════════════════════════════════════════ */
  function renderResults(results, parsed, ragAnalysis = null) {
    const list = $('results-list');
    const header = $('results-header');
    const empty  = $('empty-state');
    const analysisHtml = renderRagAnalysis(ragAnalysis);

    // show "parsed info" chips
    const chips = [];
    if (parsed?.type)     chips.push(`<span class="parsed-chip">${parsed.type === 'log' ? 'Error Log' : 'Source Code'}</span>`);
    if (parsed?.language && parsed.language !== 'unknown')
                          chips.push(`<span class="parsed-chip">${parsed.language}</span>`);
    parsed?.errors?.forEach(e => chips.push(`<span class="parsed-chip">${e.type}</span>`));

    const sortedResults = sortResultsBySimilarity(results);

    header.innerHTML = `
      <div>
        <div class="results-title">Search Results</div>
        ${chips.length ? `<div class="parsed-info" style="margin-top:6px">${chips.join('')}</div>` : ''}
      </div>
      <div class="results-meta">${sortedResults.length} match${sortedResults.length !== 1 ? 'es' : ''} found</div>
    `;

    if (sortedResults.length === 0) {
      list.innerHTML = analysisHtml;
      empty.classList.add('visible');
      empty.innerHTML = `
        <div class="empty-icon">Search</div>
        <div class="empty-title">No matches found</div>
        <div class="empty-sub">No similar RAG context was found. The app will still use safe static analysis when possible.</div>
      `;
      return;
    }

    empty.classList.remove('visible');
    list.innerHTML = analysisHtml + sortedResults.map((r, i) => `
      <div class="result-card" data-id="${r.id}" data-rag-id="${r._ragDocumentId || ''}" role="button" tabindex="0">
        <div class="result-rank">#${i + 1}</div>
        ${similarityCircle(r.similarity)}
        <div class="result-body">
          <div class="result-title">${escHtml(r.title)}</div>
          <div class="result-meta">
            <span class="result-id">${r.id}</span>
            ${statusChip(r.status)}
            ${priorityChip(r.priority)}
            ${langChip(r.language)}
            ${r._ragReason ? `<span class="chip chip-source">${escHtml(r._ragReason)}</span>` : ''}
          </div>
        </div>
        <div class="result-arrow">›</div>
      </div>
    `).join('');

    currentResults = sortedResults;
    list.querySelectorAll('.result-card').forEach(card => {
      card.addEventListener('click', () => openTicket(card.dataset.id));
      card.addEventListener('keydown', e => { if (e.key === 'Enter') openTicket(card.dataset.id); });
    });
  }

  function sortResultsBySimilarity(results) {
    return [...(results || [])].sort((a, b) =>
      Number(b.similarity || 0) - Number(a.similarity || 0) ||
      ticketSortValue(a.id) - ticketSortValue(b.id) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    );
  }

  /* ════════════════════════════════════════════════════════════
   * IDLE / INITIAL STATE
   * ════════════════════════════════════════════════════════════ */
  function renderRagAnalysis(analysis) {
    if (!analysis) return '';
    return `
      <div class="rag-analysis-card">
        <div class="rag-analysis-title">RAG Analysis</div>
        <div class="rag-analysis-sub">Confidence: ${escHtml(analysis.confidenceLevel || 'unknown')} - ${escHtml(analysis.duplicateAssessment || '')}</div>
        <div class="rag-analysis-grid">
          <div><strong>Summary</strong><p>${escHtml(analysis.bugSummary || '')}</p></div>
          <div><strong>Likely root cause</strong><p>${escHtml(analysis.likelyRootCause || '')}</p></div>
          <div><strong>Suggested fix</strong><p>${escHtml(analysis.suggestedFix || '')}</p></div>
        </div>
      </div>
    `;
  }

  function showIdleState() {
    $('results-header').innerHTML = `
      <div class="results-title">Search Results</div>
      <div class="results-meta">Upload a file or paste code to begin</div>`;
    $('results-list').innerHTML = '';
    const empty = $('empty-state');
    empty.classList.add('visible');
    empty.innerHTML = `
      <div class="empty-icon">🐛</div>
      <div class="empty-title">Ready to Triage</div>
      <div class="empty-sub">Upload an error log or source code file on the left panel, then click <strong>Analyze &amp; Search</strong> to find similar bugs.</div>
    `;
  }

  function renderDashboardTickets() {
    const tickets = getSortedTickets();
    const list = $('results-list');
    const header = $('results-header');
    const empty = $('empty-state');

    header.innerHTML = `
      <div>
        <div class="results-title">Default Tickets</div>
        <div class="results-meta">Seeded and imported tickets are ready to browse</div>
      </div>
      <div class="results-meta">${tickets.length} ticket${tickets.length !== 1 ? 's' : ''}</div>
    `;

    if (!tickets.length) {
      list.innerHTML = '';
      empty.classList.add('visible');
      empty.innerHTML = `
        <div class="empty-icon">?</div>
        <div class="empty-title">No tickets available</div>
        <div class="empty-sub">Create a ticket or check that the backend seeded the database successfully.</div>
      `;
      return;
    }

    empty.classList.remove('visible');
    list.innerHTML = tickets.slice(0, 30).map(t => `
      <div class="db-card" data-id="${t.id}" role="button" tabindex="0">
        <span class="db-card-id">${t.id}</span>
        <div style="flex:1;min-width:0">
          <div class="db-card-title">${escHtml(t.title)}</div>
          <div style="display:flex;gap:5px;margin-top:4px;flex-wrap:wrap">
            ${[...new Set(t.tags || [])].slice(0, 6).map(g => `<span class="tag">${escHtml(g)}</span>`).join('')}
          </div>
        </div>
        <div class="db-card-meta">
          ${statusChip(t.status)}
          ${visibilityChip(t.visibility)}
          ${priorityChip(t.priority)}
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.db-card').forEach(card => {
      card.addEventListener('click', () => openTicket(card.dataset.id));
      card.addEventListener('keydown', e => { if (e.key === 'Enter') openTicket(card.dataset.id); });
    });
  }

  /* ════════════════════════════════════════════════════════════
   * DATABASE TAB
   * ════════════════════════════════════════════════════════════ */
  function renderDatabase(filter = '') {
    let tickets = getSortedTickets();
    const statusF   = $('db-filter-status')?.value   || '';
    const priorityF = $('db-filter-priority')?.value || '';

    if (filter)   tickets = SearchEngine.quickFilter(filter, tickets);
    if (statusF)   tickets = tickets.filter(t => t.status   === statusF);
    if (priorityF) tickets = tickets.filter(t => t.priority === priorityF);

    const list = $('db-list');
    if (tickets.length === 0) {
      list.innerHTML = `<div class="no-results">No tickets match your filters.</div>`;
      return;
    }
    list.innerHTML = tickets.map(t => `
      <div class="db-card" data-id="${t.id}" role="button" tabindex="0">
        <span class="db-card-id">${t.id}</span>
        <div style="flex:1;min-width:0">
          <div class="db-card-title">${escHtml(t.title)}</div>
          <div style="display:flex;gap:5px;margin-top:4px;flex-wrap:wrap">
            ${[...new Set(t.tags || [])].map(g => `<span class="tag">${escHtml(g)}</span>`).join('')}
          </div>
        </div>
        <div class="db-card-meta">
          ${statusChip(t.status)}
          ${visibilityChip(t.visibility)}
          ${priorityChip(t.priority)}
        </div>
      </div>
    `).join('');

  }

  /* ════════════════════════════════════════════════════════════
   * TICKET DETAIL MODAL
   * ════════════════════════════════════════════════════════════ */
  function openTicket(id) {
    let t = DB.getById(id);
    if (!t && String(id || '').startsWith('RAG-') && window.RagClient) {
      t = RagClient.documentAsTicket(String(id).slice(4));
    }
    if (!t) return;

    const fmtDate = d => d ? new Date(d).toLocaleString() : '-';
    const isResolved = t.status === 'resolved';
    const currentUser = Auth.user();
    const isCreator = currentUser && t.createdById === currentUser.id;
    const canSubmitSolution = t.visibility === 'public' && !isResolved && !isCreator;
    const renderCode = (code, cls = '') => code
      ? `<pre class="code-block ${cls}">${escHtml(code)}</pre>`
      : `<div class="no-results" style="padding:16px">No snippet available</div>`;

    // Build diff with colour coding
    const renderDiff = diff => {
      if (!diff) return `<div class="no-results" style="padding:16px">No diff available</div>`;
      const lines = escHtml(diff).split('\n').map(line => {
        if (line.startsWith('+')) return `<span class="diff-add">${line}</span>`;
        if (line.startsWith('-')) return `<span class="diff-del">${line}</span>`;
        return `<span class="diff-ctx">${line}</span>`;
      });
      return `<pre class="code-block diff-view">${lines.join('\n')}</pre>`;
    };

    const renderSimilarityLinks = links => {
      if (!links || links.length === 0) return '';
      return `
        <div class="detail-section">
          <div class="detail-label">Similar Historical Issues</div>
          <div class="similarity-link-list">
            ${links.map(link => `
              <button class="similarity-link" data-id="${escAttr(link.id)}">
                <span>${escHtml(link.id)} - ${escHtml(link.title)}</span>
                <span>${Number(link.similarity || 0)}%</span>
              </button>
            `).join('')}
          </div>
        </div>`;
    };

    $('ticket-modal-content').innerHTML = `
      <div class="modal-header">
        <div class="modal-header-left">
          <span class="modal-id">${t.id}${t.sourceUrl ? ` - <a href="${escAttr(t.sourceUrl)}" target="_blank" rel="noopener" class="source-link">View Source</a>` : ''}</span>
          <div class="modal-title">${escHtml(t.title)}</div>
          <div class="modal-badges">
            ${statusChip(t.status)}
            ${visibilityChip(t.visibility)}
            ${priorityChip(t.priority)}
            ${langChip(t.language)}
            ${sourceChip(t.source)}
            ${t.errorType ? `<span class="chip chip-source">${escHtml(t.errorType)}</span>` : ''}
            ${t.category ? `<span class="chip" style="background:rgba(37,99,235,.12);color:#2563eb;border:1px solid rgba(37,99,235,.28)">${escHtml(t.category)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start">
          <button class="modal-close" id="modal-close-btn" aria-label="Close">x</button>
        </div>
      </div>
      <div class="modal-body">

        <!-- Meta grid -->
        <div class="detail-grid">
          <div class="detail-field">
            <div class="detail-field-label">Bug ID</div>
            <div class="detail-field-value" style="font-family:var(--font-mono);color:var(--accent-light)">${t.id}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Created At</div>
            <div class="detail-field-value">${fmtDate(t.createdAt)}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Resolved At</div>
            <div class="detail-field-value">${fmtDate(t.resolvedAt)}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Created By</div>
            <div class="detail-field-value">${escHtml(t.createdBy || 'System')}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Resolved By</div>
            <div class="detail-field-value">${escHtml(t.resolvedBy || 'Not resolved')}</div>
          </div>
        </div>

        ${t.findingFingerprint ? `
        <div class="detail-grid">
          <div class="detail-field">
            <div class="detail-field-label">Severity</div>
            <div class="detail-field-value">${escHtml(t.severity || t.priority)}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Confidence</div>
            <div class="detail-field-value">${t.confidence ?? 'n/a'}${t.confidence != null ? '%' : ''}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Duplicate Of</div>
            <div class="detail-field-value">${t.duplicateOf ? escHtml(t.duplicateOf) : 'none'}</div>
          </div>
        </div>` : ''}

        <!-- Description -->
        <div class="detail-section">
          <div class="detail-label">Description</div>
          <div class="detail-text">${escHtml(t.description)}</div>
        </div>

        ${t.solution ? `
        <div class="detail-section">
          <div class="detail-label">Solution / Fix</div>
          <div class="detail-text" style="color:var(--success)">${escHtml(t.solution)}</div>
        </div>` : ''}

        ${t.tags?.length ? `
        <div class="detail-section">
          <div class="detail-label">Tags</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${t.tags.map(g => `<span class="tag">${escHtml(g)}</span>`).join('')}
          </div>
        </div>` : ''}

        ${renderSimilarityLinks(t.similarityLinks)}

        <!-- Category + Suggested Fixes (log tickets) -->
        ${(t.category || (t.suggestedFixes && t.suggestedFixes.length)) ? `
        <div class="detail-section">
          <div style="display:grid;gap:12px">
            ${t.category ? `
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted)">Category</span>
              <span style="background:rgba(37,99,235,.12);color:#2563eb;border:1px solid rgba(37,99,235,.28);padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600">${escHtml(t.category)}</span>
            </div>` : ''}
            ${t.suggestedFixes && t.suggestedFixes.length ? `
            <div>
              <div class="detail-label" style="margin-bottom:8px">Suggested Fixes</div>
              <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px">
                ${t.suggestedFixes.map(f => `
                <li style="display:flex;align-items:flex-start;gap:8px;background:rgba(16,185,129,.07);border:1px solid rgba(16,185,129,.18);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text)">
                  <span style="color:#10b981;font-weight:700;margin-top:1px">-</span>
                  <span>${escHtml(f)}</span>
                </li>`).join('')}
              </ul>
            </div>` : ''}
          </div>
        </div>` : ''}

        <!-- Raw Log Content (collapsible, log-sourced tickets only) -->
        ${t.logContent ? `
        <div class="detail-section">
          <details>
            <summary class="code-block-label" style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;">
              <span>Raw Log</span>
              <span style="font-size:11px;color:var(--text-muted);font-weight:400">click to expand</span>
            </summary>
            <pre class="code-block" style="margin-top:8px;color:var(--text-muted);font-size:12px">${escHtml(t.logContent.substring(0, 3000))}</pre>
          </details>
        </div>` : ''}

        <!-- Code Snippets — only shown for non-log tickets with actual source code -->
        ${t.codeSnippetBefore && t.source !== 'log' ? `
        <div class="detail-section">
          <div class="code-block-label">
            <span>Code Before Fix</span>
            <button class="btn btn-ghost btn-sm" onclick="UI.copyCode('${t.id}-before')">Copy</button>
          </div>
          ${renderCode(t.codeSnippetBefore)}
        </div>` : ''}

        ${isResolved && t.codeSnippetAfter && t.source !== 'log' ? `
        <div class="detail-section">
          <div class="code-block-label">
            <span>Code After Fix</span>
            <button class="btn btn-ghost btn-sm" onclick="UI.copyCode('${t.id}-after')">Copy</button>
          </div>
          ${renderCode(t.codeSnippetAfter)}
        </div>` : ''}

        ${isResolved && t.codeSnippetDiff && t.source !== 'log' ? `
        <div class="detail-section">
          <div class="code-block-label">
            <span>Diff View</span>
            <div class="diff-legend">
              <span><span class="add-dot">+</span> Added</span>
              <span><span class="del-dot">-</span> Removed</span>
            </div>
          </div>
          ${renderDiff(t.codeSnippetDiff)}
        </div>` : ''}

        ${canSubmitSolution ? `
        <div class="detail-section">
          <div class="detail-label">Submit Solution for Approval</div>
          <div class="form-group">
            <label class="form-label" for="solution-code">Proposed Solution Code</label>
            <textarea id="solution-code" rows="5" spellcheck="false" style="font-family:var(--font-mono);font-size:12px"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label" for="solution-diff">Code Difference</label>
            <textarea id="solution-diff" rows="4" spellcheck="false" style="font-family:var(--font-mono);font-size:12px"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label" for="solution-explanation">Short Explanation</label>
            <textarea id="solution-explanation" rows="3"></textarea>
          </div>
          <button class="btn btn-primary" id="btn-submit-solution">Send Solution Request</button>
        </div>` : ''}

      </div>
    `;

    // Store code for copy buttons
    window.__codeCopy = window.__codeCopy || {};
    window.__codeCopy[`${t.id}-before`] = t.codeSnippetBefore;
    window.__codeCopy[`${t.id}-after`]  = t.codeSnippetAfter;

    $('ticket-modal-content').querySelector('#modal-close-btn')
      .addEventListener('click', closeTicketModal);

    $('ticket-modal-content').querySelectorAll('.similarity-link').forEach(btn => {
      btn.addEventListener('click', () => openTicket(btn.dataset.id));
    });

    $('btn-submit-solution')?.addEventListener('click', () => {
      DB.requestResolution(t.id, {
        proposedCode: $('solution-code').value.trim(),
        proposedDiff: $('solution-diff').value.trim(),
        explanation: $('solution-explanation').value.trim(),
      });
      closeTicketModal();
      toast('Solution request sent to the ticket creator.', 'success');
    });

    $('ticket-modal-overlay').classList.add('open');
  }

  function closeTicketModal() {
    $('ticket-modal-overlay').classList.remove('open');
  }

  function copyCode(key) {
    const code = window.__codeCopy?.[key] || '';
    navigator.clipboard.writeText(code).then(() => toast('Copied to clipboard!', 'success'));
  }

  /* ════════════════════════════════════════════════════════════
   * ADD TICKET MODAL
   * ════════════════════════════════════════════════════════════ */
  function openAddTicketModal() {
    $('add-ticket-overlay').classList.add('open');
    $('add-form').reset();
  }

  function closeAddTicketModal() {
    $('add-ticket-overlay').classList.remove('open');
  }

  function handleAddTicket(e) {
    e.preventDefault();
    const f = new FormData($('add-form'));
    const now = new Date().toISOString();
    const status = f.get('status');
    const ticketData = {
      title:             f.get('title').trim(),
      description:       f.get('description').trim(),
      status,
      visibility:         f.get('visibility'),
      priority:          f.get('priority'),
      language:          f.get('language') || 'unknown',
      errorType:         f.get('errorType').trim(),
      tags:              f.get('tags').split(',').map(t => t.trim()).filter(Boolean),
      codeSnippetBefore: f.get('snippetBefore').trim(),
      codeSnippetAfter:  f.get('snippetAfter').trim(),
      codeSnippetDiff:   f.get('snippetDiff').trim(),
      solution:          f.get('solution').trim(),
      source:            'manual',
      createdAt:         now,
      resolvedAt:        status === 'resolved' ? now : null,
    };
    DB.add(ticketData);
    closeAddTicketModal();
    refreshStats();
    renderDatabase();
    toast(`Ticket created successfully!`, 'success');
  }

  /* ════════════════════════════════════════════════════════════
   * UPLOAD / ANALYZE FLOW
   * ════════════════════════════════════════════════════════════ */
  let uploadedContent = '';
  let uploadedFileName = '';

  function handleFileSelect(file) {
    if (!file) return;
    uploadedFileName = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      uploadedContent = e.target.result;
      $('paste-input').value = uploadedContent;
      $('upload-zone').innerHTML = `
        <span class="upload-icon file-symbol" aria-hidden="true">
          <svg viewBox="0 0 48 56" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 3h20l12 12v35a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" fill="#facc15" stroke="#ca8a04" stroke-width="2"/>
            <path d="M30 3v12h12" fill="#fde68a" stroke="#ca8a04" stroke-width="2" stroke-linejoin="round"/>
            <path d="M15 27h18M15 35h18M15 43h12" stroke="#854d0e" stroke-width="3" stroke-linecap="round"/>
          </svg>
        </span>
        <div class="upload-file-badge">
          <strong>${escHtml(file.name)}</strong>
          <span style="color:var(--text-muted)">(${(file.size/1024).toFixed(1)} KB)</span>
        </div>
        <div class="upload-sub" style="margin-top:8px">Click to replace file</div>
      `;
      toast(`File "${file.name}" loaded`, 'success');
    };
    reader.readAsText(file);
  }

  function handleAnalyze() {
    const content = $('paste-input').value.trim();
    if (!content) {
      toast('Please upload a file or paste code/log first.', 'warning');
      return;
    }

    const btn = $('btn-analyze');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Analyzing...`;

    setTimeout(() => {
      try {
        const parsed = Parser.parse(content);
        const sourceName = uploadedFileName || 'pasted snippet';
        const sourceKey = uploadedFileName
          ? `analysis:file:${uploadedFileName}`
          : `analysis:paste:${Analyzer.hash(content.substring(0, 300))}`;
        const analysis = Analyzer.analyzeAndPersist(content, {
          parsed,
          tickets: DB.getAll(),
          source: {
            type: 'analysis',
            name: sourceName,
            sourceKey,
          },
        });
        const tickets = DB.getAll();

        // Apply filters
        let filteredTickets = tickets;
        const pf = $('filter-priority').value;
        const sf = $('filter-status').value;
        if (pf) filteredTickets = filteredTickets.filter(t => t.priority === pf);
        if (sf) filteredTickets = filteredTickets.filter(t => t.status   === sf);

        let ragPayload = null;
        let ragUnavailable = false;
        try {
          ragPayload = RagClient.analyze(content, parsed, {
            topK: 12,
            metadata: { sourceName, sourceKey },
          });
        } catch (err) {
          ragUnavailable = true;
          console.warn('RAG unavailable, falling back to local search:', err.message);
        }

        const exactCodeResults = SearchEngine.exactCodeMatches(content, tickets, 8);
        const historicalResults = SearchEngine.search(parsed, filteredTickets, 20);
        const detectedResults = analysis.saved.map(t => ({
          ...t,
          similarity: t.confidence || 75,
        }));
        const seen = new Set();
        const results = [...exactCodeResults, ...detectedResults, ...historicalResults]
          .filter(t => {
            if (seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
          })
          .sort((a, b) => Number(b.similarity || 0) - Number(a.similarity || 0))
          .slice(0, 20);
        renderResults(results, parsed, ragPayload?.analysis || null);

        if (analysis.findings.length || analysis.resolved.length) {
          DB.logIngestion({
            type: 'analysis',
            source: sourceName,
            count: analysis.created,
            status: 'success',
            findings: analysis.findings.length,
            updated: analysis.updated + analysis.confirmed + analysis.duplicated,
            resolved: analysis.resolved.length,
          });
        }

        // Switch to results tab
        switchTab('results');
        refreshStats();
        if (activeTab === 'database') renderDatabase();
        const savedMsg = analysis.findings.length
          ? ` Detected ${analysis.findings.length} risky pattern${analysis.findings.length !== 1 ? 's' : ''}; saved ${analysis.created} new.`
          : ' No new risky patterns detected.';
        const searchMsg = ragUnavailable
          ? `RAG unavailable; found ${historicalResults.length} fallback ticket${historicalResults.length !== 1 ? 's' : ''}.`
          : ragPayload
            ? `RAG analysis generated; found ${results.length} ticket match${results.length !== 1 ? 'es' : ''}.`
            : `No RAG matches; found ${historicalResults.length} fallback ticket${historicalResults.length !== 1 ? 's' : ''}.`;
        toast(`${searchMsg}${savedMsg}`, results.length > 0 ? 'success' : 'info');
      } catch (err) {
        console.error(err);
        toast('Analysis failed: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Analyze & Search';
      }
    }, 50);
  }

  /* ════════════════════════════════════════════════════════════
   * TABS
   * ════════════════════════════════════════════════════════════ */
  function renderSolutionRequests() {
    const container = $('solution-requests-list');
    if (!container) return;
    const requests = DB.getSolutionRequests();
    if (!requests.length) {
      container.innerHTML = `<div class="no-results">No pending solution requests.</div>`;
      return;
    }
    container.innerHTML = requests.map(r => `
      <div class="learn-card solution-request-card" data-id="${r.id}">
        <div class="learn-card-header">
          <div>
            <div class="learn-card-title">${escHtml(r.ticketId)} - ${escHtml(r.ticketTitle)}</div>
            <div class="learn-card-sub">Requested by ${escHtml(r.requesterName)}</div>
          </div>
        </div>
        <div class="learn-card-body">
          <div class="detail-label">Proposed Solution Code</div>
          <pre class="code-block">${escHtml(r.proposedCode || 'No code provided')}</pre>
          ${r.proposedDiff ? `<div class="detail-label">Code Difference</div><pre class="code-block diff-view">${escHtml(r.proposedDiff)}</pre>` : ''}
          <div class="detail-label">Explanation</div>
          <div class="detail-text">${escHtml(r.explanation || '')}</div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px">
            <button class="btn btn-ghost btn-reject-request" data-id="${r.id}">Reject</button>
            <button class="btn btn-primary btn-accept-request" data-id="${r.id}">Accept Solution</button>
          </div>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('.btn-accept-request').forEach(btn => {
      btn.addEventListener('click', () => {
        DB.decideSolutionRequest(btn.dataset.id, 'accept');
        DB.reload();
        refreshStats();
        renderSolutionRequests();
        renderDatabase();
        toast('Solution accepted. Ticket marked resolved.', 'success');
      });
    });
    container.querySelectorAll('.btn-reject-request').forEach(btn => {
      btn.addEventListener('click', () => {
        DB.decideSolutionRequest(btn.dataset.id, 'reject');
        renderSolutionRequests();
        toast('Solution request rejected.', 'info');
      });
    });
  }

  function switchTab(tab) {
    activeTab = tab;
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    if (tab === 'database') renderDatabase();
    if (tab === 'requests') renderSolutionRequests();
    if (tab === 'learning') renderIngestionLog();
  }

  /* ════════════════════════════════════════════════════════════
   * LEARNING TAB — INGESTION LOG
   * ════════════════════════════════════════════════════════════ */
  function renderIngestionLog() {
    const log = DB.getIngestionLog();
    const container = $('ingestion-log-list');
    if (!container) return;
    if (log.length === 0) {
      container.innerHTML = `<div class="no-results">No ingestion history yet.</div>`;
      return;
    }
    const icons = { github: 'GH', commit: 'DIFF', log: 'LOG', manual: 'MAN' };
    container.innerHTML = log.map(e => `
      <div class="ingest-entry">
        <div class="ingest-type-badge">${icons[e.type] || '?'}</div>
        <div class="ingest-entry-details">
          <div class="ingest-entry-source">${escHtml(e.source || e.type)}</div>
          <div class="ingest-entry-meta">${e.count ? `+${e.count} tickets - ` : ''}${new Date(e.timestamp).toLocaleString()}</div>
        </div>
        <span class="chip chip-status-${e.status === 'success' ? 'resolved' : 'open'}">${e.status}</span>
      </div>
    `).join('');
  }

  /* ── GitHub ingest ────────────────────────────────────────── */
  async function handleGitHubIngest() {
    const repo  = $('gh-repo-input').value.trim();
    const token = $('gh-token-input').value.trim();
    if (!repo) { toast('Please enter a repo (e.g. python/cpython)', 'warning'); return; }

    GitHub.setToken(token);

    const btn = $('gh-fetch-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Fetching...`;

    const log = $('gh-progress-log');
    log.classList.add('visible');
    log.innerHTML = '';

    const addLog = (msg, isError = false) => {
      const div = document.createElement('div');
      div.className = 'log-entry' + (isError ? ' error' : '');
      div.textContent = `> ${msg}`;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    };

    try {
      addLog('Fetching GitHub issues and saving visible tickets first...');
      const result = await GitHub.ingestRepo(repo, addLog);
      refreshStats();
      renderDatabase();
      if (activeTab === 'learning') renderIngestionLog();
      if (result.status === 'rate_limited') {
        const retryText = result.retryAt
          ? ` Retry after ${new Date(result.retryAt).toLocaleString()}.`
          : '';
        toast(`Saved ${result.count} new and updated ${result.updated} from ${repo}.${retryText}`, 'warning', 7000);
      } else {
        toast(`Imported ${result.count} new and updated ${result.updated} ticket${result.count + result.updated !== 1 ? 's' : ''} from ${repo}`, 'success', 3500);
      }

      addLog('Starting lightweight RAG indexing in the background...');
      RagClient.ingestRepoAsync(repo, token, 10)
        .then(payload => {
          const ragResult = payload.result || {};
          addLog(`RAG indexed ${ragResult.chunks || 0} chunks from ${ragResult.issues || 0} issues, ${ragResult.pullRequests || 0} PRs, and ${ragResult.commits || 0} commits.`);
          if (activeTab === 'learning') renderIngestionLog();
        })
        .catch(err => addLog(`RAG ingest failed: ${err.message}`, true));
    } catch (err) {
      addLog(err.message, true);
      toast(err.message, 'error', 6000);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Fetch Issues';
    }
  }

  /* ── Commit ingest ────────────────────────────────────────── */
  function handleCommitIngest() {
    const text = $('commit-input').value.trim();
    if (!text) { toast('Paste a commit message or diff first.', 'warning'); return; }
    const ticketData = GitHub.parseCommit(text);
    DB.add(ticketData);
    DB.logIngestion({ type: 'commit', source: ticketData.title.substring(0,50), count: 1, status: 'success' });
    $('commit-input').value = '';
    refreshStats();
    renderDatabase();
    toast('Commit converted to ticket!', 'success');
  }

  /* ── Production log ingest ────────────────────────────────── */
  function handleLogIngest() {
    const text  = $('prod-log-input').value.trim();
    const title = $('prod-log-title').value.trim();
    if (!text) { toast('Paste a production log first.', 'warning'); return; }
    const ticketData = GitHub.parseProductionLog(text, title);
    DB.add(ticketData);
    DB.logIngestion({ type: 'log', source: title || ticketData.errorType || 'Production log', count: 1, status: 'success' });
    $('prod-log-input').value = '';
    $('prod-log-title').value = '';
    refreshStats();
    renderDatabase();
    toast('Production log converted to ticket!', 'success');
  }

  /* ════════════════════════════════════════════════════════════
   * HTML ESCAPING
   * ════════════════════════════════════════════════════════════ */
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(str) { return escHtml(str); }

  /* ════════════════════════════════════════════════════════════
   * INIT
   * ════════════════════════════════════════════════════════════ */
  function setAuthMode(mode) {
    authMode = mode;
    const signup = authMode === 'signup';
    $('auth-title').textContent = signup ? 'Create account' : 'Welcome back';
    document.querySelector('.auth-subtitle').textContent = signup ? 'Create your BugRelayAI account' : 'Login to continue to your account';
    $('auth-submit').textContent = signup ? 'Create Account' : 'Sign In';
    $('auth-switch-copy').textContent = signup ? 'Already have an account?' : "Don't have an account?";
    $('auth-toggle').textContent = signup ? 'Sign in' : 'Sign up';
    $('auth-name-group').style.display = signup ? '' : 'none';
  }

  function handleAuthSubmit(e) {
    e.preventDefault();
    try {
      const username = $('auth-username').value.trim();
      const password = $('auth-password').value;
      if (authMode === 'signup') Auth.signup($('auth-name').value.trim(), username, password);
      else Auth.login(username, password);
      $('auth-screen').classList.add('hidden');
      startApp();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function startApp() {
    const user = Auth.user();
    renderCurrentUser(user);
    DB.reload();
    sortedTicketCacheSource = null;
    refreshStats();
    renderDashboardTickets();
    if (activeTab === 'database') renderDatabase();
  }

  function renderCurrentUser(user) {
    const el = $('current-user');
    if (!el) return;
    if (!user) {
      el.innerHTML = '';
      return;
    }
    const label = user.name || user.username || 'User';
    const initials = label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase() || 'U';
    el.innerHTML = `<span class="account-avatar" title="${escAttr(label)}">${escHtml(initials)}</span>`;
  }

  function init() {
    $('auth-form')?.addEventListener('submit', handleAuthSubmit);
    $('auth-toggle')?.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));
    $('btn-logout')?.addEventListener('click', Auth.logout);
    $('profile-button')?.addEventListener('click', e => {
      e.stopPropagation();
      const menu = $('profile-menu');
      const open = !menu.classList.contains('open');
      menu.classList.toggle('open', open);
      $('profile-button')?.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', e => {
      const menu = $('profile-menu');
      if (menu && !menu.contains(e.target)) {
        menu.classList.remove('open');
        $('profile-button')?.setAttribute('aria-expanded', 'false');
      }
    });
    setAuthMode('login');
    const sessionValid = Auth.validateSession();
    if (!sessionValid) {
      renderCurrentUser(null);
      $('auth-screen').classList.remove('hidden');
    } else {
      $('auth-screen').classList.add('hidden');
      // Seed database on first load
      const seeded = DB.seed(SEED_DATA);
      if (seeded > 0) toast(`Loaded ${seeded} sample bug tickets`, 'info', 4000);
      startApp();
    }

    /* ── Upload Zone ─────────────────────────────────────── */
    const zone = $('upload-zone');
    const fileInput = $('file-input');

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    });
    fileInput.addEventListener('change', e => handleFileSelect(e.target.files[0]));

    /* ── Analyze button ──────────────────────────────────── */
    $('btn-analyze').addEventListener('click', handleAnalyze);

    /* ── Tabs ────────────────────────────────────────────── */
    $$('.tab-btn').forEach(btn =>
      btn.addEventListener('click', () => switchTab(btn.dataset.tab))
    );

    /* ── Database filters ────────────────────────────────── */
    ['db-search-input','db-filter-status','db-filter-priority'].forEach(id => {
      $(`${id}`)?.addEventListener('input', () =>
        renderDatabase($('db-search-input')?.value.trim() || '')
      );
    });
    $('db-list')?.addEventListener('click', e => {
      const card = e.target.closest('.db-card');
      if (card) openTicket(card.dataset.id);
    });
    $('db-list')?.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const card = e.target.closest('.db-card');
      if (card) openTicket(card.dataset.id);
    });

    /* ── Ticket modal ────────────────────────────────────── */
    $('ticket-modal-overlay').addEventListener('click', e => {
      if (e.target === $('ticket-modal-overlay')) closeTicketModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeTicketModal();
        closeAddTicketModal();
      }
    });

    /* ── Add ticket ──────────────────────────────────────── */
    $('btn-add-ticket').addEventListener('click', openAddTicketModal);
    $('add-ticket-overlay').addEventListener('click', e => {
      if (e.target === $('add-ticket-overlay')) closeAddTicketModal();
    });
    $('btn-close-add-modal').addEventListener('click', closeAddTicketModal);
    $('add-form').addEventListener('submit', handleAddTicket);

    /* ── Reset ───────────────────────────────────────────── */

    /* ── GitHub ──────────────────────────────────────────── */
    $('gh-fetch-btn')?.addEventListener('click', handleGitHubIngest);

    /* ── Commit ingestion ────────────────────────────────── */
    $('btn-ingest-commit')?.addEventListener('click', handleCommitIngest);

    /* ── Prod log ingestion ──────────────────────────────── */
    $('btn-ingest-log')?.addEventListener('click', handleLogIngest);
  }

  return {
    init, toast, refreshStats, renderResults, renderDatabase,
    openTicket, closeTicketModal, copyCode, switchTab,
  };
})();

// Expose globally for inline onclick handlers
window.UI = UI;

document.addEventListener('DOMContentLoaded', UI.init);


