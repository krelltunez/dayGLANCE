// Prints the current month's reviewer bypass code.
//
//   npm run reviewer-code
//
// Reuses deriveReviewerCode() from src/config/reviewerAccess.js so the
// terminal output can never drift from what the app computes. The code
// rotates on the 1st of each month — paste the output into the Play
// Console / App Store Connect App Review notes on that day.
//
// Pass a YYYY-MM argument to preview a specific month (e.g. next month
// before a store update): npm run reviewer-code -- 2026-08

import { deriveReviewerCode } from '../src/config/reviewerAccess.js';

const arg = process.argv[2];

if (arg && !/^\d{4}-\d{2}$/.test(arg)) {
  console.error(`Invalid month "${arg}" — expected YYYY-MM (e.g. 2026-08).`);
  process.exit(1);
}

// deriveReviewerCode() reads the current month internally. To preview a
// different month we temporarily pin the clock via Date.toISOString.
let code;
if (arg) {
  const realToISOString = Date.prototype.toISOString;
  Date.prototype.toISOString = function () {
    return `${arg}-01T00:00:00.000Z`;
  };
  try {
    code = await deriveReviewerCode();
  } finally {
    Date.prototype.toISOString = realToISOString;
  }
} else {
  code = await deriveReviewerCode();
}

const period = arg || new Date().toISOString().slice(0, 7);
console.log(`Reviewer code for ${period}: ${code}`);
