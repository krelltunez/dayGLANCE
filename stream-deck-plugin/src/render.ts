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
}

export function renderKey(opts: KeyOpts): string {
  const { value, sub = "", label = "dayGLANCE", barColor = ORANGE, dim = false } = opts;
  const valueColor = dim ? "rgba(255,255,255,0.4)" : "white";
  const subColor = dim ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.55)";
  const valueY = sub ? "78" : "88";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#111"/>
  <rect width="${W}" height="5" fill="${barColor}"/>
  <text x="72" y="22" font-family="${FONT}" font-size="13" fill="rgba(255,255,255,0.38)" text-anchor="middle" letter-spacing="0.5">${escape(label)}</text>
  <text x="72" y="${valueY}" font-family="${FONT}" font-size="${fontSize(value)}" fill="${valueColor}" text-anchor="middle" font-weight="700">${escape(value)}</text>
  ${sub ? `<text x="72" y="108" font-family="${FONT}" font-size="18" fill="${subColor}" text-anchor="middle">${escape(sub)}</text>` : ""}
</svg>`;

  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

function fontSize(text: string): number {
  if (text.length <= 4) return 44;
  if (text.length <= 7) return 34;
  if (text.length <= 12) return 24;
  return 18;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
