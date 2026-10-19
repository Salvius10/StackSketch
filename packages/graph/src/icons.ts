// Icons for the diagram style: a flat tile in the component's category colour
// with a white line glyph for parts of the system, or the glyph alone in dark ink
// for users and outside services. Hand-drawn SVG on a 64×64 grid, so every client
// and every export renders the same pixels.

import { type ElementMeta, inferNodeType, parseNodeLabel } from "./derive";
import { type NodeType, isNodeType } from "./schema";

export const ICON_SIZE = 64;
export const INK = "#232F3E";

const COMPUTE = "#ED7100";
const NETWORK = "#8C4FFF";
const DATA = "#C925D1";
const STORAGE = "#7AA116";
const INTEGRATION = "#E7157B";
const SECURITY = "#DD344C";
const ML = "#01A88D";
const NEUTRAL = "#545B64";

function gearPath(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  const step = (Math.PI * 2) / teeth;
  const at = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const parts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    parts.push(at(inner, a - 0.3 * step), at(outer, a - 0.16 * step), at(outer, a + 0.16 * step), at(inner, a + 0.3 * step));
  }
  return `M${parts.join("L")}Z`;
}

/** Lines from radius `inner` to `outer`, like the spokes of a ship's wheel. */
function spokes(cx: number, cy: number, inner: number, outer: number, count: number): string {
  const at = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return Array.from({ length: count }, (_, i) => {
    const a = (i * Math.PI * 2) / count - Math.PI / 2;
    return `M${at(inner, a)}L${at(outer, a)}`;
  }).join("");
}

/** Line art drawn with a round 2.4px stroke; `currentColor` fills small dots. */
const GLYPHS = {
  service: `<path d="M32 13 49 22.5v19L32 51 15 41.5v-19Z"/><path d="M15 22.5 32 32l17-9.5M32 32v19"/>`,
  worker: `<path d="${gearPath(32, 32, 18, 13.5, 8)}"/><circle cx="32" cy="32" r="5"/>`,
  function: `<path d="M20 15h6.5L44 49h4.5"/><path d="M33.5 29 21 49"/>`,
  scheduler: `<circle cx="32" cy="32" r="17"/><path d="M32 21v11l7.5 4.5"/>`,
  gateway: `<path d="M23 21 13 32l10 11M41 21l10 11-10 11M35.5 17l-7 30"/>`,
  loadbalancer: `<circle cx="17" cy="32" r="5"/><circle cx="47" cy="17" r="4"/><circle cx="47" cy="32" r="4"/><circle cx="47" cy="47" r="4"/><path d="M22 32h21M21.5 29.5 43 19M21.5 34.5 43 45"/>`,
  cdn: `<circle cx="32" cy="32" r="17"/><ellipse cx="32" cy="32" rx="7.5" ry="17"/><path d="M15 32h34M17.5 23.5h29M17.5 40.5h29"/>`,
  database: `<ellipse cx="32" cy="19" rx="15" ry="5.5"/><path d="M17 19v26c0 3 6.7 5.5 15 5.5s15-2.5 15-5.5V19"/><path d="M17 28c0 3 6.7 5.5 15 5.5s15-2.5 15-5.5M17 36.5c0 3 6.7 5.5 15 5.5s15-2.5 15-5.5"/>`,
  cache: `<path d="M35.5 12 20 35h11l-3 17 16-24H33Z"/>`,
  bucket: `<ellipse cx="32" cy="19" rx="16" ry="5"/><path d="m16 19 4 27c.5 3 5.5 5 12 5s11.5-2 12-5l4-27"/>`,
  queue: `<rect x="16" y="23" width="32" height="18" rx="2.5"/><path d="M26.5 23v18M37.5 23v18M6 32h7M10 29l3 3-3 3M51 32h7M55 29l3 3-3 3"/>`,
  stream: `<path d="M14 22c4-5 8-5 12 0s8 5 12 0 8-5 12 0M14 32c4-5 8-5 12 0s8 5 12 0 8-5 12 0M14 42c4-5 8-5 12 0s8 5 12 0 8-5 12 0"/>`,
  topic: `<circle cx="19" cy="32" r="4.5"/><path d="M28.5 24.5a10.5 10.5 0 0 1 0 15M35 19a18 18 0 0 1 0 26M41.5 13.5a25 25 0 0 1 0 37"/>`,
  search: `<circle cx="28" cy="28" r="11.5"/><path d="M36.5 36.5 49 49"/>`,
  auth: `<path d="M32 12.5 47 18.5V30c0 10-6.5 17.5-15 21.5-8.5-4-15-11.5-15-21.5V18.5Z"/><path d="m25 31.5 5 5 9.5-10"/>`,
  ml: `<path d="M30 13c1.2 9.5 5 13.8 15 15-10 1.2-13.8 5.5-15 15-1.2-9.5-5-13.8-15-15 10-1.2 13.8-5.5 15-15Z"/><path d="M45 40.5c.5 3.5 2 5 5.5 5.5-3.5.5-5 2-5.5 5.5-.5-3.5-2-5-5.5-5.5 3.5-.5 5-2 5.5-5.5Z"/>`,
  analytics: `<path d="M14 49h36"/><rect x="18" y="33" width="7" height="12" rx="1"/><rect x="28.5" y="25" width="7" height="20" rx="1"/><rect x="39" y="16" width="7" height="29" rx="1"/>`,
  payment: `<rect x="12" y="18" width="40" height="28" rx="3.5"/><path d="M12 26h40M18 38h9"/>`,
  email: `<rect x="12" y="18" width="40" height="28" rx="3"/><path d="m13 20 19 14 19-14"/>`,
  monitoring: `<path d="M10 33h10l5-12 7 23 5.5-14 3 3H54"/>`,
  cloud: `<path d="M21 46h23.5a8.5 8.5 0 0 0 1.2-16.9A12.5 12.5 0 0 0 21.6 26 9.5 9.5 0 0 0 21 46Z"/>`,
  users: `<circle cx="25" cy="23" r="6.5"/><path d="M12.5 48c0-8 5.5-13 12.5-13s12.5 5 12.5 13"/><circle cx="41.5" cy="21" r="5.5"/><path d="M40.5 32c6.5 0 11 4.5 11 11.5"/>`,
  user: `<circle cx="32" cy="22.5" r="8"/><path d="M17 50c0-9.5 6.5-15.5 15-15.5S47 40.5 47 50"/>`,
  browser: `<rect x="11" y="15" width="42" height="34" rx="3.5"/><path d="M11 24h42"/><circle cx="16.5" cy="19.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="21" cy="19.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="25.5" cy="19.5" r="1.3" fill="currentColor" stroke="none"/>`,
  mobile: `<rect x="21" y="11" width="22" height="42" rx="4"/><path d="M28.5 16h7"/><circle cx="32" cy="47" r="1.6" fill="currentColor" stroke="none"/>`,
  tablet: `<rect x="15" y="10" width="34" height="44" rx="4"/><circle cx="32" cy="48" r="1.6" fill="currentColor" stroke="none"/>`,
  desktop: `<rect x="11" y="13" width="42" height="29" rx="2.5"/><path d="M26 51h12M32 42v9"/>`,
  laptop: `<rect x="17" y="16" width="30" height="22" rx="2"/><path d="M10 46h44l-4-8H14Z"/>`,
  server: `<rect x="13" y="13" width="38" height="15" rx="2"/><rect x="13" y="36" width="38" height="15" rx="2"/><circle cx="20" cy="20.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="43.5" r="1.6" fill="currentColor" stroke="none"/><path d="M30 20.5h14M30 43.5h14"/>`,
  chip: `<rect x="20" y="20" width="24" height="24" rx="2"/><rect x="27" y="27" width="10" height="10" rx="1"/><path d="M26 13v7M32 13v7M38 13v7M26 44v7M32 44v7M38 44v7M13 26h7M13 32h7M13 38h7M44 26h7M44 32h7M44 38h7"/>`,
  containers: `<rect x="10" y="35" width="13" height="11" rx="1"/><rect x="25.5" y="35" width="13" height="11" rx="1"/><rect x="41" y="35" width="13" height="11" rx="1"/><rect x="17.5" y="21" width="13" height="11" rx="1"/><rect x="33" y="21" width="13" height="11" rx="1"/>`,
  helm: `<circle cx="32" cy="32" r="16"/><circle cx="32" cy="32" r="4.5"/><path d="${spokes(32, 32, 4.5, 21, 7)}"/>`,
  layers: `<path d="M32 13 52 23 32 33 12 23Z"/><path d="M12 32l20 10 20-10M12 41l20 10 20-10"/>`,
  ingress: `<rect x="30" y="17" width="22" height="30" rx="2"/><path d="M9 32h26M29 26l6 6-6 6"/>`,
  scale: `<rect x="23" y="23" width="18" height="18" rx="2"/><path d="M13 23V13h10M13 13l9 9M51 41v10H41M51 51l-9-9"/>`,
  namespace: `<rect x="12" y="14" width="40" height="36" rx="3" stroke-dasharray="5 4"/><path d="M20 24h12"/>`,
  dns: `<path d="M32 11v42M23 53h18"/><path d="M32 15h14l5 5.5-5 5.5H32Z"/><path d="M32 30H18l-5 5.5 5 5.5h14"/>`,
  router: `<circle cx="32" cy="32" r="18"/><path d="M23 27h17M36 23l4 4-4 4M41 37H24M28 33l-4 4 4 4"/>`,
  switch: `<rect x="9" y="20" width="46" height="24" rx="3"/><path d="M17 28h20M33 25l4 3-4 3M47 36H27M31 33l-4 3 4 3"/>`,
  firewall: `<rect x="12" y="16" width="40" height="32" rx="1.5"/><path d="M12 26.5h40M12 37.5h40M25 16v10.5M39 16v10.5M18.5 26.5v11M32 26.5v11M45.5 26.5v11M25 37.5V48M39 37.5V48"/>`,
  wifi: `<path d="M13 27a27 27 0 0 1 38 0M19.5 34a18 18 0 0 1 25 0M26 41a9 9 0 0 1 12 0"/><circle cx="32" cy="47.5" r="2.2" fill="currentColor" stroke="none"/>`,
  printer: `<path d="M20 26V13h24v13"/><rect x="12" y="26" width="40" height="17" rx="2.5"/><rect x="20" y="37" width="24" height="14"/>`,
  storage: `<rect x="14" y="12" width="36" height="40" rx="3"/><path d="M14 25.5h36M14 38.5h36"/><circle cx="43" cy="19" r="1.6" fill="currentColor" stroke="none"/><circle cx="43" cy="32" r="1.6" fill="currentColor" stroke="none"/><circle cx="43" cy="45" r="1.6" fill="currentColor" stroke="none"/>`,
  disk: `<rect x="11" y="19" width="42" height="26" rx="4"/><path d="M11 36h42"/><circle cx="45" cy="40.5" r="1.6" fill="currentColor" stroke="none"/>`,
  folder: `<path d="M11 19h15l4 5h23v25H11Z"/>`,
  table: `<rect x="12" y="15" width="40" height="34" rx="2"/><path d="M12 25.5h40M12 37h40M25.5 25.5V49M38.5 25.5V49"/>`,
  document: `<path d="M18 11h19l10 10v32H18Z"/><path d="M37 11v10h10M24 30h17M24 37h17M24 44h11"/>`,
  key: `<circle cx="22" cy="32" r="8.5"/><path d="M30.5 32H53M46 32v7M52 32v6"/>`,
  lock: `<rect x="16" y="28" width="32" height="23" rx="3"/><path d="M22 28v-6a10 10 0 0 1 20 0v6"/><circle cx="32" cy="39.5" r="2.4" fill="currentColor" stroke="none"/>`,
  workflow: `<rect x="11" y="13" width="15" height="12" rx="2"/><rect x="38" y="26" width="15" height="12" rx="2"/><rect x="11" y="39" width="15" height="12" rx="2"/><path d="M26 19h6v26h-6M32 32h6"/>`,
  bell: `<path d="M20 43V30a12 12 0 0 1 24 0v13l4 4H16Z"/><path d="M28 51a4 4 0 0 0 8 0"/>`,
} as const;

export type Glyph = keyof typeof GLYPHS;
export const GLYPH_NAMES = Object.keys(GLYPHS) as Glyph[];
export const isGlyph = (g: unknown): g is Glyph => typeof g === "string" && Object.prototype.hasOwnProperty.call(GLYPHS, g);

const TILE: Record<Glyph, string> = {
  service: COMPUTE,
  worker: COMPUTE,
  function: COMPUTE,
  scheduler: COMPUTE,
  gateway: NETWORK,
  loadbalancer: NETWORK,
  cdn: NETWORK,
  database: DATA,
  cache: DATA,
  bucket: STORAGE,
  queue: INTEGRATION,
  stream: INTEGRATION,
  topic: INTEGRATION,
  search: NETWORK,
  auth: SECURITY,
  ml: ML,
  analytics: NETWORK,
  payment: NEUTRAL,
  email: INTEGRATION,
  monitoring: INTEGRATION,
  cloud: NEUTRAL,
  users: NEUTRAL,
  user: NEUTRAL,
  browser: NEUTRAL,
  mobile: NEUTRAL,
  tablet: NEUTRAL,
  desktop: NEUTRAL,
  laptop: NEUTRAL,
  server: COMPUTE,
  chip: COMPUTE,
  containers: COMPUTE,
  helm: COMPUTE,
  layers: COMPUTE,
  ingress: NETWORK,
  scale: COMPUTE,
  namespace: NEUTRAL,
  dns: NETWORK,
  router: NETWORK,
  switch: NETWORK,
  firewall: SECURITY,
  wifi: NETWORK,
  printer: NEUTRAL,
  storage: STORAGE,
  disk: STORAGE,
  folder: STORAGE,
  table: DATA,
  document: NEUTRAL,
  key: SECURITY,
  lock: SECURITY,
  workflow: INTEGRATION,
  bell: INTEGRATION,
};

/**
 * How an icon is framed: a coloured tile (AWS style), a white card with the glyph in
 * colour (Google Cloud style), a heptagon (Kubernetes), a circle, or none at all (the
 * glyph in ink, as network diagrams draw devices).
 */
export type IconFrame = "tile" | "card" | "heptagon" | "circle" | "plain";
export const ICON_FRAMES: readonly IconFrame[] = ["tile", "card", "heptagon", "circle", "plain"];

export interface IconSpec {
  glyph: Glyph;
  /** Glyph only, in ink: users, clients and services outside the system. */
  outline: boolean;
  /** The frame's colour, instead of the glyph's category colour. */
  tint?: string;
  frame?: IconFrame;
}

type Rule = [RegExp, Glyph];

const RULES: Record<NodeType, { rules: Rule[]; fallback: Glyph }> = {
  client: {
    rules: [
      [/\b(mobile|ios|android|iphone|phone|tablet)\b/, "mobile"],
      [/\b(web|browser|spa|frontend|front-end|react|next(\.js)?|vue|angular|site|portal|dashboard|admin ui)\b/, "browser"],
      [/\b(user|customer|player|admin|operator|visitor|member|driver|patient|buyer|seller)\b/, "user"],
    ],
    fallback: "users",
  },
  gateway: {
    rules: [
      [/\b(cdn|cloudfront|akamai|fastly|cloudflare|edge)\b/, "cdn"],
      [/\b(load ?balancer|lb|alb|elb|nlb|haproxy|traefik|nginx|envoy|ingress|reverse proxy|proxy)\b/, "loadbalancer"],
    ],
    fallback: "gateway",
  },
  service: {
    rules: [
      [/\b(lambda|functions?|serverless|faas)\b/, "function"],
      [/\b(auth|authn|authz|identity|login|sso|oauth|keycloak|cognito|iam)\b/, "auth"],
      [/\b(search|elastic(search)?|opensearch|solr|algolia|meilisearch|typesense)\b/, "search"],
      [/\b(ml|model|models|inference|llm|ai|recommend\w*|sagemaker|bedrock|openai|claude|gpt|personali[sz]\w*|predict\w*|embedding\w*)\b/, "ml"],
      [/\b(analytics|reporting|reports?|bi|metrics)\b/, "analytics"],
      [/\b(notification\w*|email|mail|sms|push)\b/, "email"],
      [/\b(monitor\w*|observability|logging|tracing|grafana|prometheus|datadog)\b/, "monitoring"],
      [/\b(scheduler|cron)\b/, "scheduler"],
    ],
    fallback: "service",
  },
  worker: {
    rules: [
      [/\b(cron|schedul\w*|timer|periodic|nightly)\b/, "scheduler"],
      [/\b(lambda|functions?|serverless)\b/, "function"],
      [/\b(ml|model|training|inference)\b/, "ml"],
    ],
    fallback: "worker",
  },
  database: {
    rules: [
      [/\b(s3|buckets?|blob|object (store|storage)|gcs|minio|r2|file (store|storage)|files|assets|media)\b/, "bucket"],
      [/\b(warehouse|bigquery|redshift|snowflake|clickhouse|analytics|olap|data ?lake|databricks)\b/, "analytics"],
      [/\b(elastic(search)?|opensearch|search|solr)\b/, "search"],
    ],
    fallback: "database",
  },
  cache: { rules: [], fallback: "cache" },
  queue: {
    rules: [
      [/\b(kafka|kinesis|streams?|event ?hubs?|pulsar|redpanda|firehose)\b/, "stream"],
      [/\b(sns|pub ?\/? ?sub|topics?|eventbridge|event ?bus|fan-?out|broadcast|webhooks?)\b/, "topic"],
    ],
    fallback: "queue",
  },
  external: {
    rules: [
      [/\b(stripe|paypal|payments?|adyen|braintree|billing|square|checkout)\b/, "payment"],
      [/\b(email|ses|sendgrid|mailgun|postmark|twilio|sms|push|notification\w*|slack)\b/, "email"],
      [/\b(auth0|okta|oauth|sso|identity|login|cognito|clerk)\b/, "auth"],
      [/\b(openai|anthropic|claude|gpt|llm|gemini|ai|bedrock|models?)\b/, "ml"],
      [/\b(datadog|sentry|grafana|new ?relic|monitor\w*|pagerduty)\b/, "monitoring"],
      [/\b(s3|gcs|buckets?|blob|storage)\b/, "bucket"],
      [/\b(search|algolia)\b/, "search"],
    ],
    fallback: "cloud",
  },
};

/** The icon for a component, from its type and whatever its name and technology say. */
export function iconFor(node: { type: NodeType; label?: string | null; tech?: string | null }): IconSpec {
  const text = `${node.label ?? ""} ${node.tech ?? ""}`.toLowerCase();
  const { rules, fallback } = RULES[node.type];
  const glyph = rules.find(([re]) => re.test(text))?.[1] ?? fallback;
  return { glyph, outline: node.type === "client" || node.type === "external" };
}

/**
 * The icon a diagram component shows: the one pinned on it (with its colour and
 * frame), or what its type and name call for.
 */
export function iconOf(node: { type?: NodeType | null; label?: string; tech?: string | null; icon?: string; tint?: string; frame?: IconFrame }): IconSpec {
  const type = isNodeType(node.type) ? node.type : "service";
  const glyph = isGlyph(node.icon) ? node.icon : iconFor({ type, label: node.label, tech: node.tech }).glyph;
  const framed = !!node.tint || (!!node.frame && node.frame !== "plain");
  return {
    glyph,
    outline: node.frame === "plain" || (!framed && (type === "client" || type === "external")),
    ...(node.tint ? { tint: node.tint } : {}),
    ...(node.frame && node.frame !== "plain" ? { frame: node.frame } : {}),
  };
}

/**
 * The icon for a component as drawn on the canvas: its explicit metadata first,
 * then what its label says, resolved the same way deriveGraph resolves them.
 */
export function iconForElement(meta: ElementMeta, labelText: string): IconSpec {
  const parsed = parseNodeLabel(labelText);
  const type = isNodeType(meta.type) ? meta.type : inferNodeType(`${parsed.label} ${parsed.tech ?? ""}`).type;
  const tech = meta.tech !== undefined ? meta.tech : parsed.tech;
  return iconFor({ type, label: parsed.label, tech });
}

export function iconId(spec: IconSpec): string {
  return `ss-icon-${spec.glyph}${spec.outline ? "-outline" : ""}`;
}

export function parseIconId(id: string): IconSpec | null {
  const m = /^ss-icon-([a-z]+)(-outline)?$/.exec(id);
  if (!m || !(m[1] in GLYPHS)) return null;
  return { glyph: m[1] as Glyph, outline: !!m[2] };
}

const HEPTAGON = `M${Array.from({ length: 7 }, (_, i) => {
  const a = (i * Math.PI * 2) / 7 - Math.PI / 2;
  return `${(32 + 31 * Math.cos(a)).toFixed(2)} ${(33 + 31 * Math.sin(a)).toFixed(2)}`;
}).join("L")}Z`;

/** A safe colour for an attribute: a hex colour, or the fallback. */
const colour = (c: string | undefined, fallback: string) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback);

export function iconSvg(spec: IconSpec): string {
  const fill = colour(spec.tint, TILE[spec.glyph]);
  let back = "";
  let ink = "#FFFFFF";
  let scale = 1;
  if (spec.outline || spec.frame === "plain") ink = INK;
  else if (spec.frame === "card") {
    back = `<rect x="1" y="1" width="62" height="62" rx="6" fill="#FFFFFF" stroke="#DADCE0" stroke-width="1.5"/>`;
    ink = fill;
  } else if (spec.frame === "heptagon") {
    back = `<path d="${HEPTAGON}" fill="${fill}"/>`;
    scale = 0.78;
  } else if (spec.frame === "circle") {
    back = `<circle cx="32" cy="32" r="31" fill="${fill}"/>`;
    scale = 0.8;
  } else back = `<rect width="64" height="64" rx="5" fill="${fill}"/>`;
  const shrink = scale === 1 ? "" : ` transform="translate(32 32) scale(${scale}) translate(-32 -32)"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${back}` +
    `<g fill="none" stroke="currentColor" color="${ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"${shrink}>` +
    `${GLYPHS[spec.glyph]}</g></svg>`
  );
}

export function iconDataUrl(spec: IconSpec): string {
  return `data:image/svg+xml;base64,${btoa(iconSvg(spec))}`;
}

/** Every icon the canvas can show, for registering them as Excalidraw files up front. */
export function allIcons(): { id: string; spec: IconSpec }[] {
  return GLYPH_NAMES.flatMap((glyph) =>
    [false, true].map((outline) => ({ id: iconId({ glyph, outline }), spec: { glyph, outline } })),
  );
}
