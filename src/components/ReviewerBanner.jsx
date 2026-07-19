import React from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * Shown whenever the app is unlocked via the reviewer bypass code (App Store
 * Review Guideline 2.1 / Play Console app-access). It gives App Review — and
 * anyone testing — a persistent, one-tap way to leave reviewer mode and return
 * to the paywall, so the in-app purchases are always reachable again.
 *
 * Without it, a reviewer who entered the code to get past the hard gate had no
 * way back to the purchase screen (the launch paywall is the only place the
 * IAPs are surfaced), which produced a Guideline 2.1(b) "we cannot locate the
 * In-App Purchases" rejection. This banner is rendered only for the reviewer
 * unlock (`isReviewerUnlocked`), never for genuine purchasers.
 */
export default function ReviewerBanner({ darkMode, onExit }) {
  return (
    <div
      role="status"
      className={`fixed top-0 inset-x-0 z-[10000] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-xs ${
        darkMode
          ? 'bg-amber-500/15 text-amber-200 border-b border-amber-500/30'
          : 'bg-amber-100 text-amber-900 border-b border-amber-300'
      }`}
    >
      <span className="flex items-center gap-1.5 font-medium">
        <ShieldCheck size={14} className="flex-shrink-0" />
        Reviewer access active — the app is unlocked without a purchase.
      </span>
      <button
        onClick={onExit}
        className={`rounded-full px-3 py-1 font-semibold transition-colors ${
          darkMode
            ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
            : 'bg-amber-600 text-white hover:bg-amber-700'
        }`}
      >
        Exit &amp; view plans
      </button>
    </div>
  );
}
