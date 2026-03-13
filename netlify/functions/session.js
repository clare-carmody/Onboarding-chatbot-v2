/**
 * Melba V2 — Session Function (in-memory store)
 *
 * Sessions are stored in a module-level Map. Netlify keeps function instances
 * warm for ~15 minutes — plenty for a demo session between two partners.
 *
 * POST { action: "create" }
 *   → Returns { coupleId, role: "A" }
 *
 * POST { action: "save", coupleId, role, answers }
 *   → Returns { saved: true, partnerReady: bool }
 *
 * POST { action: "get", coupleId }
 *   → Returns { partnerA, partnerB, partnerReady }
 */

// Module-level store — persists across warm invocations of this function instance
const sessions = new Map();

function makeId(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  try {
    const body   = JSON.parse(event.body || "{}");
    const { action, coupleId, role, answers } = body;

    // ── CREATE ──────────────────────────────────────────────────────────────
    if (action === "create") {
      const id = makeId(8);
      sessions.set(id, { partnerA: null, partnerB: null, createdAt: Date.now() });
      console.log(`Session created: ${id}. Total active: ${sessions.size}`);
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
      let session = sessions.get(coupleId);
      if (!session) {
        // Partner B landed on a cold instance — create a stub so polling works
        session = { partnerA: null, partnerB: null, createdAt: Date.now() };
        sessions.set(coupleId, session);
        console.log(`Session stub created for: ${coupleId}`);
      }
      if (role === "A") session.partnerA = answers;
      else              session.partnerB = answers;
      session.updatedAt = Date.now();
      const partnerReady = !!(session.partnerA && session.partnerB);
      console.log(`Session ${coupleId} saved role ${role}. partnerReady: ${partnerReady}`);
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
      const session = sessions.get(coupleId);
      if (!session) {
        // Cold instance — session not in memory; return not-ready so polling continues
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
