const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwoSIH7EUyeZlbe4gF8hJHTBHZHtJn2XSifXJTCnrwOSORFdw4DtQ6ziPRsc0-3hKVb/exec';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed.' });
  }

  try {
    let payload = req.body;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) {}
    }
    if (payload && typeof payload.payload === 'string') {
      try { payload = JSON.parse(payload.payload); } catch (_) {}
    }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid consultation payload.' });
    }

    const upstream = await fetch(APPS_SCRIPT_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
      redirect: 'follow'
    });

    const text = await upstream.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (_) {
      return res.status(502).json({
        success: false,
        message: 'Hindi valid JSON ang response ng Apps Script. Tiyaking naka-deploy ang latest doPost(e) version.',
        upstreamStatus: upstream.status
      });
    }

    return res.status(upstream.ok ? 200 : 502).json(result);
  } catch (error) {
    console.error('Vercel consultation proxy error:', error);
    return res.status(502).json({ success: false, message: 'Hindi maabot ang consultation service.' });
  }
}
