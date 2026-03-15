// api/ea.js  –  EA → Apps Script forwarder
// v2: timeout, input validation, structured error logging

const EA_FORWARD_TIMEOUT_MS = 25000; // GAS cold start อาจนาน ~10-20s

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_WEB_APP_URL;
  if (!appsScriptUrl) {
    console.error("[ea] Missing APPS_SCRIPT_WEB_APP_URL");
    return res.status(500).json({ ok: false, error: "Server misconfiguration" });
  }

  // Parse body
  let bodyText, parsedBody;
  try {
    bodyText    = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    parsedBody  = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }

  // Fast validation – ไม่ส่ง payload ที่รู้ว่า GAS จะ reject อยู่แล้ว
  const event = parsedBody?.event;
  if (!event || !["trade_opened", "trade_closed"].includes(event)) {
    return res.status(400).json({ ok: false, error: "Invalid or missing event field" });
  }
  if (!parsedBody?.ticket) {
    return res.status(400).json({ ok: false, error: "Missing ticket field" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EA_FORWARD_TIMEOUT_MS);

  try {
    const gasRes = await fetch(appsScriptUrl, {
      method:  "POST",
      headers: {
        "Content-Type":    "application/json",
        "X-Source":        "vercel-ea-forwarder",
        "X-Ticket":        String(parsedBody.ticket),
        "X-Event":         event,
      },
      body:   bodyText,
      signal: controller.signal,
    });

    const text = await gasRes.text();

    // ส่ง status ของ GAS กลับไปให้ EA ด้วย (EA ใช้ code ตัดสิน retry)
    return res.status(gasRes.status).send(text || '{"ok":true}');

  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[ea] GAS timeout after", EA_FORWARD_TIMEOUT_MS, "ms ticket=", parsedBody.ticket);
      return res.status(504).json({ ok: false, error: "GAS timeout" });
    }
    console.error("[ea] Forward error:", err.message, "ticket=", parsedBody.ticket);
    return res.status(502).json({ ok: false, error: "Forward failed" });
  } finally {
    clearTimeout(timer);
  }
}
