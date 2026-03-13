/**
 * Melba V2 — Session Function (Upstash Redis)
 *
 * Uses Upstash Redis REST API — pure fetch, no SDK, works in any serverless env.
 * Env vars needed in Netlify:
 *   UPSTASH_REDIS_REST_URL   — e.g. https://xxxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN — your rest token
 *
 * Sessions expire after 1 hour (TTL = 3600s).
 *
 * POST { action: "create" }                         → { coupleId, role: "A" }
 * POST { action: "save", coupleId, role, answers }  → { saved: true, partnerReady: bool }
 * POST { action: "get",  coupleId }                 → { partnerA, partnerB, partnerReady }
 */

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL         = 3600; // 1 hour

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Upstash REST helpers ─────────────────────────────────────────────────────

async function redisGet(key) {
  const res  = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const json = await res.json();
  if (!json.result) return null;
  return JSON.parse(json.result);
}

async function redisSet(key, value) {
  const encoded = encodeURIComponent(JSON.stringify(value));
  await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encoded}/ex/${TTL}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
}

function makeId(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  try {
    const { action, coupleId, role, answers } = JSON.parse(event.body || "{}");

    // ── CREATE ──────────────────────────────────────────────────────────────
    if (action === "create") {
      const id      = makeId(8);
      const session = { partnerA: null, partnerB: null, createdAt: Date.now() };
      await redisSet(id, session);
      console.log(`Session created: ${id}`);
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ coupleId: id, role: "A" }),
      };
    }

    // ── SAVE ────────────────────────────────────────────────────────────────
    if (action === "save") {
      if (!coupleId || !role || !answers) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing fields" }) };
      }
      let session = await redisGet(coupleId);
      if (!session) {
        session = { partnerA: null, partnerB: null, createdAt: Date.now() };
      }
      if (role === "A") session.partnerA = answers;
      else              session.partnerB = answers;
      session.updatedAt = Date.now();
      await redisSet(coupleId, session);

      const partnerReady = !!(session.partnerA && session.partnerB);
      console.log(`Saved ${coupleId} role ${role} — partnerReady: ${partnerReady}`);
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ saved: true, partnerReady }),
      };
    }

    // ── GET ─────────────────────────────────────────────────────────────────
    if (action === "get") {
      if (!coupleId) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing coupleId" }) };
      }
      const session = await redisGet(coupleId);
      if (!session) {
        return {
          statusCode: 200,
          headers: { ...CORS, "Content-Type": "application/json" },
          body: JSON.stringify({ partnerA: null, partnerB: null, partnerReady: false }),
        };
      }
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerA:     session.partnerA,
          partnerB:     session.partnerB,
          partnerReady: !!(session.partnerA && session.partnerB),
        }),
      };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Unknown action" }) };

  } catch (err) {
    console.error("Session error:", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
