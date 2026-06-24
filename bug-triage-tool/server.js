'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createRagServices } = require('./server/rag');

const ROOT = __dirname;
loadEnvFile(path.join(ROOT, '.env.local'));
loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || process.argv[2] || 8000);
const HOST = process.env.HOST || '127.0.0.1';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/bugtriageai';

const pool = new Pool({ connectionString: DATABASE_URL });
const rag = createRagServices({ pool, logger: console });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) reject(new Error('Request body too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function tokenFor(user) {
  return jwt.sign({ sub: user.id, username: user.username, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
}

async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    json(res, 401, { error: 'Authentication required' });
    return null;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('select id, username, name, created_at from users where id = $1', [payload.sub]);
    if (!rows[0]) throw new Error('User not found');
    return toUser(rows[0]);
  } catch {
    json(res, 401, { error: 'Invalid or expired token' });
    return null;
  }
}

function toUser(row) {
  return { id: row.id, username: row.username, name: row.name, createdAt: row.created_at };
}

function toTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    priority: row.priority,
    language: row.language,
    errorType: row.error_type,
    tags: row.tags || [],
    codeSnippetBefore: row.code_snippet_before || '',
    codeSnippetAfter: row.status === 'resolved' ? row.code_snippet_after || '' : '',
    codeSnippetDiff: row.status === 'resolved' ? row.code_snippet_diff || '' : '',
    solution: row.solution || '',
    suggestedFix: row.suggested_fix || '',
    suggestedFixes: row.suggested_fixes || [],
    category: row.category || '',
    logContent: row.log_content || '',
    severity: row.severity || row.priority,
    confidence: row.confidence,
    similarityLinks: row.similarity_links || [],
    metadata: row.metadata || {},
    sourceKey: row.source_key,
    findingFingerprint: row.finding_fingerprint,
    duplicateOf: row.duplicate_of,
    source: row.source,
    sourceUrl: row.source_url,
    createdBy: row.created_by_name || row.created_by_username || 'System',
    createdById: row.created_by,
    resolvedBy: row.resolved_by_name || row.resolved_by_username || null,
    resolvedById: row.resolved_by,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTicket(data, user) {
  const status = data.status === 'in_progress' ? 'open' : (data.status || 'open');
  const now = new Date().toISOString();
  const sourceKey = normalizeSourceKey(data);
  return {
    id: data.id || null,
    title: data.title || 'Untitled Bug',
    description: data.description || '',
    status,
    visibility: data.visibility === 'public' ? 'public' : 'private',
    priority: data.priority || 'medium',
    language: data.language || 'unknown',
    errorType: data.errorType || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    codeSnippetBefore: data.codeSnippetBefore || '',
    codeSnippetAfter: status === 'resolved' ? data.codeSnippetAfter || '' : '',
    codeSnippetDiff: status === 'resolved' ? data.codeSnippetDiff || '' : '',
    solution: data.solution || data.suggestedFix || '',
    suggestedFix: data.suggestedFix || data.solution || '',
    suggestedFixes: Array.isArray(data.suggestedFixes) ? data.suggestedFixes : [],
    category: data.category || '',
    logContent: data.logContent || '',
    severity: data.severity || data.priority || 'medium',
    confidence: Number.isFinite(data.confidence) ? data.confidence : null,
    similarityLinks: Array.isArray(data.similarityLinks) ? data.similarityLinks : [],
    metadata: data.metadata || {},
    sourceKey,
    findingFingerprint: data.findingFingerprint || null,
    duplicateOf: data.duplicateOf || null,
    source: data.source || 'manual',
    sourceUrl: data.sourceUrl || null,
    createdBy: data.createdById || user?.id || null,
    resolvedBy: status === 'resolved' ? (data.resolvedById || user?.id || null) : null,
    createdAt: data.createdAt || now,
    resolvedAt: status === 'resolved' ? (data.resolvedAt || now) : null,
    updatedAt: data.updatedAt || now,
  };
}

function normalizeSourceKey(data = {}) {
  if (data.sourceKey) return data.sourceKey;
  if (data.findingFingerprint && data.metadata?.sourceKey) {
    return `${data.metadata.sourceKey}:finding:${data.findingFingerprint}`;
  }
  return data.metadata?.sourceKey || null;
}

async function nextTicketId(client = pool) {
  const { rows } = await client.query("select nextval('ticket_counter') as n");
  return `BUG-${String(rows[0].n).padStart(3, '0')}`;
}

async function syncTicketCounter(client = pool) {
  const { rows } = await client.query(
    "select coalesce(max(substring(id from 5)::int), 0) as max_id from tickets where id ~ '^BUG-[0-9]+$'"
  );
  const maxId = Number(rows[0]?.max_id || 0);
  await client.query("select setval('ticket_counter', $1, $2)", [Math.max(maxId, 1), maxId > 0]);
}

async function insertTicket(data, user, client = pool) {
  const t = normalizeTicket(data, user);
  const sql = `
    insert into tickets (
      id,title,description,status,visibility,priority,language,error_type,tags,
      code_snippet_before,code_snippet_after,code_snippet_diff,solution,suggested_fix,
      suggested_fixes,category,log_content,severity,confidence,similarity_links,metadata,
      source_key,finding_fingerprint,duplicate_of,source,source_url,created_by,resolved_by,
      created_at,resolved_at,updated_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
    )
    returning *`;
  const explicitId = Boolean(t.id);

  for (let attempt = 0; attempt < 3; attempt++) {
    const id = explicitId ? t.id : await nextTicketId(client);
    const values = [
      id,t.title,t.description,t.status,t.visibility,t.priority,t.language,t.errorType,t.tags,
      t.codeSnippetBefore,t.codeSnippetAfter,t.codeSnippetDiff,t.solution,t.suggestedFix,
      JSON.stringify(t.suggestedFixes),t.category,t.logContent,t.severity,t.confidence,JSON.stringify(t.similarityLinks),JSON.stringify(t.metadata),
      t.sourceKey,t.findingFingerprint,t.duplicateOf,t.source,t.sourceUrl,t.createdBy,t.resolvedBy,
      t.createdAt,t.resolvedAt,t.updatedAt,
    ];
    try {
      const { rows } = await client.query(sql, values);
      return rows[0];
    } catch (err) {
      if (!explicitId && err.code === '23505' && err.constraint === 'tickets_pkey') {
        await syncTicketCounter(client);
        continue;
      }
      throw err;
    }
  }

  throw new Error('Could not allocate a unique ticket ID');
}

async function findTicketForUpsert(data, user, client = pool) {
  const sourceKey = normalizeSourceKey(data);
  const checks = [
    ['t.finding_fingerprint = $2', data.findingFingerprint],
    ['t.source_key = $2', sourceKey],
    ['t.source_url = $2', data.sourceUrl],
    ['t.id = $2', data.id],
  ].filter(([, value]) => value);

  for (const [where, value] of checks) {
    const { rows } = await client.query(
      `select t.*, cu.username created_by_username, cu.name created_by_name, ru.username resolved_by_username, ru.name resolved_by_name
       from tickets t
       left join users cu on cu.id = t.created_by
       left join users ru on ru.id = t.resolved_by
       where (t.visibility = 'public' or t.created_by = $1) and ${where}
       limit 1`,
      [user.id, value]
    );
    if (rows[0]) return rows[0];
  }

  return null;
}

async function updateTicketFromData(id, data, user, client = pool) {
  const t = normalizeTicket({ ...data, id }, user);
  const { rows } = await client.query(
    `update tickets set
      title = $2, description = $3, status = $4, visibility = $5, priority = $6,
      language = $7, error_type = $8, tags = $9, code_snippet_before = $10,
      code_snippet_after = $11, code_snippet_diff = $12, solution = $13,
      suggested_fix = $14, suggested_fixes = $15, category = $16, log_content = $17,
      severity = $18, confidence = $19, similarity_links = $20, metadata = $21,
      source_key = $22, finding_fingerprint = $23, duplicate_of = $24, source = $25,
      source_url = $26, resolved_by = $27, resolved_at = $28, updated_at = now()
     where id = $1
     returning *`,
    [
      id,t.title,t.description,t.status,t.visibility,t.priority,t.language,t.errorType,t.tags,
      t.codeSnippetBefore,t.codeSnippetAfter,t.codeSnippetDiff,t.solution,t.suggestedFix,
      JSON.stringify(t.suggestedFixes),t.category,t.logContent,t.severity,t.confidence,
      JSON.stringify(t.similarityLinks),JSON.stringify(t.metadata),t.sourceKey,t.findingFingerprint,
      t.duplicateOf,t.source,t.sourceUrl,t.resolvedBy,t.resolvedAt,
    ]
  );
  return rows[0];
}

async function selectTickets(user, where = '', params = []) {
  const visibility = user ? '(t.visibility = \'public\' or t.created_by = $1)' : 't.visibility = \'public\'';
  const shifted = user ? params : params.slice(1);
  const sql = `
    select t.*, cu.username created_by_username, cu.name created_by_name, ru.username resolved_by_username, ru.name resolved_by_name
    from tickets t
    left join users cu on cu.id = t.created_by
    left join users ru on ru.id = t.resolved_by
    where ${visibility} ${where}
    order by
      case when t.id ~ '^BUG-[0-9]+$' then substring(t.id from 5)::int else 2147483647 end asc,
      t.id asc,
      t.created_at asc`;
  const { rows } = await pool.query(sql, user ? [user.id, ...params] : shifted);
  return rows.map(toTicket);
}

async function handleAuth(req, res, pathname) {
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = await requireUser(req, res);
    if (user) json(res, 200, { user });
    return true;
  }

  if (!['/api/auth/signup', '/api/auth/login'].includes(pathname) || req.method !== 'POST') return false;
  const body = await readBody(req);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || username).trim();
  if (!username || password.length < 6) {
    json(res, 400, { error: 'Username and a 6+ character password are required' });
    return true;
  }

  if (pathname.endsWith('/signup')) {
    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const { rows } = await pool.query(
        'insert into users (username, password_hash, name) values ($1,$2,$3) returning id, username, name, created_at',
        [username, passwordHash, name]
      );
      const user = toUser(rows[0]);
      json(res, 201, { token: tokenFor(user), user });
    } catch (err) {
      json(res, err.code === '23505' ? 409 : 500, { error: err.code === '23505' ? 'Username already exists' : err.message });
    }
    return true;
  }

  const { rows } = await pool.query('select * from users where username = $1', [username]);
  const userRow = rows[0];
  if (!userRow || !(await bcrypt.compare(password, userRow.password_hash))) {
    json(res, 401, { error: 'Invalid username or password' });
    return true;
  }
  const user = toUser(userRow);
  json(res, 200, { token: tokenFor(user), user });
  return true;
}

async function handleTickets(req, res, pathname) {
  if (!pathname.startsWith('/api/tickets')) return false;
  const user = await requireUser(req, res);
  if (!user) return true;

  const idMatch = pathname.match(/^\/api\/tickets\/([^/]+)$/);
  const requestMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/solution-requests$/);

  if (pathname === '/api/tickets' && req.method === 'GET') {
    json(res, 200, { tickets: await selectTickets(user) });
    return true;
  }

  if (pathname === '/api/tickets/bulk' && req.method === 'POST') {
    const body = await readBody(req);
    const tickets = Array.isArray(body.tickets) ? body.tickets.slice(0, 250) : [];
    if (!tickets.length) {
      json(res, 400, { error: 'Provide at least one ticket.' });
      return true;
    }

    const client = await pool.connect();
    const items = [];
    let added = 0;
    let updated = 0;
    try {
      await client.query('begin');
      for (const data of tickets) {
        let row = await findTicketForUpsert(data, user, client);
        if (row) {
          row = await updateTicketFromData(row.id, data, user, client);
          updated++;
        } else {
          try {
            row = await insertTicket(data, user, client);
            added++;
          } catch (err) {
            if (err.code !== '23505') throw err;
            row = await findTicketForUpsert(data, user, client);
            if (!row) throw err;
            row = await updateTicketFromData(row.id, data, user, client);
            updated++;
          }
        }
        items.push(toTicket({ ...row, created_by_name: user.name }));
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }

    json(res, 200, { added, updated, tickets: items });
    return true;
  }

  if (pathname === '/api/tickets' && req.method === 'POST') {
    const body = await readBody(req);
    const existing = await findTicketForUpsert(body, user);
    if (existing) {
      json(res, 200, { ticket: toTicket(existing), existing: true });
      return true;
    }

    try {
      const created = await insertTicket(body, user);
      await maybeIndexTicket(toTicket({ ...created, created_by_name: user.name }));
      json(res, 201, { ticket: toTicket({ ...created, created_by_name: user.name }) });
    } catch (err) {
      if (err.code === '23505') {
        const duplicate = await findTicketForUpsert(body, user);
        if (duplicate) {
          json(res, 200, { ticket: toTicket(duplicate), existing: true });
          return true;
        }
        json(res, 409, { error: 'A matching ticket already exists. Refresh the database and try again.' });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (idMatch && req.method === 'GET') {
    const tickets = await selectTickets(user, 'and t.id = $2', [idMatch[1]]);
    if (!tickets[0]) json(res, 404, { error: 'Ticket not found' });
    else json(res, 200, { ticket: tickets[0] });
    return true;
  }

  if (idMatch && req.method === 'PATCH') {
    const body = await readBody(req);
    const ticket = (await selectTickets(user, 'and t.id = $2', [idMatch[1]]))[0];
    if (!ticket) {
      json(res, 404, { error: 'Ticket not found' });
      return true;
    }
    if (ticket.visibility === 'public' && ticket.createdById !== user.id && body.status === 'resolved') {
      const { rows } = await pool.query(
        `insert into solution_requests (ticket_id, requester_id, proposed_code, proposed_diff, explanation)
         values ($1,$2,$3,$4,$5) returning *`,
        [ticket.id, user.id, body.codeSnippetAfter || '', body.codeSnippetDiff || '', body.solution || body.explanation || 'Proposed resolution']
      );
      json(res, 202, { request: rows[0], message: 'Resolution sent to the ticket creator for approval.' });
      return true;
    }

    const status = body.status || ticket.status;
    const resolved = status === 'resolved';
    const { rows } = await pool.query(
      `update tickets set
        title = coalesce($2,title), description = coalesce($3,description), status = $4,
        visibility = coalesce($5,visibility), priority = coalesce($6,priority), language = coalesce($7,language),
        error_type = coalesce($8,error_type), tags = coalesce($9,tags), code_snippet_before = coalesce($10,code_snippet_before),
        code_snippet_after = case when $4 = 'resolved' then coalesce($11,code_snippet_after) else code_snippet_after end,
        code_snippet_diff = case when $4 = 'resolved' then coalesce($12,code_snippet_diff) else code_snippet_diff end,
        solution = coalesce($13,solution), resolved_by = case when $4 = 'resolved' then $14 else resolved_by end,
        resolved_at = case when $4 = 'resolved' then coalesce(resolved_at, now()) else resolved_at end,
        updated_at = now()
       where id = $1 returning *`,
      [
        ticket.id, body.title, body.description, status, body.visibility, body.priority, body.language, body.errorType,
        Array.isArray(body.tags) ? body.tags : null, body.codeSnippetBefore, body.codeSnippetAfter, body.codeSnippetDiff,
        body.solution, resolved ? user.id : null,
      ]
    );
    const updatedTicket = toTicket({ ...rows[0], created_by_name: ticket.createdBy, resolved_by_name: resolved ? user.name : ticket.resolvedBy });
    await maybeIndexTicket(updatedTicket);
    json(res, 200, { ticket: updatedTicket });
    return true;
  }

  if (requestMatch && req.method === 'POST') {
    const ticket = (await selectTickets(user, 'and t.id = $2', [requestMatch[1]]))[0];
    if (!ticket || ticket.visibility !== 'public') {
      json(res, 404, { error: 'Public ticket not found' });
      return true;
    }
    const body = await readBody(req);
    const { rows } = await pool.query(
      `insert into solution_requests (ticket_id, requester_id, proposed_code, proposed_diff, explanation)
       values ($1,$2,$3,$4,$5) returning *`,
      [ticket.id, user.id, body.proposedCode || body.codeSnippetAfter || '', body.proposedDiff || body.codeSnippetDiff || '', body.explanation || body.solution || 'Proposed solution']
    );
    json(res, 201, { request: rows[0] });
    return true;
  }

  return false;
}

async function maybeIndexTicket(ticket) {
  try {
    const result = await rag.ingestion.ingestTicket(ticket);
    console.log(`[rag] indexed ticket ${ticket.id}: ${result.chunks} chunks (${result.provider || result.embeddingProvider || 'unknown'})`);
  } catch (err) {
    console.warn(`[rag] ticket indexing skipped for ${ticket?.id || 'unknown'}: ${err.message}`);
  }
}

async function handleSolutionRequests(req, res, pathname) {
  if (!pathname.startsWith('/api/solution-requests')) return false;
  const user = await requireUser(req, res);
  if (!user) return true;

  if (pathname === '/api/solution-requests' && req.method === 'GET') {
    const { rows } = await pool.query(
      `select sr.*, t.title ticket_title, u.name requester_name, u.username requester_username
       from solution_requests sr
       join tickets t on t.id = sr.ticket_id
       join users u on u.id = sr.requester_id
       where t.created_by = $1 and sr.status = 'pending'
       order by sr.created_at desc`,
      [user.id]
    );
    json(res, 200, { requests: rows.map(r => ({
      id: r.id,
      ticketId: r.ticket_id,
      ticketTitle: r.ticket_title,
      requesterName: r.requester_name || r.requester_username,
      proposedCode: r.proposed_code,
      proposedDiff: r.proposed_diff,
      explanation: r.explanation,
      status: r.status,
      createdAt: r.created_at,
    })) });
    return true;
  }

  const actionMatch = pathname.match(/^\/api\/solution-requests\/(\d+)\/(accept|reject)$/);
  if (actionMatch && req.method === 'POST') {
    const id = Number(actionMatch[1]);
    const action = actionMatch[2];
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `select sr.*, t.created_by from solution_requests sr join tickets t on t.id = sr.ticket_id where sr.id = $1 for update`,
        [id]
      );
      const reqRow = rows[0];
      if (!reqRow || reqRow.created_by !== user.id) {
        await client.query('rollback');
        json(res, 404, { error: 'Solution request not found' });
        return true;
      }
      if (action === 'accept') {
        await client.query(
          `update tickets set status = 'resolved', code_snippet_after = $2, code_snippet_diff = $3,
           solution = $4, resolved_by = $5, resolved_at = now(), updated_at = now() where id = $1`,
          [reqRow.ticket_id, reqRow.proposed_code, reqRow.proposed_diff, reqRow.explanation, reqRow.requester_id]
        );
        await client.query("update solution_requests set status = 'accepted', decided_at = now() where id = $1", [id]);
        await client.query("update solution_requests set status = 'rejected', decided_at = now() where ticket_id = $1 and id <> $2 and status = 'pending'", [reqRow.ticket_id, id]);
      } else {
        await client.query("update solution_requests set status = 'rejected', decided_at = now() where id = $1", [id]);
      }
      await client.query('commit');
      json(res, 200, { ok: true });
    } catch (err) {
      await client.query('rollback');
      json(res, 500, { error: err.message });
    } finally {
      client.release();
    }
    return true;
  }

  return false;
}

async function handleRag(req, res, pathname) {
  if (!pathname.startsWith('/api/rag')) return false;
  const user = await requireUser(req, res);
  if (!user) return true;

  if (pathname === '/api/rag/ingest' && req.method === 'POST') {
    const body = await readBody(req);
    let result;
    if (body.repo) {
      result = await rag.ingestion.ingestGitHubRepo({
        repo: body.repo,
        token: body.token || '',
        maxItems: body.maxItems || 25,
        includeComments: body.includeComments === true,
        includeCommitDetails: body.includeCommitDetails === true,
      });
    } else if (body.commitText) {
      result = await rag.ingestion.ingestCommitText(body.commitText, body.metadata || {});
    } else if (Array.isArray(body.documents)) {
      result = await rag.ingestion.ingestDocuments(body.documents);
    } else if (body.ticketId) {
      const ticket = (await selectTickets(user, 'and t.id = $2', [body.ticketId]))[0];
      if (!ticket) {
        json(res, 404, { error: 'Ticket not found' });
        return true;
      }
      result = await rag.ingestion.ingestTicket(ticket);
    } else {
      json(res, 400, { error: 'Provide repo, commitText, documents, or ticketId to ingest.' });
      return true;
    }

    await pool.query(
      'insert into ingestion_log (type, source, status, payload) values ($1,$2,$3,$4)',
      [
        result.type || 'rag',
        result.source || body.repo || body.metadata?.source || 'rag',
        'success',
        JSON.stringify({ ...result, token: undefined }),
      ]
    );
    json(res, 201, { result });
    return true;
  }

  if (pathname === '/api/rag/search' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await rag.retrieval.searchSimilar({
      text: body.text || body.bugReport || '',
      codeSnippet: body.codeSnippet || '',
      metadata: body.metadata || {},
      topK: body.topK || 8,
      filters: body.filters || {},
    });
    json(res, 200, result);
    return true;
  }

  if (pathname === '/api/rag/analyze' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await rag.analyze({
      text: body.text || body.bugReport || '',
      codeSnippet: body.codeSnippet || '',
      metadata: body.metadata || {},
      topK: body.topK || 8,
      filters: body.filters || {},
    });
    json(res, 200, result);
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/rag\/similar\/(\d+)$/);
  if (detailMatch && req.method === 'GET') {
    const document = await rag.store.getDocument(Number(detailMatch[1]));
    if (!document) {
      json(res, 404, { error: 'RAG document not found' });
      return true;
    }
    const relatedChunks = await rag.store.getSourceDetails(document.sourceKey);
    json(res, 200, { document, relatedChunks });
    return true;
  }

  if (pathname === '/api/rag/status' && req.method === 'GET') {
    json(res, 200, {
      documents: await rag.store.count(),
      embeddingProvider: rag.embeddingService.hasOpenAI() ? 'openai' : 'local',
      generationProvider: process.env.OPENAI_API_KEY ? 'openai' : 'local',
    });
    return true;
  }

  return false;
}

async function handleAux(req, res, pathname) {
  const user = pathname.startsWith('/api/') ? await requireUser(req, res) : null;
  if (pathname === '/api/stats' && req.method === 'GET' && user) {
    const visible = "(t.visibility = 'public' or t.created_by = $1)";
    const [counts, sources] = await Promise.all([
      pool.query(
        `select
           count(*)::int total,
           count(*) filter (where t.status = 'open')::int open,
           count(*) filter (where t.status = 'confirmed')::int confirmed,
           count(*) filter (where t.status = 'duplicated')::int duplicated,
           count(*) filter (where t.status = 'resolved')::int resolved,
           count(*) filter (where t.priority = 'critical')::int critical,
           count(*) filter (where t.priority = 'high')::int high,
           count(*) filter (where t.priority = 'medium')::int medium,
           count(*) filter (where t.priority = 'low')::int low
         from tickets t
         where ${visible}`,
        [user.id]
      ),
      pool.query(
        `select t.source, count(*)::int count
         from tickets t
         where ${visible}
         group by t.source`,
        [user.id]
      ),
    ]);
    const row = counts.rows[0] || {};
    const bySource = {};
    sources.rows.forEach(r => { bySource[r.source] = r.count; });
    json(res, 200, { stats: {
      total: row.total || 0,
      open: row.open || 0,
      inProgress: 0,
      confirmed: row.confirmed || 0,
      duplicated: row.duplicated || 0,
      resolved: row.resolved || 0,
      critical: row.critical || 0,
      high: row.high || 0,
      medium: row.medium || 0,
      low: row.low || 0,
      bySource,
    } });
    return true;
  }
  if (pathname === '/api/ingestion-log' && user) {
    if (req.method === 'GET') {
      const { rows } = await pool.query('select * from ingestion_log order by created_at desc limit 100');
      json(res, 200, { log: rows.map(r => ({ ...r.payload, timestamp: r.created_at })) });
      return true;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      await pool.query('insert into ingestion_log (type, source, status, payload) values ($1,$2,$3,$4)', [body.type || 'manual', body.source || '', body.status || 'success', body]);
      json(res, 201, { ok: true });
      return true;
    }
  }
  return false;
}

function serveStatic(req, res) {
  const parsedPath = decodeURIComponent(req.url.split('?')[0]);
  const relative = parsedPath === '/' ? 'index.html' : parsedPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relative);
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) send(res, 404, 'Not found');
    else send(res, 200, data, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
  });
}

async function initDb() {
  await pool.query(`
    create extension if not exists pgcrypto;
    create sequence if not exists ticket_counter start 1;
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      username text not null unique,
      password_hash text not null,
      name text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists tickets (
      id text primary key,
      title text not null,
      description text not null default '',
      status text not null default 'open',
      visibility text not null default 'private',
      priority text not null default 'medium',
      language text not null default 'unknown',
      error_type text not null default '',
      tags text[] not null default '{}',
      code_snippet_before text not null default '',
      code_snippet_after text not null default '',
      code_snippet_diff text not null default '',
      solution text not null default '',
      suggested_fix text not null default '',
      suggested_fixes jsonb not null default '[]',
      category text not null default '',
      log_content text not null default '',
      severity text not null default 'medium',
      confidence numeric,
      similarity_links jsonb not null default '[]',
      metadata jsonb not null default '{}',
      source_key text unique,
      finding_fingerprint text unique,
      duplicate_of text,
      source text not null default 'manual',
      source_url text,
      created_by uuid references users(id),
      resolved_by uuid references users(id),
      created_at timestamptz not null default now(),
      resolved_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create table if not exists solution_requests (
      id bigserial primary key,
      ticket_id text not null references tickets(id) on delete cascade,
      requester_id uuid not null references users(id),
      proposed_code text not null default '',
      proposed_diff text not null default '',
      explanation text not null default '',
      status text not null default 'pending',
      created_at timestamptz not null default now(),
      decided_at timestamptz
    );
    create table if not exists ingestion_log (
      id bigserial primary key,
      type text not null,
      source text not null,
      status text not null,
      payload jsonb not null default '{}',
      created_at timestamptz not null default now()
    );
    create index if not exists idx_tickets_created_by on tickets(created_by);
    create index if not exists idx_tickets_visibility on tickets(visibility);
    create index if not exists idx_tickets_status on tickets(status);
    create index if not exists idx_tickets_priority on tickets(priority);
    create index if not exists idx_tickets_source on tickets(source);
    create index if not exists idx_solution_requests_ticket_status on solution_requests(ticket_id, status);
  `);
  await rag.store.ensureSchema();
  await syncTicketCounter();
}

async function seedStandardTickets() {
  const { rows } = await pool.query("select count(*)::int as count from tickets where source in ('manual','github')");
  if (rows[0].count > 0) return;

  const seedFile = fs.readFileSync(path.join(ROOT, 'js', 'seed.js'), 'utf8');
  const script = `${seedFile}; return SEED_DATA;`;
  const seedData = Function(script)();
  const passwordHash = await bcrypt.hash('password123', 10);
  const { rows: userRows } = await pool.query(
    `insert into users (username, password_hash, name)
     values ('admin', $1, 'Admin User')
     on conflict (username) do update set username = excluded.username
     returning id, username, name, created_at`,
    [passwordHash]
  );
  const systemUser = toUser(userRows[0]);
  let maxNumericId = 0;
  for (const ticket of seedData) {
    await insertTicket({ ...ticket, visibility: 'public', createdById: systemUser.id, resolvedById: ticket.status === 'resolved' ? systemUser.id : null }, systemUser);
    const n = Number(String(ticket.id || '').match(/^BUG-(\d+)$/)?.[1] || 0);
    maxNumericId = Math.max(maxNumericId, n);
  }
  await pool.query("select setval('ticket_counter', $1, true)", [Math.max(maxNumericId, seedData.length, 1)]);
}

async function migrateLegacyStorage() {
  const { rows } = await pool.query('select count(*)::int as count from tickets');
  if (rows[0].count > 0) return;

  const storagePath = path.join(ROOT, 'data', 'storage.json');
  if (!fs.existsSync(storagePath)) return;

  let legacyTickets = [];
  try {
    const storage = JSON.parse(fs.readFileSync(storagePath, 'utf8') || '{}');
    legacyTickets = JSON.parse(storage.btai_tickets || '[]');
  } catch {
    legacyTickets = [];
  }
  if (!legacyTickets.length) return;

  const passwordHash = await bcrypt.hash('password123', 10);
  const { rows: userRows } = await pool.query(
    `insert into users (username, password_hash, name)
     values ('admin', $1, 'Admin User')
     on conflict (username) do update set username = excluded.username
     returning id, username, name, created_at`,
    [passwordHash]
  );
  const systemUser = toUser(userRows[0]);
  let maxNumericId = 0;
  for (const ticket of legacyTickets) {
    const n = Number(String(ticket.id || '').match(/^BUG-(\d+)$/)?.[1] || 0);
    maxNumericId = Math.max(maxNumericId, n);
    await insertTicket({
      ...ticket,
      status: ticket.status === 'in_progress' ? 'open' : ticket.status,
      visibility: ticket.visibility || 'public',
      createdById: ticket.createdById || systemUser.id,
      resolvedById: ticket.resolvedById || (ticket.status === 'resolved' ? systemUser.id : null),
    }, systemUser).catch(err => {
      if (err.code !== '23505') throw err;
    });
  }
  await pool.query("select setval('ticket_counter', $1, true)", [Math.max(maxNumericId, legacyTickets.length, 1)]);
}

async function seedGitHubFirst100() {
  if (process.env.SEED_GITHUB === 'false') return;
  const repos = ['django/django', 'nodejs/node', 'openjdk/jdk'];
  const { rows } = await pool.query("select id from users where username = 'admin'");
  const user = { id: rows[0]?.id };
  for (const repo of repos) {
    const existing = await pool.query('select count(*)::int as count from tickets where metadata->>\'githubRepo\' = $1', [repo]);
    if (existing.rows[0].count >= 100) continue;
    try {
      const api = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`;
      const response = await fetch(api, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BugRelayAI' } });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const issues = await response.json();
      for (const issue of issues.filter(i => !i.pull_request).slice(0, 100)) {
        const body = issue.body || '';
        const codeBlock = body.match(/```(?:\w*)\n([\s\S]*?)```/);
        await insertTicket({
          title: `[${repo}] ${issue.title}`.substring(0, 120),
          description: body.substring(0, 1500) || `GitHub issue #${issue.number} from ${repo}`,
          status: issue.state === 'closed' ? 'resolved' : 'open',
          visibility: 'public',
          priority: 'medium',
          language: 'unknown',
          tags: [repo.split('/')[1], 'github'],
          codeSnippetBefore: codeBlock?.[1]?.trim() || '',
          codeSnippetAfter: '',
          codeSnippetDiff: '',
          solution: issue.state === 'closed' ? 'See linked PR / commit for fix.' : '',
          source: 'github',
          sourceUrl: issue.html_url,
          sourceKey: `github:${repo}:issue:${issue.id}`,
          metadata: { githubRepo: repo, githubIssueId: issue.id, githubIssueNumber: issue.number },
          createdAt: issue.created_at,
          resolvedAt: issue.closed_at,
          createdById: user.id,
          resolvedById: issue.state === 'closed' ? user.id : null,
        }, user).catch(err => {
          if (err.code !== '23505') throw err;
        });
      }
      await pool.query('insert into ingestion_log (type, source, status, payload) values ($1,$2,$3,$4)', ['github', repo, 'success', { type: 'github', source: repo, count: issues.length, status: 'success' }]);
    } catch (err) {
      await pool.query('insert into ingestion_log (type, source, status, payload) values ($1,$2,$3,$4)', ['github', repo, 'interrupted', { type: 'github', source: repo, count: 0, status: 'interrupted', error: err.message }]);
    }
  }
}

let readyPromise;

function ready() {
  if (!readyPromise) {
    readyPromise = initDb()
      .then(migrateLegacyStorage)
      .then(seedStandardTickets)
      .then(seedGitHubFirst100);
  }
  return readyPromise;
}

async function handleRequest(req, res) {
  try {
    await ready();
    const pathname = decodeURIComponent(req.url.split('?')[0]);
    if (await handleAuth(req, res, pathname)) return;
    if (await handleTickets(req, res, pathname)) return;
    if (await handleSolutionRequests(req, res, pathname)) return;
    if (await handleRag(req, res, pathname)) return;
    if (await handleAux(req, res, pathname)) return;
    if (pathname.startsWith('/api/')) {
      json(res, 404, { error: 'API route not found' });
      return;
    }
    serveStatic(req, res);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  ready()
    .then(() => server.listen(PORT, HOST, () => {
    console.log(`BugRelayAI running at http://${HOST}:${PORT}/`);
    }))
    .catch(err => {
      console.error('Startup failed:', err);
      process.exit(1);
    });
}

module.exports = handleRequest;
