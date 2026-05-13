const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
// In hosting providers like Render, use a persistent disk and point DATA_DIR there (e.g. /var/data).
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const ENV_FILE = path.join(ROOT, '.env');
const env = loadEnv(ENV_FILE);

// Render provides PORT via env var and expects binding on 0.0.0.0.
const HOST = env.HOST || process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || env.PORT || 3000);
const ADMIN_USERNAME = env.ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
const SESSION_COOKIE = 'bodia_session';
const SESSION_DURATION_MS = 1000 * 60 * 60 * 12;
const sessions = new Map();
const ALLOWED_CORS_ORIGINS = (
  env.CORS_ORIGINS ||
  process.env.CORS_ORIGINS ||
  'https://bodia.app,https://www.bodia.app,https://*.pages.dev'
).split(',').map((item) => item.trim()).filter(Boolean);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

ensureDataFile();

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split(/\r?\n/).reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return acc;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return acc;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    acc[key] = value;
    return acc;
  }, {});
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, '[]', 'utf8');
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_CORS_ORIGINS.some((allowed) => {
    if (allowed === origin) return true;
    if (allowed.includes('*')) {
      const pattern = '^' + allowed.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
      return new RegExp(pattern).test(origin);
    }
    return false;
  });
}

function getCorsHeaders(req) {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}

function getPublicCorsHeaders(req) {
  const origin = req.headers.origin;
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(filePath).pipe(res);
}

function normalizeRequestedPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalizedUrlPath = decoded === '/' ? '/index.html' : decoded;
  const filePath = path.normalize(path.join(ROOT, normalizedUrlPath));
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (_) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function readLeads() {
  try {
    const raw = fs.readFileSync(LEADS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf8');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, piece) => {
    const [key, ...rest] = piece.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_DURATION_MS;
  return { token, ...session };
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return session;
}

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, {
    username: ADMIN_USERNAME,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + SESSION_DURATION_MS
  });
  return token;
}

function buildSessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 12}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSource(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'hero' || raw === 'cta' || raw === 'website') return 'landing';
  return raw;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(value));
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function leadSummary(lead) {
  return {
    id: lead.id,
    email: lead.email,
    source: lead.source,
    status: lead.status,
    observation: lead.observation || '',
    notes: lead.notes || '',
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    ip: lead.ip || '',
    userAgent: lead.userAgent || '',
    tags: Array.isArray(lead.tags) ? lead.tags : []
  };
}

function sortLeads(leads) {
  return leads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function buildStats(leads) {
  return {
    total: leads.length,
    newCount: leads.filter((lead) => lead.status === 'new').length,
    contacted: leads.filter((lead) => lead.status === 'contacted').length,
    qualified: leads.filter((lead) => lead.status === 'qualified').length,
    uniqueSources: new Set(leads.map((lead) => lead.source || 'landing')).size
  };
}

function csvEscape(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

function exportLeadsCsv(leads) {
  const header = ['Email', 'Fecha', 'Fuente', 'Estado', 'Observaciones', 'Notas', 'IP'];
  const rows = leads.map((lead) => [
    lead.email,
    lead.createdAt,
    lead.source,
    lead.status,
    lead.observation,
    lead.notes,
    lead.ip
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function exportLeadsExcel(leads) {
  const rows = leads.map((lead) => [
    lead.email,
    lead.createdAt,
    lead.source || 'sitio web',
    lead.status,
    lead.observation || '',
    lead.notes || '',
    lead.ip || ''
  ]);

  const headerCells = ['Correo', 'Fecha', 'Fuente', 'Estado', 'Observaciones', 'Notas', 'IP']
    .map((value) => `<Cell ss:StyleID="header"><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`)
    .join('');

  const bodyRows = rows.map((row) => {
    const cells = row
      .map((value) => `<Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`)
      .join('');
    return `<Row>${cells}</Row>`;
  }).join('');

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders/>
   <Font ss:FontName="Inter" x:Family="Swiss" ss:Size="11" ss:Color="#0F172A"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="header">
   <Font ss:FontName="Inter" x:Family="Swiss" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1D4ED8" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Leads">
  <Table>
   <Column ss:Width="210"/>
   <Column ss:Width="150"/>
   <Column ss:Width="110"/>
   <Column ss:Width="110"/>
   <Column ss:Width="220"/>
   <Column ss:Width="220"/>
   <Column ss:Width="120"/>
   <Row>${headerCells}</Row>
   ${bodyRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

async function handleApi(req, res, url) {
  const isPublicLeadRoute = url.pathname === '/api/leads';
  const corsHeaders = isPublicLeadRoute ? getPublicCorsHeaders(req) : getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/leads') {
    try {
      const body = await readRequestBody(req);
      const email = normalizeEmail(body.email);
      const source = normalizeSource(body.source || 'website');

      if (!isValidEmail(email)) {
        sendJson(res, 400, { error: 'Invalid email' }, corsHeaders);
        return;
      }

      const leads = readLeads();
      const now = new Date().toISOString();
      const existing = leads.find((lead) => lead.email === email);

      if (existing) {
        existing.updatedAt = now;
        existing.source = source;
        writeLeads(sortLeads(leads));
        sendJson(res, 200, { ok: true, duplicate: true }, corsHeaders);
        return;
      }

      leads.push({
        id: crypto.randomUUID(),
        email,
        source,
        status: 'new',
        observation: '',
        notes: '',
        createdAt: now,
        updatedAt: now,
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'] || '',
        tags: ['waitlist']
      });

      writeLeads(sortLeads(leads));
      sendJson(res, 201, { ok: true }, corsHeaders);
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Bad request' }, corsHeaders);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    if (!ADMIN_PASSWORD) {
      sendJson(res, 500, { error: 'Falta configurar ADMIN_PASSWORD en .env' });
      return;
    }
    try {
      const body = await readRequestBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');

      if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        sendJson(res, 401, { error: 'Credenciales incorrectas.' });
        return;
      }

      const token = createSession();
      sendJson(res, 200, { ok: true, user: { username: ADMIN_USERNAME } }, {
        'Set-Cookie': buildSessionCookie(token)
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Bad request' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    const session = getSession(req);
    if (session) sessions.delete(session.token);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/session') {
    const session = getSession(req);
    if (!session) {
      sendJson(res, 401, { authenticated: false });
      return;
    }
    sendJson(res, 200, { authenticated: true, user: { username: session.username } });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/leads') {
    if (!requireAuth(req, res)) return;
    const leads = sortLeads(readLeads()).map(leadSummary);
    sendJson(res, 200, { leads, stats: buildStats(leads) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/leads/export') {
    if (!requireAuth(req, res)) return;
    const csv = exportLeadsCsv(sortLeads(readLeads()));
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bodia-leads.csv"'
    });
    res.end(csv);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/leads/export-excel') {
    if (!requireAuth(req, res)) return;
    const xls = exportLeadsExcel(sortLeads(readLeads()));
    res.writeHead(200, {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bodia-leads.xls"'
    });
    res.end(xls);
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/leads/')) {
    if (!requireAuth(req, res)) return;
    try {
      const id = url.pathname.split('/').pop();
      const body = await readRequestBody(req);
      const leads = readLeads();
      const lead = leads.find((item) => item.id === id);
      if (!lead) {
        sendJson(res, 404, { error: 'Lead no encontrado.' });
        return;
      }

      const allowedStatuses = new Set(['new', 'contacted', 'qualified']);
      const nextStatus = String(body.status || '');
      if (allowedStatuses.has(nextStatus)) {
        lead.status = nextStatus;
      }
      lead.observation = String(body.observation || '').trim();
      lead.notes = String(body.notes || '').trim();
      lead.updatedAt = new Date().toISOString();

      writeLeads(sortLeads(leads));
      sendJson(res, 200, { ok: true, lead: leadSummary(lead) });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Bad request' });
    }
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/leads/')) {
    if (!requireAuth(req, res)) return;
    const id = url.pathname.split('/').pop();
    const leads = readLeads();
    const nextLeads = leads.filter((lead) => lead.id !== id);

    if (nextLeads.length === leads.length) {
      sendJson(res, 404, { error: 'Lead no encontrado.' });
      return;
    }

    writeLeads(sortLeads(nextLeads));
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    let routePath = url.pathname;
    if (routePath === '/admin') routePath = '/admin.html';
    if (routePath === '/backoffice') routePath = '/backoffice.html';

    const filePath = normalizeRequestedPath(routePath);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      sendText(res, 404, 'Not found');
      return;
    }

    sendFile(res, filePath);
  } catch (_) {
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Bodia backend running on http://${HOST}:${PORT}`);
});
