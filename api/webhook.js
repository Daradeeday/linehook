import crypto from "crypto";

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

  const bodyText =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  const signature = req.headers["x-line-signature"];
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const appsScriptUrl = process.env.APPS_SCRIPT_WEB_APP_URL;

  // ตรวจ signature ก่อน
  if (!verifyLineSignature(bodyText, signature, channelSecret)) {
    return res.status(401).send("Invalid signature");
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (err) {
    return res.status(400).send("Invalid JSON");
  }

  // กรณี verify webhook / ไม่มี events -> ตอบ 200 ทันที
  if (!body || !Array.isArray(body.events) || body.events.length === 0) {
    return res.status(200).send("OK");
  }

  // ตั้ง timeout ให้การส่งต่อไป Apps Script
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Source": "vercel-line-forwarder"
      },
      body: bodyText,
      signal: controller.signal
    });
  } catch (err) {
    console.error("Forward to Apps Script failed:", err);
    // ถึงส่งต่อไม่สำเร็จ ก็ยังตอบ 200 ให้ LINE
  } finally {
    clearTimeout(timeout);
  }

  return res.status(200).send("OK");
}
