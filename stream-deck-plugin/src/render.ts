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
