const GITHUB_REPO = 'krelltunez/day-planner';
const CACHE_KEY = 'dayglance-version-check';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour cache to avoid redundant API calls within check intervals

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (nb > na) return 1;
    if (nb < na) return -1;
  }
  return 0;
}

export async function checkForUpdate(currentVersion) {
  // Check cache first (invalidate if app version changed, e.g. after upgrade)
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cached && cached.version === currentVersion && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }
  } catch {}

  try {
    // Try GitHub Releases first
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);

    let latestVersion, releaseUrl, releaseNotes;

    if (res.ok) {
      const data = await res.json();
      if (!data.tag_name) return { updateAvailable: false };
      latestVersion = data.tag_name.replace(/^v/, '');
      releaseUrl = data.html_url;
      releaseNotes = data.body || '';
    } else if (res.status === 404) {
      // No releases — fall back to tags
      const tagsRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=1`);
      if (!tagsRes.ok) return { updateAvailable: false };
      const tags = await tagsRes.json();
      if (!tags.length || !tags[0]?.name) return { updateAvailable: false };
      latestVersion = tags[0].name.replace(/^v/, '');
      releaseUrl = `https://github.com/${GITHUB_REPO}/releases`;
      releaseNotes = '';
    } else {
      return { updateAvailable: false };
    }

    const updateAvailable = compareVersions(currentVersion, latestVersion) > 0;
    const result = { updateAvailable, latestVersion, releaseUrl, releaseNotes };

    // Cache the result
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), version: currentVersion, result }));
    } catch {}

    return result;
  } catch {
    // Network error — fail silently
    return { updateAvailable: false };
  }
}
