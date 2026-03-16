// api/webhook.js  –  LINE → Apps Script forwarder
// v3: รองรับ GET (LINE verify), timeout 55s, fire-and-forget

import crypto from "crypto";

const LINE_FORWARD_TIMEOUT_MS = 55000;

function verifyLineSignature(bodyText, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const hash = crypto
    .createHmac("SHA256", channelSecret)
    .update(bodyText)
    .digest("base64");
  return hash === signature;
}

export default async function handler(req, res) {
  // LINE ส่ง GET มาตอน Verify webhook → ตอบ 200 ทันที
  if (req.method === "GET") {
    return res.status(200).send("OK");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const bodyText =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});

  const signature     = req.headers["x-line-signature"];
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const appsScriptUrl = process.env.APPS_SCRIPT_WEB_APP_URL;

  if (!appsScriptUrl) {
    console.error("[webhook] Missing APPS_SCRIPT_WEB_APP_URL");
    return res.status(500).send("Server misconfiguration");
  }

  if (!verifyLineSignature(bodyText, signature, channelSecret)) {
    console.warn("[webhook] Invalid signature");
    return res.status(401).send("Invalid signature");
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  // LINE verify ping (events ว่าง) → ตอบ 200 ทันที
  if (!body || !Array.isArray(body.events) || body.events.length === 0) {
    return res.status(200).send("OK");
  }

  // ตอบ 200 ให้ LINE ก่อนเสมอ แล้วค่อย forward GAS
  res.status(200).send("OK");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINE_FORWARD_TIMEOUT_MS);

  try {
    const gasRes = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "X-Source":      "vercel-line-forwarder",
        "X-Event-Count": String(body.events.length),
      },
      body:   bodyText,
      signal: controller.signal,
    });

    if (!gasRes.ok) {
      const errText = await gasRes.text().catch(() => "");
      console.error("[webhook] GAS returned", gasRes.status, errText.slice(0, 200));
    } else {
      console.log("[webhook] GAS forwarded OK events=" + body.events.length);
    }

  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[webhook] GAS timeout after", LINE_FORWARD_TIMEOUT_MS, "ms");
    } else {
      console.error("[webhook] Forward error:", err.message);
    }
  } finally {
    clearTimeout(timer);
  }
}
