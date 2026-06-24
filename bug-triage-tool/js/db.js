'use strict';

const Auth = (() => {
  const TOKEN_KEY = 'btai_jwt';
  const USER_KEY = 'btai_user';

  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  }
  function setSession(payload) {
    localStorage.setItem(TOKEN_KEY, payload.token);
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
  }
  function clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  function request(method, url, body = null) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (token()) xhr.setRequestHeader('Authorization', `Bearer ${token()}`);
    try {
      xhr.send(body === null ? null : JSON.stringify(body));
    } catch {
      throw new Error('Backend is not running. Start the server, then try signing in again.');
    }
    let payload = {};
    try { payload = xhr.responseText ? JSON.parse(xhr.responseText) : {}; }
    catch { payload = {}; }
    if (xhr.status === 0) {
      throw new Error('Backend is not reachable. Start the server and PostgreSQL, then try again.');
    }
    if (xhr.status >= 400) throw new Error(payload.error || `Request failed (${xhr.status})`);
    return payload;
  }
  async function requestAsync(method, url, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    });
    let payload = {};
    try { payload = await res.json(); }
    catch { payload = {}; }
    if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
    return payload;
  }
  function login(username, password) {
    const payload = request('POST', '/api/auth/login', { username, password });
    setSession(payload);
    return payload.user;
  }
  function signup(name, username, password) {
    const payload = request('POST', '/api/auth/signup', { name, username, password });
    setSession(payload);
    return payload.user;
  }
  function validateSession() {
    if (!token()) return false;
    try {
      const payload = request('GET', '/api/auth/me');
      if (payload?.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
        return true;
      }
    } catch (err) {
      clear();
      return false;
    }
    clear();
    return false;
  }
  function logout() { clear(); location.reload(); }
  function isAuthenticated() { return !!token(); }

  return { token, user, login, signup, validateSession, logout, isAuthenticated, request, requestAsync };
})();

/**
 * DB - PostgreSQL-backed API adapter. Methods are synchronous to preserve the
 * existing analyzer/search UI flow, but persistence is now owned by the server.
 */
const DB = (() => {
  let _tickets = null;
  let _stats = null;
  let _ingestionLog = null;

  function _safe(fn, fallback) {
    try { return fn(); }
    catch (err) {
      console.error(err);
      if (window.UI) window.UI.toast(err.message, 'error');
      return fallback;
    }
  }

  function _refreshTickets() {
    _tickets = Auth.request('GET', '/api/tickets').tickets || [];
    return _tickets;
  }

  function getAll() {
    if (!Auth.isAuthenticated()) return [];
    return _safe(() => _tickets || _refreshTickets(), []);
  }

  function reload() {
    _tickets = null;
    _stats = null;
    _ingestionLog = null;
    return getAll();
  }

  function statsFromTickets(all) {
    const bySource = {};
    all.forEach(t => { bySource[t.source] = (bySource[t.source] || 0) + 1; });
    return {
      total: all.length,
      open: all.filter(t => t.status === 'open').length,
      inProgress: 0,
      confirmed: all.filter(t => t.status === 'confirmed').length,
      duplicated: all.filter(t => t.status === 'duplicated').length,
      resolved: all.filter(t => t.status === 'resolved').length,
      critical: all.filter(t => t.priority === 'critical').length,
      high: all.filter(t => t.priority === 'high').length,
      medium: all.filter(t => t.priority === 'medium').length,
      low: all.filter(t => t.priority === 'low').length,
      bySource,
    };
  }

  function getById(id) {
    const local = getAll().find(t => t.id === id);
    if (local) return local;
    return _safe(() => Auth.request('GET', `/api/tickets/${encodeURIComponent(id)}`).ticket, null);
  }

  function add(data) {
    const payload = Auth.request('POST', '/api/tickets', data);
    const ticket = payload.ticket ? { ...payload.ticket, _existing: !!payload.existing } : null;
    _tickets = null;
    _stats = null;
    return ticket;
  }

  function bulkUpsert(items) {
    const payload = Auth.request('POST', '/api/tickets/bulk', { tickets: items });
    _tickets = null;
    _stats = null;
    return payload;
  }

  function update(id, patch) {
    const payload = Auth.request('PATCH', `/api/tickets/${encodeURIComponent(id)}`, patch);
    _tickets = null;
    _stats = null;
    return payload.ticket || null;
  }

  function requestResolution(id, data) {
    const payload = Auth.request('POST', `/api/tickets/${encodeURIComponent(id)}/solution-requests`, data);
    _ingestionLog = null;
    return payload.request;
  }

  function getSolutionRequests() {
    return _safe(() => Auth.request('GET', '/api/solution-requests').requests || [], []);
  }

  function decideSolutionRequest(id, action) {
    const payload = Auth.request('POST', `/api/solution-requests/${id}/${action}`);
    _tickets = null;
    _stats = null;
    return payload;
  }

  function upsertImportedTicket(data, uniqueKey) {
    const existing = getAll().find(t =>
      (uniqueKey && t.sourceKey === uniqueKey) ||
      (data.githubIssueId && (t.metadata || {}).githubIssueId === data.githubIssueId) ||
      (data.sourceUrl && t.sourceUrl === data.sourceUrl)
    );
    if (!existing) return { ticket: add({ ...data, sourceKey: uniqueKey || data.sourceKey || null, visibility: data.visibility || 'public' }), created: true };
    return { ticket: update(existing.id, { ...data, sourceKey: uniqueKey || data.sourceKey || null }), created: false };
  }

  function _isTerminalStatus(status) {
    return ['resolved', 'duplicated'].includes(status);
  }

  function upsertDetectedIssue(data) {
    const existing = getAll().find(t => data.findingFingerprint && t.findingFingerprint === data.findingFingerprint);
    if (!existing) {
      const added = add({ ...data, status: data.status || 'open', visibility: data.visibility || 'private' });
      if (!added) return { ...data, id: data.findingFingerprint || data.sourceKey || 'matched-finding', _lifecycle: 'matched' };
      return { ...added, _lifecycle: added._existing ? 'matched' : 'created' };
    }

    let status = existing.status;
    let lifecycle = 'updated';
    if (_isTerminalStatus(existing.status)) status = existing.status;
    else if (data.status === 'duplicated') {
      status = 'duplicated';
      lifecycle = 'duplicated';
    } else if (existing.status === 'open') {
      status = 'confirmed';
      lifecycle = 'confirmed';
    }
    return { ...update(existing.id, { ...data, status }), _lifecycle: lifecycle };
  }

  function updateIssueStatus(id, status, metadata = {}) {
    return update(id, { status, metadata });
  }

  function markResolvedMissingFindings(sourceKey, activeFingerprints = new Set()) {
    const active = activeFingerprints instanceof Set ? activeFingerprints : new Set(activeFingerprints);
    const resolved = [];
    getAll().forEach(t => {
      const sameSource = t.findingFingerprint && (t.metadata || {}).sourceKey === sourceKey;
      if (sameSource && !active.has(t.findingFingerprint) && !['resolved', 'duplicated'].includes(t.status)) {
        resolved.push(update(t.id, { status: 'resolved', metadata: { ...(t.metadata || {}), resolvedBy: 'analysis-clean-run' } }));
      }
    });
    return resolved;
  }

  function getStats() {
    if (_stats) return _stats;
    if (!Auth.isAuthenticated()) {
      return { total: 0, open: 0, inProgress: 0, confirmed: 0, duplicated: 0, resolved: 0, critical: 0, high: 0, medium: 0, low: 0, bySource: {} };
    }
    if (_tickets) {
      _stats = statsFromTickets(_tickets);
      return _stats;
    }
    _stats = _safe(() => Auth.request('GET', '/api/stats').stats, null);
    if (_stats) return _stats;
    return statsFromTickets(getAll());
  }

  function getIngestionLog() {
    if (_ingestionLog) return _ingestionLog;
    _ingestionLog = _safe(() => Auth.request('GET', '/api/ingestion-log').log || [], []);
    return _ingestionLog;
  }

  function logIngestion(entry) {
    _safe(() => Auth.request('POST', '/api/ingestion-log', entry), null);
    _ingestionLog = null;
  }

  function getIngestionCheckpoint(key) {
    try { return JSON.parse(localStorage.getItem(`btai_checkpoint_${key}`) || 'null'); }
    catch { return null; }
  }

  function saveIngestionCheckpoint(key, checkpoint) {
    const next = { ...(getIngestionCheckpoint(key) || {}), ...checkpoint, updatedAt: new Date().toISOString() };
    localStorage.setItem(`btai_checkpoint_${key}`, JSON.stringify(next));
    return next;
  }

  function clearIngestionCheckpoint(key) {
    localStorage.removeItem(`btai_checkpoint_${key}`);
  }

  function isSeeded() { return true; }
  function seed() { return 0; }
  function remove() { throw new Error('Delete is not enabled for protected PostgreSQL tickets.'); }
  function clear() { throw new Error('Database reset is not available from the browser.'); }
  function _nextId() { return null; }

  return {
    getAll, reload, getById, add, update, remove, clear, bulkUpsert,
    requestResolution, getSolutionRequests, decideSolutionRequest,
    upsertDetectedIssue, upsertImportedTicket, updateIssueStatus, markResolvedMissingFindings,
    isSeeded, seed,
    getStats,
    getIngestionLog, logIngestion,
    getIngestionCheckpoint, saveIngestionCheckpoint, clearIngestionCheckpoint,
    _nextId,
  };
})();
