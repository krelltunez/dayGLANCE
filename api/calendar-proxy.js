export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/calendar, text/plain, */*',
      },
    });

    const body = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain');
    res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=60');
    res.status(response.status).send(body);
  } catch (err) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({ error: 'Failed to fetch calendar', detail: err.message });
  }
}
