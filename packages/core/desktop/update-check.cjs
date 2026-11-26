const repository = 'MichalDakowicz/matro';
const releaseEndpoint = `https://api.github.com/repos/${repository}/releases/latest`;
const versionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-z0-9-]+(?:\.[a-z0-9-]+)*)?(?:\+[a-z0-9-]+(?:\.[a-z0-9-]+)*)?$/i;
const parseVersion = value => typeof value === 'string' && versionPattern.exec(value);

function isNewerRelease(tag, currentVersion) {
  const release = parseVersion(tag), installed = parseVersion(currentVersion);
  if (!release || !installed || release[4]) return false;
  for (let index = 1; index <= 3; index++) {
    const difference = BigInt(release[index]) - BigInt(installed[index]);
    if (difference) return difference > 0n;
  }
  return Boolean(installed[4]);
}

async function findUpdate(currentVersion, fetchRelease, signal) {
  const response = await fetchRelease(releaseEndpoint, {
    headers: { Accept: 'application/vnd.github+json' },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
  const release = await response.json(), tag = release?.tag_name;
  if (release?.draft || release?.prerelease || !isNewerRelease(tag, currentVersion)) return null;
  return {
    version: tag.replace(/^v/i, ''),
    url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`
  };
}

module.exports = { isNewerRelease, findUpdate };
