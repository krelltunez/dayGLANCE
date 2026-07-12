// Reviewer bypass for Play Console App access policy and Apple App Review Guideline 2.1.
// Derives a time-based unlock code used only for store App Review access.
//
// The derivation logic (HMAC-SHA256 over the current UTC month, 6 bytes hex)
// lives in @glance-apps/billing; this module binds dayGLANCE's app-specific
// secret so previously published codes and stored unlock hashes keep working.

import {
  deriveReviewerCode as deriveWithSecret,
  sha256Hex,
} from '@glance-apps/billing';

const _S = 'dg-r3v13w-' + 'a9f2c741b8e05d3';

/** dayGLANCE's reviewer secret — passed into the billing engine config. */
export const REVIEWER_SECRET = _S;

export async function deriveReviewerCode() {
  return deriveWithSecret(_S);
}

export { sha256Hex };
