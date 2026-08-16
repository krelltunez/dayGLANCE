// Phone-number note detection for the phone action button: a task whose note
// is JUST a phone number gets a dial affordance on platforms that can place
// calls, the phone twin of the link-only-note behavior (isLinkOnlyTask).
//
// DETECTION IS DELIBERATELY STRICT. A false positive turns the notes button
// into a dial button, so the shape must read unambiguously as a phone number:
//  - only digits with the separators people actually type: ( ) . - and
//    spaces, plus one optional leading +
//  - 7 to 15 digits total (7 covers local numbers, 15 is the E.164 maximum)
//  - date-shaped strings are rejected even though they fit the charset:
//    "2026-08-16" and "16.08.2026" are notes about dates, not numbers to
//    dial. Bare digit runs without separators are accepted (an 8-digit
//    local number is more plausible as a note than an undelimited date).
//
// DIALING IS PLATFORM-GATED, mobile only by design: the native Android shell
// hands tel: to the system via ACTION_VIEW (MainActivity.kt
// shouldOverrideUrlLoading), the native iOS shell via decidePolicyFor
// (WebView.swift), and mobile browsers handle tel: natively. Desktop
// deliberately keeps the plain notes behavior: Electron's openExternalSafe
// allowlists only http/https, and a dial button on a machine with no dialer
// is a dead button.

import { isNativeApp } from '../native.js';

const PHONE_CHARSET_RE = /^\+?[0-9()\s.-]+$/;
const DATE_SHAPE_RES = [
  /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/, // 2026-08-16, 2026.8.16
  /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/, // 16-08-2026, 8/16/26
];

/** Whether the text is nothing but one dialable phone number. */
export function isOnlyPhoneNumber(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed || !PHONE_CHARSET_RE.test(trimmed)) return false;
  if (DATE_SHAPE_RES.some((re) => re.test(trimmed))) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/** RFC 3966 tel: URI for a detected number: digits only, keeping a leading +. */
export function phoneTelUrl(text) {
  const trimmed = String(text ?? '').trim();
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${trimmed.replace(/\D/g, '')}`;
}

/**
 * Whether THIS platform can hand a tel: URI to a dialer. Pure core, injected
 * inputs, so the rule is testable; canDialHere() below reads the real
 * environment. iPadOS Safari masquerades as macOS in its default desktop UA,
 * so a non-native iPad may miss the affordance; the native iOS app is
 * detected by flag, not UA, and is unaffected.
 */
export function canDialPhone(isNative, userAgent) {
  if (isNative) return true;
  return /Android|iPhone|iPad|iPod/i.test(userAgent || '');
}

/** Environment wrapper over canDialPhone. */
export function canDialHere() {
  return canDialPhone(isNativeApp(), typeof navigator !== 'undefined' ? navigator.userAgent : '');
}
