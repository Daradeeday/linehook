import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyLineSignature(rawBodyBuffer, signatureHeader, channelSecret) {
  if (!signatureHeader || !channelSecret) return false;

  const expectedSignature = crypto
    .createHmac('SHA256', channelSecret)
    .update(rawBodyBuffer)
    .digest('base64');

  return timingSafeEqual(expectedSignature, signatureHeader);
}

async function forwardToAppsScript(rawBodyText, requestId) {
  const appsScriptUrl = process.env.APPS_SCRIPT_WEB_APP_URL;

  if (!appsScriptUrl) {
    throw new Error('Missing APPS_SCRIPT_WEB_APP_URL environment variable');
  }

  const response = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-By': 'vercel-line-webhook',
      'X-Request-Id': requestId,
    },
    body: rawBodyText,
  });

  const responseText = await response.text().catch(() => '');

  return {
    ok: response.ok,
    status: response.status,
    body: responseText,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const requestId = crypto.randomUUID();

  try {
    const rawBodyBuffer = await readRawBody(req);
    const rawBodyText = rawBodyBuffer.toString('utf8');

    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    const signatureHeader = req.headers['x-line-signature'];

    if (!channelSecret) {
      console.error('[webhook] Missing LINE_CHANNEL_SECRET', { requestId });
      return res.status(500).json({ ok: false, error: 'Server misconfiguration' });
    }

    const isSignatureValid = verifyLineSignature(
      rawBodyBuffer,
      signatureHeader,
      channelSecret,
    );

    if (!isSignatureValid) {
      console.warn('[webhook] Invalid LINE signature', { requestId });
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }

    let parsedBody;
    try {
      parsedBody = rawBodyText ? JSON.parse(rawBodyText) : {};
    } catch (parseError) {
      console.error('[webhook] Invalid JSON body', { requestId, message: parseError.message });
      return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
    }

    const forwardResult = await forwardToAppsScript(rawBodyText, requestId);

    if (!forwardResult.ok) {
      console.error('[webhook] Apps Script forwarding failed', {
        requestId,
        status: forwardResult.status,
        body: forwardResult.body,
      });

      return res.status(502).json({
        ok: false,
        error: 'Failed to forward webhook to Apps Script',
        requestId,
      });
    }

    return res.status(200).json({
      ok: true,
      requestId,
      receivedEvents: Array.isArray(parsedBody.events) ? parsedBody.events.length : 0,
    });
  } catch (error) {
    console.error('[webhook] Unhandled error', {
      requestId,
      message: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      requestId,
    });
  }
}
