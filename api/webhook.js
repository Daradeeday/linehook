// api/webhook.js  –  LINE → Apps Script forwarder
// v2: fire-and-forget pattern, longer timeout, structured logging

import crypto from "crypto";

const LINE_FORWARD_TIMEOUT_MS = 25000;// LINE ต้องการ response < 10s

function verifyLineSignature(bodyText, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const hash = crypto
    .createHmac("SHA256", channelSecret)
    .update(bodyText)
    .digest("base64");
  return hash === signature;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // ดึง body เป็น string ก่อน verify signature
  const bodyText =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});

  const signature   = req.headers["x-line-signature"];
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const appsScriptUrl = process.env.APPS_SCRIPT_WEB_APP_URL;

  // 1. ตรวจ config
  if (!appsScriptUrl) {
    console.error("[webhook] Missing APPS_SCRIPT_WEB_APP_URL");
    return res.status(500).send("Server misconfiguration");
  }

  // 2. ตรวจ signature
  if (!verifyLineSignature(bodyText, signature, channelSecret)) {
    console.warn("[webhook] Invalid signature");
    return res.status(401).send("Invalid signature");
  }

  // 3. Parse body
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  // 4. LINE verify ping (events array ว่าง) → ตอบ 200 ทันทีเลย
  if (!body || !Array.isArray(body.events) || body.events.length === 0) {
    return res.status(200).send("OK");
  }

  // 5. ส่ง 200 ให้ LINE ก่อน แล้วค่อย forward ไป GAS (fire-and-forget)
  //    LINE ต้องการ response ภายใน 10 วินาที ถ้า GAS ช้าจะ timeout และ LINE retry ซ้ำ
  res.status(200).send("OK");

  // 6. Forward ไป GAS หลังจาก response ส่งแล้ว
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINE_FORWARD_TIMEOUT_MS);

  try {
    const gasRes = await fetch(appsScriptUrl, {
      method:  "POST",
      headers: {
        "Content-Type":    "application/json",
        "X-Source":        "vercel-line-forwarder",
        "X-Event-Count":   String(body.events.length),
      },
      body:   bodyText,
      signal: controller.signal,
    });

    if (!gasRes.ok) {
      const errText = await gasRes.text().catch(() => "");
      console.error("[webhook] GAS returned", gasRes.status, errText.slice(0, 200));
    }

  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[webhook] GAS forward timeout after", LINE_FORWARD_TIMEOUT_MS, "ms");
    } else {
      console.error("[webhook] Forward error:", err.message);
    }
  } finally {
    clearTimeout(timer);
  }
}
