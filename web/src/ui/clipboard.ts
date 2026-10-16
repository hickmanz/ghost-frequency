/**
 * Copy text to the clipboard. Uses the async Clipboard API when available, otherwise falls back to
 * selecting a temporary textarea and running execCommand('copy'). Resolves to success.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea fallback
  }
  return copyViaTextarea(text);
}

function copyViaTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '-9999px';
  ta.style.opacity = '0';
  const prevFocus = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
    prevFocus?.focus?.();
  }
}
