const FONT = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
const ORANGE = "#f97316";
const W = 144;
const H = 144;
const SW = 200;
const SH = 100;

interface KeyOpts {
  value: string;
  sub?: string;
  label?: string;
  barColor?: string;
  dim?: boolean;
  strikethrough?: boolean;
}

export function renderKey(opts: KeyOpts): string {
  const { value, sub = "", label = "dayGLANCE", barColor = ORANGE, dim = false, strikethrough = false } = opts;
  const valueOpacity = dim ? "0.4" : "1";
  const subOpacity = dim ? "0.25" : "0.55";
  const valueY = sub ? "78" : "88";
  const fs = fontSize(value);
  // Approximate half-width: ~0.55× font-size per char for bold sans-serif, capped at key margin
  const strikeHalfW = Math.min((value.length * fs * 0.55) / 2, 62);
  const strikeY = parseInt(valueY) - Math.round(fs * 0.33);
  const strikeW = Math.max(3, fs * 0.1);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#111"/>
  <rect width="${W}" height="5" fill="${barColor}"/>
  <text x="72" y="22" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.38" text-anchor="middle" letter-spacing="0.5">day<tspan font-style="italic">GLANCE</tspan></text>
  <text x="72" y="${valueY}" font-family="${FONT}" font-size="${fs}" fill="white" fill-opacity="${valueOpacity}" text-anchor="middle" font-weight="700">${escape(value)}</text>
  ${strikethrough ? `<line x1="${72 - strikeHalfW}" y1="${strikeY}" x2="${72 + strikeHalfW}" y2="${strikeY}" stroke="white" stroke-opacity="${valueOpacity}" stroke-width="${strikeW}"/>` : ""}
  ${sub ? `<text x="72" y="108" font-family="${FONT}" font-size="18" fill="white" fill-opacity="${subOpacity}" text-anchor="middle">${escape(sub)}</text>` : ""}
</svg>`;

  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

/** Renders a 200×100 landscape SVG for the Stream Deck+ touch strip pixmap item. */
export function renderStrip(opts: KeyOpts): string {
  const { value, sub = "", barColor = ORANGE, dim = false, strikethrough = false } = opts;
  const valueOpacity = dim ? "0.4" : "1";
  const subOpacity = dim ? "0.25" : "0.55";
  const fs = stripFontSize(value);
  const valueY = sub ? "52" : "60";
  const strikeTextW = Math.min(value.length * fs * 0.6, 180);
  const strikeY = parseInt(valueY) - Math.round(fs * 0.33);
  const strikeW = Math.max(3, fs * 0.1);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}">
  <rect width="${SW}" height="${SH}" fill="#111"/>
  <rect width="${SW}" height="4" fill="${barColor}"/>
  <text x="${SW - 8}" y="18" font-family="${FONT}" font-size="11" fill="white" fill-opacity="0.3" text-anchor="end">day<tspan font-style="italic">GLANCE</tspan></text>
  <text x="12" y="${valueY}" font-family="${FONT}" font-size="${fs}" fill="white" fill-opacity="${valueOpacity}" font-weight="700">${escape(value)}</text>
  ${strikethrough ? `<line x1="12" y1="${strikeY}" x2="${12 + strikeTextW}" y2="${strikeY}" stroke="white" stroke-opacity="${valueOpacity}" stroke-width="${strikeW}"/>` : ""}
  ${sub ? `<text x="12" y="80" font-family="${FONT}" font-size="18" fill="white" fill-opacity="${subOpacity}">${escape(sub)}</text>` : ""}
</svg>`;

  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

function stripFontSize(text: string): number {
  if (text.length <= 4) return 42;
  if (text.length <= 7) return 34;
  if (text.length <= 12) return 28;
  return 22;
}

function fontSize(text: string): number {
  if (text.length <= 4) return 44;
  if (text.length <= 7) return 34;
  if (text.length <= 12) return 24;
  return 18;
}

// ── Pomodoro per-slot rendering ───────────────────────────────────────────
// Each encoder slot (column 0–3) represents one Pomodoro work+break cycle.
// Place the Focus action on all 4 encoder slots; each auto-detects its index.

function focusSlotState(
  slotIndex: number,
  phase: string,
  cycleCount: number,
): "completed" | "activeWork" | "activeBreak" | "pending" {
  const completedInSet = cycleCount % 4;

  if (phase === "work") {
    if (slotIndex < completedInSet) return "completed";
    if (slotIndex === completedInSet) return "activeWork";
    return "pending";
  }

  // Break phase: cycleCount already incremented after work finished.
  // The break belongs to the cycle whose work just ended (one slot back).
  const breakSlot = completedInSet === 0 ? 3 : completedInSet - 1;
  if (slotIndex < breakSlot) return "completed";
  if (slotIndex === breakSlot) return "activeBreak";
  return "pending";
}

/** 200×100 touch strip for one Pomodoro cycle slot. */
export function renderFocusSlot(
  slotIndex: number,
  phase: string,
  secondsRemaining: number,
  cycleCount: number,
): string {
  const state = focusSlotState(slotIndex, phase, cycleCount);
  const m = Math.floor(secondsRemaining / 60);
  const s = secondsRemaining % 60;
  const timeStr = `${m}:${s.toString().padStart(2, "0")}`;
  const isLong = phase === "longBreak";
  const cx = SW / 2;

  let body: string;
  if (state === "completed") {
    body = `<rect width="${SW}" height="${SH}" fill="#180a0a"/>
  <circle cx="${cx}" cy="48" r="30" fill="#dc2626"/>
  <rect x="${cx - 3}" y="14" width="5" height="12" fill="#16a34a" rx="2"/>
  <path d="M${cx - 3} 23 Q${cx - 14} 12 ${cx - 8} 7 Q${cx - 1} 19 ${cx - 3} 23Z" fill="#16a34a"/>`;
  } else if (state === "activeWork") {
    body = `<rect width="${SW}" height="${SH}" fill="#1c0e00"/>
  <rect width="${SW}" height="5" fill="#f97316"/>
  <text x="${cx}" y="56" font-family="${FONT}" font-size="38" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${timeStr}</text>
  <text x="${cx}" y="80" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.4" text-anchor="middle">work · cycle ${slotIndex + 1}</text>`;
  } else if (state === "activeBreak") {
    body = `<rect width="${SW}" height="${SH}" fill="#0a180c"/>
  <rect width="${SW}" height="5" fill="#22c55e"/>
  <text x="${cx}" y="56" font-family="${FONT}" font-size="38" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${timeStr}</text>
  <text x="${cx}" y="80" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.4" text-anchor="middle">${isLong ? "long break" : "break"} · cycle ${slotIndex + 1}</text>`;
  } else {
    body = `<rect width="${SW}" height="${SH}" fill="#111"/>
  <circle cx="${cx}" cy="52" r="28" fill="none" stroke="#2a2a2a" stroke-width="2"/>
  <text x="${cx}" y="62" font-family="${FONT}" font-size="30" fill="#2a2a2a" text-anchor="middle" font-weight="700">${slotIndex + 1}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}">
  ${body}
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

/** 144×144 key image for one Pomodoro cycle slot. */
export function renderFocusSlotKey(
  slotIndex: number,
  phase: string,
  secondsRemaining: number,
  cycleCount: number,
): string {
  const state = focusSlotState(slotIndex, phase, cycleCount);
  const m = Math.floor(secondsRemaining / 60);
  const s = secondsRemaining % 60;
  const timeStr = `${m}:${s.toString().padStart(2, "0")}`;
  const isLong = phase === "longBreak";
  const header = `<text x="72" y="22" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.38" text-anchor="middle" letter-spacing="0.5">day<tspan font-style="italic">GLANCE</tspan></text>`;

  let bg = "#111";
  let body: string;
  if (state === "completed") {
    bg = "#180a0a";
    body = `<circle cx="72" cy="84" r="40" fill="#dc2626"/>
  <rect x="69" y="38" width="5" height="15" fill="#16a34a" rx="2"/>
  <path d="M69 50 Q56 36 63 29 Q71 45 69 50Z" fill="#16a34a"/>`;
  } else if (state === "activeWork") {
    body = `<rect width="${W}" height="5" fill="#f97316"/>
  <text x="72" y="82" font-family="${FONT}" font-size="30" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${timeStr}</text>
  <text x="72" y="108" font-family="${FONT}" font-size="15" fill="white" fill-opacity="0.45" text-anchor="middle">work</text>`;
  } else if (state === "activeBreak") {
    body = `<rect width="${W}" height="5" fill="#22c55e"/>
  <text x="72" y="82" font-family="${FONT}" font-size="30" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${timeStr}</text>
  <text x="72" y="108" font-family="${FONT}" font-size="15" fill="white" fill-opacity="0.45" text-anchor="middle">${isLong ? "long break" : "break"}</text>`;
  } else {
    body = `<circle cx="72" cy="82" r="36" fill="none" stroke="#252525" stroke-width="2"/>
  <text x="72" y="93" font-family="${FONT}" font-size="34" fill="#2a2a2a" text-anchor="middle" font-weight="700">${slotIndex + 1}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  ${header}
  ${body}
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

// ── Focus setup-screen rendering ──────────────────────────────────────────
// Shown on encoder slots when the session start screen is open.
// Slot 0 = work, slot 1 = short break, slot 2 = long break, slot 3 = pending ring.

/** 200×100 touch strip for the pre-session setup state. */
export function renderFocusSetupSlot(
  slotIndex: number,
  workMinutes: number,
  breakMinutes: number,
  longBreakMinutes: number,
  adjusting: "work" | "break" | "longBreak",
): string {
  const cx = SW / 2;
  let body: string;

  if (slotIndex === 0) {
    const sel = adjusting === "work";
    body = sel
      ? `<rect width="${SW}" height="${SH}" fill="#1c0e00"/>
  <rect width="${SW}" height="5" fill="#f97316"/>
  <text x="${cx}" y="52" font-family="${FONT}" font-size="38" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${workMinutes}m</text>
  <text x="${cx}" y="76" font-family="${FONT}" font-size="13" fill="#f97316" fill-opacity="0.85" text-anchor="middle">WORK</text>`
      : `<rect width="${SW}" height="${SH}" fill="#0d0d0d"/>
  <text x="${cx}" y="52" font-family="${FONT}" font-size="38" fill="white" fill-opacity="0.2" text-anchor="middle" font-weight="700">${workMinutes}m</text>
  <text x="${cx}" y="76" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.16" text-anchor="middle">work</text>`;
  } else if (slotIndex === 1) {
    const sel = adjusting === "break";
    body = sel
      ? `<rect width="${SW}" height="${SH}" fill="#0a180c"/>
  <rect width="${SW}" height="5" fill="#22c55e"/>
  <text x="${cx}" y="52" font-family="${FONT}" font-size="38" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${breakMinutes}m</text>
  <text x="${cx}" y="76" font-family="${FONT}" font-size="13" fill="#22c55e" fill-opacity="0.85" text-anchor="middle">BREAK</text>`
      : `<rect width="${SW}" height="${SH}" fill="#0d0d0d"/>
  <text x="${cx}" y="52" font-family="${FONT}" font-size="38" fill="white" fill-opacity="0.2" text-anchor="middle" font-weight="700">${breakMinutes}m</text>
  <text x="${cx}" y="76" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.16" text-anchor="middle">break</text>`;
  } else if (slotIndex === 2) {
    const sel = adjusting === "longBreak";
    body = sel
      ? `<rect width="${SW}" height="${SH}" fill="#0a150d"/>
  <rect width="${SW}" height="5" fill="#16a34a"/>
  <text x="${cx}" y="52" font-family="${FONT}" font-size="38" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${longBreakMinutes}m</text>
  <text x="${cx}" y="76" font-family="${FONT}" font-size="13" fill="#16a34a" fill-opacity="0.85" text-anchor="middle">LONG BREAK</text>`
      : `<rect width="${SW}" height="${SH}" fill="#0d0d0d"/>
  <text x="${cx}" y="52" font-family="${FONT}" font-size="38" fill="white" fill-opacity="0.2" text-anchor="middle" font-weight="700">${longBreakMinutes}m</text>
  <text x="${cx}" y="76" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.16" text-anchor="middle">long break</text>`;
  } else {
    body = `<rect width="${SW}" height="${SH}" fill="#111"/>
  <circle cx="${cx}" cy="52" r="28" fill="none" stroke="#2a2a2a" stroke-width="2"/>
  <text x="${cx}" y="62" font-family="${FONT}" font-size="30" fill="#2a2a2a" text-anchor="middle" font-weight="700">${slotIndex + 1}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}">
  ${body}
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

// ── Goal arc rendering ────────────────────────────────────────────────────

interface GoalOpts {
  title: string;
  progress: number;   // 0-100
  colorHex: string;
  overview?: boolean;
  goalCount?: number;
  avgProgress?: number;
}

function arcPath(cx: number, cy: number, r: number, pct: number): string {
  if (pct <= 0) return "";
  if (pct >= 100) {
    // Full circle via two half-arcs (single A command breaks at 360°)
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r}`;
  }
  const angle = (pct / 100) * 360;
  const rad = (angle - 90) * (Math.PI / 180);
  const ex = (cx + r * Math.cos(rad)).toFixed(2);
  const ey = (cy + r * Math.sin(rad)).toFixed(2);
  const largeArc = angle > 180 ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
}

export function renderGoalKey(opts: GoalOpts): string {
  const { title, progress, colorHex, overview = false, goalCount = 0, avgProgress = 0 } = opts;
  const pct = overview ? avgProgress : Math.round(progress);
  const arc = arcPath(72, 74, 44, pct);
  const arcEl = arc
    ? `<path d="${arc}" fill="none" stroke="${colorHex}" stroke-width="7" stroke-linecap="round"/>`
    : "";

  let centerEl: string;
  let bottomEl: string;
  if (overview) {
    centerEl = `
  <text x="72" y="71" font-family="${FONT}" font-size="22" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${goalCount}</text>
  <text x="72" y="88" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.45" text-anchor="middle">goals</text>`;
    bottomEl = `<text x="72" y="134" font-family="${FONT}" font-size="12" fill="white" fill-opacity="0.45" text-anchor="middle">${pct}% avg</text>`;
  } else {
    centerEl = `<text x="72" y="82" font-family="${FONT}" font-size="26" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${pct}%</text>`;
    bottomEl = `<text x="72" y="134" font-family="${FONT}" font-size="12" fill="white" fill-opacity="0.55" text-anchor="middle">${escape(truncate(title, 15))}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#111"/>
  <rect width="${W}" height="5" fill="${colorHex}"/>
  <text x="72" y="22" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.38" text-anchor="middle" letter-spacing="0.5">day<tspan font-style="italic">GLANCE</tspan></text>
  <circle cx="72" cy="74" r="44" fill="none" stroke="#2a2a2a" stroke-width="7"/>
  ${arcEl}${centerEl}
  ${bottomEl}
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

export function renderGoalStrip(opts: GoalOpts): string {
  const { title, progress, colorHex, overview = false, goalCount = 0, avgProgress = 0 } = opts;
  const pct = overview ? avgProgress : Math.round(progress);
  const arc = arcPath(48, 50, 30, pct);
  const arcEl = arc
    ? `<path d="${arc}" fill="none" stroke="${colorHex}" stroke-width="6" stroke-linecap="round"/>`
    : "";
  const mainText = overview ? `${goalCount} Goal${goalCount !== 1 ? "s" : ""}` : escape(truncate(title, 11));
  const subText = overview ? `${pct}% avg` : `${pct}% done`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}">
  <rect width="${SW}" height="${SH}" fill="#111"/>
  <rect width="${SW}" height="4" fill="${colorHex}"/>
  <text x="${SW - 8}" y="18" font-family="${FONT}" font-size="11" fill="white" fill-opacity="0.3" text-anchor="end">day<tspan font-style="italic">GLANCE</tspan></text>
  <circle cx="48" cy="50" r="30" fill="none" stroke="#2a2a2a" stroke-width="6"/>
  ${arcEl}
  <text x="48" y="55" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.9" text-anchor="middle" font-weight="700">${pct}%</text>
  <text x="92" y="44" font-family="${FONT}" font-size="20" fill="white" fill-opacity="0.9" font-weight="700">${mainText}</text>
  <text x="92" y="68" font-family="${FONT}" font-size="15" fill="white" fill-opacity="0.5">${subText}</text>
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

// ── Project arc rendering ─────────────────────────────────────────────────

interface ProjectOpts {
  title: string;
  progress: number;
  colorHex: string;
  goalTitle?: string | null;
  overview?: boolean;
  projectCount?: number;
  avgProgress?: number;
}

export function renderProjectKey(opts: ProjectOpts): string {
  const { title, progress, colorHex, goalTitle, overview = false, projectCount = 0, avgProgress = 0 } = opts;
  const pct = overview ? avgProgress : Math.round(progress);
  const arc = arcPath(72, 72, 42, pct);
  const arcEl = arc
    ? `<path d="${arc}" fill="none" stroke="${colorHex}" stroke-width="7" stroke-linecap="round"/>`
    : "";

  let centerEl: string;
  let bottomEl: string;
  if (overview) {
    centerEl = `
  <text x="72" y="69" font-family="${FONT}" font-size="22" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${projectCount}</text>
  <text x="72" y="86" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.45" text-anchor="middle">projects</text>`;
    bottomEl = `<text x="72" y="130" font-family="${FONT}" font-size="12" fill="white" fill-opacity="0.45" text-anchor="middle">${pct}% avg</text>`;
  } else {
    const goalLine = goalTitle
      ? `<text x="72" y="91" font-family="${FONT}" font-size="10" fill="white" fill-opacity="0.38" text-anchor="middle" font-style="italic">↳ ${escape(truncate(goalTitle, 14))}</text>`
      : "";
    centerEl = `<text x="72" y="78" font-family="${FONT}" font-size="22" fill="white" fill-opacity="0.95" text-anchor="middle" font-weight="700">${pct}%</text>${goalLine}`;
    bottomEl = `<text x="72" y="130" font-family="${FONT}" font-size="12" fill="white" fill-opacity="0.55" text-anchor="middle">${escape(truncate(title, 15))}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#111"/>
  <rect width="${W}" height="5" fill="${colorHex}"/>
  <text x="72" y="22" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.38" text-anchor="middle" letter-spacing="0.5">day<tspan font-style="italic">GLANCE</tspan></text>
  <circle cx="72" cy="72" r="42" fill="none" stroke="#2a2a2a" stroke-width="7"/>
  ${arcEl}${centerEl}
  ${bottomEl}
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

export function renderProjectStrip(opts: ProjectOpts): string {
  const { title, progress, colorHex, goalTitle, overview = false, projectCount = 0, avgProgress = 0 } = opts;
  const pct = overview ? avgProgress : Math.round(progress);
  const arc = arcPath(48, 50, 30, pct);
  const arcEl = arc
    ? `<path d="${arc}" fill="none" stroke="${colorHex}" stroke-width="6" stroke-linecap="round"/>`
    : "";
  const mainText = overview ? `${projectCount} Project${projectCount !== 1 ? "s" : ""}` : escape(truncate(title, 11));
  const subText = overview
    ? `${pct}% avg`
    : goalTitle ? `↳ ${escape(truncate(goalTitle, 12))}` : `${pct}% done`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}">
  <rect width="${SW}" height="${SH}" fill="#111"/>
  <rect width="${SW}" height="4" fill="${colorHex}"/>
  <text x="${SW - 8}" y="18" font-family="${FONT}" font-size="11" fill="white" fill-opacity="0.3" text-anchor="end">day<tspan font-style="italic">GLANCE</tspan></text>
  <circle cx="48" cy="50" r="30" fill="none" stroke="#2a2a2a" stroke-width="6"/>
  ${arcEl}
  <text x="48" y="55" font-family="${FONT}" font-size="13" fill="white" fill-opacity="0.9" text-anchor="middle" font-weight="700">${pct}%</text>
  <text x="92" y="44" font-family="${FONT}" font-size="20" fill="white" fill-opacity="0.9" font-weight="700">${mainText}</text>
  <text x="92" y="68" font-family="${FONT}" font-size="14" fill="white" fill-opacity="0.45">${subText}</text>
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

// ── HyperGLANCE idle-slot rendering ──────────────────────────────────────

/** 144×144 key for a scheduled (idle) hyperGLANCE session slot.
 *  pulseOn adds a glowing border to indicate the session is reachable. */
export function renderHGIdleKey(session: { title: string; colorHex: string; startTime: string } | null, pulseOn = false): string {
  if (!session) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#111"/>
  <rect width="${W}" height="5" fill="#4f46e5" fill-opacity="0.3"/>
  <text x="72" y="80" font-family="${FONT}" font-size="16" fill="white" fill-opacity="0.15" text-anchor="middle" font-weight="700">hyper<tspan font-style="italic">GLANCE</tspan></text>
</svg>`;
    return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  }
  const { title, colorHex, startTime } = session;
  const label = truncate(title, 11);
  const border = pulseOn ? `<rect x="2" y="2" width="140" height="140" rx="3" fill="none" stroke="${escape(colorHex)}" stroke-width="2.5" stroke-opacity="0.9"/>` : "";
  const textOpacity = pulseOn ? "1" : "0.75";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#111"/>
  <rect width="${W}" height="5" fill="${escape(colorHex)}"/>
  ${border}
  <text x="72" y="22" font-family="${FONT}" font-size="11" fill="${escape(colorHex)}" fill-opacity="0.7" text-anchor="middle" letter-spacing="0.5">hyper<tspan font-style="italic">GLANCE</tspan></text>
  <text x="72" y="74" font-family="${FONT}" font-size="22" fill="white" fill-opacity="${textOpacity}" text-anchor="middle" font-weight="700">${escape(label)}</text>
  <text x="72" y="103" font-family="${FONT}" font-size="18" fill="white" fill-opacity="0.5" text-anchor="middle">${escape(startTime)}</text>
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

/** 200×100 touch-strip slot for a scheduled (idle) hyperGLANCE session.
 *  pulseOn brightens the text to indicate the session is reachable. */
export function renderHGIdleSlot(session: { title: string; colorHex: string; startTime: string } | null, pulseOn = false): string {
  if (!session) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}">
  <rect width="${SW}" height="${SH}" fill="#111"/>
  <rect width="${SW}" height="4" fill="#4f46e5" fill-opacity="0.2"/>
  <text x="12" y="60" font-family="${FONT}" font-size="16" fill="white" fill-opacity="0.1" font-weight="700">hyper<tspan font-style="italic">GLANCE</tspan></text>
</svg>`;
    return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  }
  const { title, colorHex, startTime } = session;
  const label = truncate(title, 14);
  const titleOpacity = pulseOn ? "1" : "0.8";
  const timeOpacity = pulseOn ? "0.8" : "0.5";
  const accentOpacity = pulseOn ? "1" : "0.6";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}">
  <rect width="${SW}" height="${SH}" fill="#111"/>
  <rect width="${SW}" height="4" fill="${escape(colorHex)}" fill-opacity="${accentOpacity}"/>
  <rect width="4" height="${SH}" fill="${escape(colorHex)}" fill-opacity="${accentOpacity}"/>
  <text x="16" y="46" font-family="${FONT}" font-size="22" fill="white" fill-opacity="${titleOpacity}" font-weight="700">${escape(label)}</text>
  <text x="16" y="74" font-family="${FONT}" font-size="18" fill="white" fill-opacity="${timeOpacity}">${escape(startTime)}</text>
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

/** Strips #hashtags and [[wikilinks]] from a task title. */
export function stripTags(s: string): string {
  return s
    .replace(/\[\[[^\]]+\]\]/g, "")
    .replace(/#\w[\w\d_]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
