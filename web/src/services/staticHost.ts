/** True on GitHub Pages and similar static demo hosts (no Python backend). */
export function isStaticDemoHost(): boolean {
  if (typeof location === 'undefined') return false;
  const h = location.hostname.toLowerCase();
  return h.endsWith('.github.io') || h.endsWith('.githubpages.io') || h.endsWith('.pages.dev');
}

export function isIOSLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
