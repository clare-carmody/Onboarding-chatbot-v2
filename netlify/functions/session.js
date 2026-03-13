/**
 * Melba V2 — Session Function
 *
 * Handles the couple session store using Netlify Blobs (no external DB needed).
 *
 * POST /session   { action: "create" }
 *   → Creates a new coupleId, returns { coupleId, role: "A" }
 *
 * POST /session   { action: "save", coupleId, role, answers }
 *   → Saves partner answers. Returns { saved: true, partnerReady: bool }
 *     partnerReady=true means both partners have answered → trigger dual match
 *
 * POST /session   { action: "get", coupleId }
 *   → Returns { partnerA, partnerB, partnerReady }
 *     Used by partner B to poll / confirm both sides are in
 */

const { getStore } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function makeId(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { action, coupleId, role, answers } = body;

    // Netlify Blobs store — scoped to this site, persists across function invocations
    const store = getStore({ name: "melba-sessions", consistency: "strong" });

    // ── CREATE ──────────────────────────────────────────────────────────────
    if (action === "create") {
      const newId = makeId(8);
      const session = { coupleId: newId, partnerA: null, partnerB: null, createdAt: Date.now() };
      await store.setJSON(newId, session);
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ coupleId: newId, role: "A" }),
      };
    }

    // ── SAVE ────────────────────────────────────────────────────────────────
    if (action === "save") {
      if (!coupleId || !role || !answers) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing coupleId, role, or answers" }) };
      }

      let session = await store.get(coupleId, { type: "json" });
      if (!session) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Session not found" }) };
      }

      // Save this partner's answers
      if (role === "A") session.partnerA = answers;
      else session.partnerB = answers;
      session.updatedAt = Date.now();

      await store.setJSON(coupleId, session);

      const partnerReady = !!(session.partnerA && session.partnerB);
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

      const session = await store.get(coupleId, { type: "json" });
      if (!session) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Session not found" }) };
      }

      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerA: session.partnerA,
          partnerB: session.partnerB,
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
