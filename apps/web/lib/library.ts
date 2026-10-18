// The shape library: what you can drag onto the diagram, grouped the way
// architecture diagrams are usually read. Each component pins its icon, so a
// "Function" stays a λ even after you rename it.

import {
  type DiagramNode,
  type Glyph,
  type NodeType,
  type ZoneKind,
  iconDataUrl,
  iconFor,
  newDiagramId,
} from "@stacksketch/graph";

export type LibraryItem =
  | { kind: "component"; key: string; label: string; type: NodeType; icon: Glyph; keywords: string }
  | { kind: "zone"; key: string; label: string; zone: ZoneKind; keywords: string }
  | { kind: "note"; key: string; label: string; keywords: string };

const component = (label: string, type: NodeType, keywords = ""): LibraryItem => ({
  kind: "component",
  key: `${type}:${label}`,
  label,
  type,
  icon: iconFor({ type, label }).glyph,
  keywords: `${label} ${type} ${keywords}`.toLowerCase(),
});

export const LIBRARY: { title: string; items: LibraryItem[] }[] = [
  {
    title: "Users & clients",
    items: [
      component("User", "client", "person actor customer"),
      component("Users", "client", "people actors customers"),
      component("Web app", "client", "browser frontend spa react next"),
      component("Mobile app", "client", "ios android phone"),
    ],
  },
  {
    title: "Networking",
    items: [
      component("API gateway", "gateway", "kong apigee bff ingress"),
      component("Load balancer", "gateway", "lb alb elb nginx haproxy envoy proxy"),
      component("CDN", "gateway", "cloudfront akamai fastly cloudflare edge"),
    ],
  },
  {
    title: "Compute",
    items: [
      component("Service", "service", "microservice api backend server container"),
      component("Function", "service", "lambda serverless faas cloud function"),
      component("Worker", "worker", "consumer job background celery sidekiq"),
      component("Scheduler", "worker", "cron timer batch periodic"),
    ],
  },
  {
    title: "Data & storage",
    items: [
      component("Database", "database", "sql postgres mysql mongo dynamodb rds"),
      component("Cache", "cache", "redis memcached valkey"),
      component("Object storage", "database", "s3 blob gcs bucket files"),
      component("Search index", "database", "elasticsearch opensearch solr"),
      component("Data warehouse", "database", "bigquery snowflake redshift analytics olap"),
    ],
  },
  {
    title: "Messaging",
    items: [
      component("Queue", "queue", "sqs rabbitmq amqp broker"),
      component("Event stream", "queue", "kafka kinesis pulsar stream"),
      component("Pub/sub topic", "queue", "sns eventbridge topic event bus fanout"),
    ],
  },
  {
    title: "Security & AI",
    items: [
      component("Auth service", "service", "identity login sso oauth keycloak cognito"),
      component("ML model", "service", "inference ai llm recommendation"),
    ],
  },
  {
    title: "External services",
    items: [
      component("External API", "external", "third party saas"),
      component("Payments", "external", "stripe paypal adyen billing"),
      component("Email / SMS", "external", "sendgrid twilio ses notification"),
      component("LLM API", "external", "openai anthropic claude gpt openrouter"),
    ],
  },
  {
    title: "Groups & notes",
    items: [
      { kind: "zone", key: "zone:system", label: "System", zone: "system", keywords: "zone group boundary container system vpc cloud region" },
      { kind: "zone", key: "zone:clients", label: "Clients", zone: "clients", keywords: "zone group users clients actors" },
      { kind: "zone", key: "zone:external", label: "External services", zone: "external", keywords: "zone group third party external" },
      { kind: "note", key: "note", label: "Note", keywords: "note text comment annotation" },
    ],
  },
];

export const ZONE_SIZE = { w: 360, h: 240 };
export const NOTE_SIZE = { w: 200, h: 64 };

/** The icon a component shows: its pinned one, or what its type and name call for. */
export function componentIcon(node: Pick<DiagramNode, "type" | "label" | "tech" | "icon">): string {
  const type = node.type ?? "service";
  const glyph = node.icon ?? iconFor({ type, label: node.label, tech: node.tech }).glyph;
  return iconDataUrl({ glyph, outline: type === "client" || type === "external" });
}

export function itemIcon(item: LibraryItem): string | null {
  return item.kind === "component" ? iconDataUrl({ glyph: item.icon, outline: item.type === "client" || item.type === "external" }) : null;
}

/** A new diagram node for a library item, with its top-left corner at `at`. */
export function nodeFromItem(item: LibraryItem, at: { x: number; y: number }, parent: string | null = null): DiagramNode {
  const base = { id: newDiagramId(), x: Math.round(at.x), y: Math.round(at.y), parent };
  if (item.kind === "zone") return { ...base, kind: "zone", label: item.label, zone: item.zone, ...ZONE_SIZE };
  if (item.kind === "note") return { ...base, kind: "note", label: "Note", ...NOTE_SIZE };
  return { ...base, kind: "component", label: item.label, type: item.type, icon: item.icon, origin: "user", confidence: 1 };
}

export const DRAG_MIME = "application/x-stacksketch-item";

export const itemByKey = new Map(LIBRARY.flatMap((g) => g.items).map((i) => [i.key, i]));
