export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_WEB_APP_URL;

  if (!appsScriptUrl) {
    return res.status(500).json({ ok: false, error: "Missing APPS_SCRIPT_WEB_APP_URL" });
  }

  try {
    const body =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});

    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body
    });

    const text = await response.text();

    return res.status(200).send(text || '{"ok":true}');
  } catch (err) {
    console.error("EA forward error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}