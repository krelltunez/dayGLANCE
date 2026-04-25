const FONT = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
const ORANGE = "#f97316";
const W = 144;
const H = 144;

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
  const strikeW = Math.max(1.5, fs * 0.07);

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
