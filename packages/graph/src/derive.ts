// Canvas -> graph. Pure function of the Excalidraw elements, so every client
// and the sync server derive the same graph from the same drawing.

import {
  type EdgeKind,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type NodeType,
  type Source,
  isEdgeKind,
  isNodeType,
  isSource,
} from "./schema";

/** The subset of an Excalidraw element StackSketch reads. */
export interface CanvasElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  strokeStyle?: string;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  groupIds?: readonly string[];
  boundElements?: readonly { id: string; type: string }[] | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  points?: readonly (readonly [number, number])[];
  index?: string | null;
  customData?: Record<string, unknown> | null;
}

/** What StackSketch stores in an element's customData under this key. */
export const META_KEY = "stacksketch";

export interface NodeMeta {
  role: "node";
  type?: NodeType;
  tech?: string | null;
  replicas?: number | null;
  dlq?: boolean | null;
  source?: Source;
  confidence?: number;
}

export interface EdgeMeta {
  role: "edge";
  kind?: EdgeKind;
  protocol?: string | null;
  endpoint?: string | null;
  retry?: boolean | null;
  timeout_ms?: number | null;
  hot_path?: boolean | null;
  source?: Source;
  confidence?: number;
}

/**
 * Roles beyond node and edge: "label" is the name under an icon component (a text
 * grouped with it); "zone" (a boundary box or its title) and "step" (a numbered
 * flow badge or the list of steps) are annotations the graph ignores.
 */
export type ElementRole = "node" | "edge" | "label" | "zone" | "step";

export type ElementMeta = Partial<Omit<NodeMeta, "role"> & Omit<EdgeMeta, "role">> & { role?: ElementRole };

export const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

/** A component on the canvas: a sketched shape, or an icon StackSketch placed. */
export function isNodeElement(el: CanvasElement): boolean {
  const role = getMeta(el).role;
  if (el.type === "image") return role === "node";
  return SHAPE_TYPES.has(el.type) && (role === undefined || role === "node");
}

export function getMeta(el: CanvasElement): ElementMeta {
  const raw = el.customData?.[META_KEY];
  return raw && typeof raw === "object" ? (raw as ElementMeta) : {};
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || ""
  );
}

// --- node label parsing -------------------------------------------------------

const TYPE_KEYWORDS: [NodeType, RegExp][] = [
  ["database", /\b(postgres(ql)?|mysql|mariadb|mongo(db)?|dynamo(db)?|cassandra|sqlite|aurora|rds|cockroach(db)?|database|db|datastore|warehouse|bigquery|snowflake|clickhouse|elasticsearch|opensearch)\b/i],
  ["cache", /\b(redis|memcached?|cache|valkey|varnish|cdn)\b/i],
  ["queue", /\b(kafka|rabbit(mq)?|sqs|sns|pub\/?sub|nats|kinesis|queue|topic|event ?bus|eventbridge|amqp|celery broker|stream)\b/i],
  ["gateway", /\b(gateway|api ?gw|nginx|envoy|ingress|load ?balancer|lb|alb|elb|traefik|haproxy|proxy|kong|bff)\b/i],
  ["worker", /\b(worker|consumer|job|jobs|cron|scheduler|celery|sidekiq|processor|batch|lambda)\b/i],
  ["client", /\b(client|browser|web ?app|mobile|ios|android|frontend|front-end|spa|user|users|customer|app)\b/i],
  ["external", /\b(stripe|twilio|sendgrid|mailgun|paypal|auth0|okta|openai|anthropic|claude|s3|gcs|external|third[- ]party|3rd[- ]party|saas|github|slack)\b/i],
];

export function inferNodeType(text: string): { type: NodeType; confidence: number } {
  for (const [type, re] of TYPE_KEYWORDS) {
    if (re.test(text)) return { type, confidence: 0.7 };
  }
  return { type: "service", confidence: 0.4 };
}

const REPLICA_RE = /(?:^|\s)(?:x|×)\s?(\d+)\b|\b(\d+)\s*(?:replicas?|instances?|pods?|nodes?)\b|\breplicas?\s*[:=]?\s*(\d+)\b/i;
const SINGLE_RE = /\b(single(?:[- ]instance)?|1 instance|no replicas?)\b/i;

export interface ParsedNodeLabel {
  label: string;
  tech: string | null;
  replicas: number | null;
}

export function parseNodeLabel(raw: string): ParsedNodeLabel {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { label: "", tech: null, replicas: null };

  let replicas: number | null = null;
  let tech: string | null = null;
  const rest: string[] = [];

  const scanReplicas = (s: string): string => {
    const m = s.match(REPLICA_RE);
    if (m) {
      replicas = Number(m[1] ?? m[2] ?? m[3]);
      return s.replace(REPLICA_RE, " ").replace(/\s+/g, " ").trim();
    }
    if (SINGLE_RE.test(s)) {
      replicas = 1;
      return s.replace(SINGLE_RE, " ").replace(/\s+/g, " ").trim();
    }
    return s;
  };

  let first = scanReplicas(lines[0]);
  const paren = first.match(/^(.*?)\s*[([]([^)\]]+)[)\]]\s*$/);
  if (paren && paren[1]) {
    first = paren[1].trim();
    tech = paren[2].trim();
  }
  for (const line of lines.slice(1)) {
    const cleaned = scanReplicas(line).replace(/^[([]|[)\]]$/g, "").trim();
    if (cleaned) rest.push(cleaned);
  }
  if (!tech && rest.length) tech = rest.join(" ");
  return { label: first, tech: tech || null, replicas };
}

// --- edge label parsing -------------------------------------------------------

export interface ParsedEdgeLabel {
  protocol: string | null;
  endpoint: string | null;
  retry: boolean | null;
  timeout_ms: number | null;
  hot_path: boolean | null;
}

const HTTP_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)/i;

export function parseEdgeLabel(raw: string): ParsedEdgeLabel {
  const text = raw.replace(/\s+/g, " ").trim();
  const out: ParsedEdgeLabel = { protocol: null, endpoint: null, retry: null, timeout_ms: null, hot_path: null };
  if (!text) return out;

  if (/\bno retr(y|ies)\b/i.test(text)) out.retry = false;
  else if (/\bretr(y|ies|ied)\b/i.test(text)) out.retry = true;

  if (/\bno timeout\b/i.test(text)) out.timeout_ms = 0;
  else {
    const t =
      text.match(/\btimeout\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|s)\b/i) ??
      text.match(/\b(\d+(?:\.\d+)?)\s*(ms|s)\s+timeout\b/i);
    if (t) out.timeout_ms = Math.round(Number(t[1]) * (t[2].toLowerCase() === "s" ? 1000 : 1));
  }

  if (/\bhot(?:[- ]path)?\b|🔥/i.test(text)) out.hot_path = true;

  const http = text.match(HTTP_RE);
  if (http) {
    out.protocol = /\bgraphql\b/i.test(text) ? "GraphQL" : "REST";
    out.endpoint = `${http[1].toUpperCase()} ${http[2]}`;
    return out;
  }

  const protocols: [string, RegExp][] = [
    ["gRPC", /\bgrpc\b/i],
    ["GraphQL", /\bgraphql\b/i],
    ["WebSocket", /\b(websockets?|ws|wss)\b/i],
    ["Kafka", /\bkafka\b/i],
    ["AMQP", /\b(amqp|rabbit(mq)?)\b/i],
    ["SQS", /\bsqs\b/i],
    ["NATS", /\bnats\b/i],
    ["SQL", /\b(sql|select|insert|upsert|query)\b/i],
    ["HTTP", /\b(https?|rest)\b/i],
  ];
  for (const [name, re] of protocols) {
    if (re.test(text)) {
      out.protocol = name;
      break;
    }
  }

  // What is left after removing the flag words is usually the endpoint, topic or method.
  const leftover = text
    .replace(/\bno retr(y|ies)\b|\bretr(y|ies|ied)\b/gi, " ")
    .replace(/\bno timeout\b|\btimeout\s*[:=]?\s*\d+(?:\.\d+)?\s*(ms|s)\b|\b\d+(?:\.\d+)?\s*(ms|s)\s+timeout\b/gi, " ")
    .replace(/\bhot(?:[- ]path)?\b|🔥/gi, " ")
    .replace(/\b(grpc|graphql|websockets?|wss?|kafka|amqp|rabbit(mq)?|sqs|nats|https?|rest)\b:?/gi, " ")
    .replace(/\b(publish(es)?|subscribe(s)?|consume(s)?|topic|to|via|call(s)?)\b:?/gi, " ")
    .replace(/[,;|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (leftover) out.endpoint = leftover;
  return out;
}

// --- derivation -------------------------------------------------------------

export interface DeriveIssue {
  canvas_id: string;
  message: string;
}

export interface DeriveResult {
  graph: Graph;
  issues: DeriveIssue[];
}

function textOf(el: CanvasElement | undefined): string {
  if (!el) return "";
  return (el.originalText ?? el.text ?? "").trim();
}

function strokeToKind(strokeStyle: string | undefined): EdgeKind {
  if (strokeStyle === "dashed") return "async";
  if (strokeStyle === "dotted") return "stream";
  return "sync";
}

export function kindToStroke(kind: EdgeKind): "solid" | "dashed" | "dotted" {
  return kind === "async" ? "dashed" : kind === "stream" ? "dotted" : "solid";
}

function clamp01(n: unknown, fallback: number): number {
  return typeof n === "number" && n >= 0 && n <= 1 ? n : fallback;
}

function nullable<T>(metaValue: T | null | undefined, parsed: T | null): T | null {
  return metaValue !== undefined ? metaValue : parsed;
}

const byIndexThenId = (a: CanvasElement, b: CanvasElement) => {
  const ai = a.index ?? "";
  const bi = b.index ?? "";
  if (ai !== bi) return ai < bi ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * The name text of an icon component: the label grouped with it, or failing that
 * (say, after an ungroup) a label sitting just under it.
 */
export function iconLabel(icon: CanvasElement, elements: readonly CanvasElement[]): CanvasElement | undefined {
  const labels = elements.filter((e) => !e.isDeleted && e.type === "text" && !e.containerId && getMeta(e).role === "label");
  const group = icon.groupIds?.[0];
  if (group) {
    const grouped = labels.find((e) => e.groupIds?.[0] === group);
    if (grouped) return grouped;
  }
  const cx = icon.x + icon.width / 2;
  const bottom = icon.y + icon.height;
  return labels.find((e) => e.x <= cx && cx <= e.x + e.width && e.y >= bottom - 4 && e.y <= bottom + 40);
}

export function deriveGraph(elements: readonly CanvasElement[]): DeriveResult {
  const live = elements.filter((e) => !e.isDeleted).slice().sort(byIndexThenId);
  const labelFor = new Map<string, string>();
  for (const el of live) {
    if (el.type === "text" && el.containerId) labelFor.set(el.containerId, textOf(el));
  }
  for (const el of live) {
    if (el.type === "image" && isNodeElement(el)) labelFor.set(el.id, textOf(iconLabel(el, live)));
  }

  const issues: DeriveIssue[] = [];
  const nodes: GraphNode[] = [];
  const nodeIdByCanvas = new Map<string, string>();
  const usedIds = new Set<string>();

  const uniqueId = (base: string) => {
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  };

  for (const el of live) {
    if (!isNodeElement(el)) continue;
    const meta = getMeta(el);
    const raw = labelFor.get(el.id) ?? "";
    const parsed = parseNodeLabel(raw);
    const inferred = inferNodeType(`${parsed.label} ${parsed.tech ?? ""}`);
    const explicitType = isNodeType(meta.type) ? meta.type : null;
    const type = explicitType ?? inferred.type;
    const confidence = explicitType ? clamp01(meta.confidence, 1) : inferred.confidence;
    const label = parsed.label || "";
    const base = slugify(label) || `${type}-${el.id.slice(0, 4).toLowerCase()}`;
    const id = uniqueId(base);
    nodeIdByCanvas.set(el.id, id);
    const replicas = nullable(meta.replicas, parsed.replicas);
    nodes.push({
      id,
      type,
      label: label || type,
      tech: nullable(meta.tech, parsed.tech),
      replicas,
      dlq: type === "queue" ? nullable(meta.dlq, null) : null,
      canvas_id: el.id,
      source: isSource(meta.source) ? meta.source : "user",
      confidence,
    });
    if (!label) issues.push({ canvas_id: el.id, message: "Shape has no label; name it so the reviewer can talk about it." });
  }

  const edges: GraphEdge[] = [];
  const usedEdgeIds = new Set<string>();
  for (const el of live) {
    if (el.type !== "arrow") continue;
    const startId = el.startBinding?.elementId;
    const endId = el.endBinding?.elementId;
    let from = startId ? nodeIdByCanvas.get(startId) : undefined;
    let to = endId ? nodeIdByCanvas.get(endId) : undefined;
    if (!from || !to) {
      issues.push({
        canvas_id: el.id,
        message: "Arrow is not attached to a shape at both ends, so it is not part of the graph yet.",
      });
      continue;
    }
    if (from === to) continue;
    // An arrow drawn backwards (head only at the start) points the other way.
    if (el.startArrowhead && !el.endArrowhead) [from, to] = [to, from];

    const meta = getMeta(el);
    const parsed = parseEdgeLabel(labelFor.get(el.id) ?? "");
    const kind = isEdgeKind(meta.kind) ? meta.kind : strokeToKind(el.strokeStyle);
    let id = `${from}->${to}`;
    let n = 2;
    while (usedEdgeIds.has(id)) id = `${from}->${to}#${n++}`;
    usedEdgeIds.add(id);
    edges.push({
      id,
      from,
      to,
      kind,
      protocol: nullable(meta.protocol, parsed.protocol),
      endpoint: nullable(meta.endpoint, parsed.endpoint),
      retry: nullable(meta.retry, parsed.retry),
      timeout_ms: nullable(meta.timeout_ms, parsed.timeout_ms),
      hot_path: nullable(meta.hot_path, parsed.hot_path),
      canvas_id: el.id,
      source: isSource(meta.source) ? meta.source : "user",
      confidence: clamp01(meta.confidence, 1),
    });
  }

  // A queue fed into a queue labelled as a dead-letter queue counts as having one.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const src = nodeById.get(e.from);
    const dst = nodeById.get(e.to);
    if (src?.type === "queue" && src.dlq === null && dst && /\b(dlq|dead[- ]?letter)\b/i.test(`${dst.label} ${e.endpoint ?? ""}`)) {
      src.dlq = true;
    }
  }

  return { graph: { nodes, edges }, issues };
}

/** Canvas geometry per element id, for exporters that keep the drawn layout. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function geometryOf(elements: readonly CanvasElement[]): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const el of elements) {
    if (el.isDeleted) continue;
    out.set(el.id, { x: el.x, y: el.y, width: el.width, height: el.height });
  }
  return out;
}
