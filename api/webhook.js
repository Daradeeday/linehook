// api/webhook.js  –  LINE → Apps Script forwarder
// v4: await GAS ก่อนตอบ LINE (fix Vercel Hobby plan terminate issue)

import crypto from "crypto";

const GAS_TIMEOUT_MS = 8000; // ต้องตอบ LINE ภายใน 10s รวม overhead

function verifyLineSignature(bodyText, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const hash = crypto
    .createHmac("SHA256", channelSecret)
    .update(bodyText)
    .digest("base64");
  return hash === signature;
}

export default async function handler(req, res) {
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

  // LINE verify ping → ตอบ 200 ทันที
  if (!body || !Array.isArray(body.events) || body.events.length === 0) {
    return res.status(200).send("OK");
  }

  // await GAS ก่อน แล้วค่อยตอบ LINE
  // Vercel Hobby plan terminate หลัง res.send() ทำให้ fire-and-forget ไม่ทำงาน
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GAS_TIMEOUT_MS);

  try {
    await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "X-Source":      "vercel-line-forwarder",
        "X-Event-Count": String(body.events.length),
      },
      body:   bodyText,
      signal: controller.signal,
    });
    console.log("[webhook] GAS forwarded OK events=" + body.events.length);
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("[webhook] GAS slow (>8s) but continuing");
    } else {
      console.error("[webhook] Forward error:", err.message);
    }
  } finally {
    clearTimeout(timer);
  }

  // ตอบ LINE หลัง GAS เสร็จ (หรือ timeout)
  return res.status(200).send("OK");
}
