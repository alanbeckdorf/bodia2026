const SESSION_COOKIE = "bodia_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function text(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  return header.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function getOrigin(request) {
  return request.headers.get("origin") || "";
}

function corsHeaders(request) {
  const origin = getOrigin(request);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signSession(username, password, timestamp) {
  return sha256(`${username}:${timestamp}:${password}`);
}

async function createSessionCookie(env) {
  const username = env.ADMIN_USERNAME || "admin";
  const password = env.ADMIN_PASSWORD || "";
  const timestamp = Date.now();
  const signature = await signSession(username, password, timestamp);
  const raw = `${username}.${timestamp}.${signature}`;
  return `${SESSION_COOKIE}=${encodeURIComponent(raw)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}; Secure`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`;
}

async function isAuthenticated(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;
  const [username, ts, signature] = token.split(".");
  if (!username || !ts || !signature) return false;

  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp)) return false;
  if (Date.now() - timestamp > SESSION_TTL_SECONDS * 1000) return false;

  const expectedUser = env.ADMIN_USERNAME || "admin";
  const expectedPass = env.ADMIN_PASSWORD || "";
  if (!expectedPass || username !== expectedUser) return false;

  const expectedSig = await signSession(username, expectedPass, timestamp);
  return signature === expectedSig;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(value));
}

function normalizeSource(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "hero" || raw === "cta" || raw === "website") return "landing";
  return raw;
}

function mapLeadRow(row) {
  return {
    id: row.id,
    email: row.email,
    source: row.source,
    status: row.status,
    observation: row.observation || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ip: row.ip || "",
    userAgent: row.user_agent || "",
    tags: ["waitlist"],
  };
}

function statsFromLeads(leads) {
  return {
    total: leads.length,
    newCount: leads.filter((lead) => lead.status === "new").length,
    contacted: leads.filter((lead) => lead.status === "contacted").length,
    qualified: leads.filter((lead) => lead.status === "qualified").length,
  };
}

function toCsv(leads) {
  const header = ["Email", "Fecha", "Fuente", "Estado", "Observaciones", "Notas", "IP"];
  const rows = leads.map((lead) => [
    lead.email,
    lead.createdAt,
    lead.source,
    lead.status,
    lead.observation,
    lead.notes,
    lead.ip,
  ]);
  const esc = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;
  const cors = corsHeaders(request);

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (path === "/api/leads" && method === "POST") {
    try {
      const body = await request.json();
      const email = normalizeEmail(body.email);
      const source = normalizeSource(body.source);
      if (!isValidEmail(email)) return json({ error: "Invalid email" }, 400, cors);

      const now = new Date().toISOString();
      const existing = await env.DB.prepare("SELECT id FROM leads WHERE email = ?").bind(email).first();
      if (existing) {
        await env.DB.prepare("UPDATE leads SET source = ?, updated_at = ? WHERE email = ?")
          .bind(source, now, email)
          .run();
        return json({ ok: true, duplicate: true }, 200, cors);
      }

      const id = crypto.randomUUID();
      const ip = request.headers.get("CF-Connecting-IP") || "";
      const ua = request.headers.get("user-agent") || "";
      await env.DB.prepare(
        "INSERT INTO leads (id, email, source, status, observation, notes, created_at, updated_at, ip, user_agent) VALUES (?, ?, ?, 'new', '', '', ?, ?, ?, ?)"
      ).bind(id, email, source, now, now, ip, ua).run();
      return json({ ok: true }, 201, cors);
    } catch (e) {
      return json({ error: "Bad request" }, 400, cors);
    }
  }

  if (path === "/api/admin/login" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const adminUser = env.ADMIN_USERNAME || "admin";
    const adminPass = env.ADMIN_PASSWORD || "";
    if (!adminPass) return json({ error: "ADMIN_PASSWORD no configurado" }, 500, cors);
    if (username !== adminUser || password !== adminPass) return json({ error: "Credenciales incorrectas." }, 401, cors);

    return json(
      { ok: true, user: { username: adminUser } },
      200,
      { ...cors, "Set-Cookie": await createSessionCookie(env) }
    );
  }

  if (path === "/api/admin/logout" && method === "POST") {
    return json({ ok: true }, 200, { ...cors, "Set-Cookie": clearSessionCookie() });
  }

  if (path === "/api/admin/session" && method === "GET") {
    const ok = await isAuthenticated(request, env);
    if (!ok) return json({ authenticated: false }, 401, cors);
    return json({ authenticated: true, user: { username: env.ADMIN_USERNAME || "admin" } }, 200, cors);
  }

  if (path.startsWith("/api/admin/")) {
    const ok = await isAuthenticated(request, env);
    if (!ok) return json({ error: "Unauthorized" }, 401, cors);
  }

  if (path === "/api/admin/leads" && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM leads ORDER BY datetime(created_at) DESC").all();
    const leads = (rows.results || []).map(mapLeadRow);
    return json({ leads, stats: statsFromLeads(leads) }, 200, cors);
  }

  if (path === "/api/admin/leads/export" && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM leads ORDER BY datetime(created_at) DESC").all();
    const leads = (rows.results || []).map(mapLeadRow);
    return new Response(toCsv(leads), {
      status: 200,
      headers: {
        ...cors,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="bodia-leads.csv"',
      },
    });
  }

  if (path.startsWith("/api/admin/leads/") && method === "PATCH") {
    const id = path.split("/").pop();
    const body = await request.json().catch(() => ({}));
    const status = ["new", "contacted", "qualified"].includes(body.status) ? body.status : "new";
    const observation = String(body.observation || "").trim();
    const notes = String(body.notes || "").trim();
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE leads SET status = ?, observation = ?, notes = ?, updated_at = ? WHERE id = ?")
      .bind(status, observation, notes, now, id)
      .run();
    return json({ ok: true }, 200, cors);
  }

  if (path.startsWith("/api/admin/leads/") && method === "DELETE") {
    const id = path.split("/").pop();
    await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id).run();
    return json({ ok: true }, 200, cors);
  }

  return text("Not found", 404, cors);
}

