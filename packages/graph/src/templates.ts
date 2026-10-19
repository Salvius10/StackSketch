// Ready-made diagrams to start from, as draw.io's template gallery offers.
// Architecture ones are graphs, laid out into zones when inserted; flowcharts,
// UML, ER, network and the rest are drawn by hand on a grid.

import { type Box } from "./derive";
import { type Diagram, type DiagramEdge, type DiagramNode, type Side, absoluteBox, diagramFromLayout, sidesBetween } from "./diagram";
import { layoutGraph } from "./layout";
import { type ConnectorStyle, libraryItem, nodeFromItem } from "./library";
import type { EdgeKind, Graph, GraphEdge, GraphNode, NodeType } from "./schema";
import { type NodeStyle, rowsLayout, shapeDef } from "./shapes";

export type TemplateCategory = "Architecture" | "Cloud" | "Flowchart" | "Software" | "Network" | "Basic";
export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["Architecture", "Cloud", "Flowchart", "Software", "Network", "Basic"];

export interface Template {
  id: string;
  category: TemplateCategory;
  name: string;
  description: string;
  /** The diagram, with ids local to the template: give it fresh ones before adding it to a board. */
  build(): Promise<Diagram>;
}

// --- graphs laid out into zones ------------------------------------------------------------------

const gn = (id: string, type: NodeType, label: string, more: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type,
  label,
  tech: null,
  replicas: null,
  dlq: null,
  canvas_id: null,
  source: "user",
  confidence: 1,
  ...more,
});

const ge = (from: string, to: string, more: Partial<GraphEdge> & { kind?: EdgeKind } = {}): GraphEdge => ({
  id: `${from}->${to}`,
  from,
  to,
  kind: "sync",
  protocol: null,
  endpoint: null,
  retry: null,
  timeout_ms: null,
  hot_path: null,
  canvas_id: null,
  source: "user",
  confidence: 1,
  ...more,
});

const counter = () => {
  let n = 0;
  return () => `t${++n}`;
};

/** A graph template; `icons` maps node ids to library items whose icon they take (AWS, Kubernetes…). */
function laidOut(graph: Graph, systemName: string, icons: Record<string, string> = {}): () => Promise<Diagram> {
  return async () => {
    const layout = await layoutGraph(graph, { systemName });
    return diagramFromLayout(graph, layout, counter(), (n) => {
      const item = icons[n.id] ? libraryItem(icons[n.id]) : undefined;
      if (item?.kind !== "component") return undefined;
      return { icon: item.icon, ...(item.tint ? { tint: item.tint } : {}), ...(item.frame ? { frame: item.frame } : {}), tech: n.tech ?? item.tech ?? null };
    });
  };
}

// --- hand-drawn diagrams -----------------------------------------------------------------------

type Place = Partial<Pick<DiagramNode, "w" | "h" | "label" | "style" | "type" | "tech">> & { in?: string };
type Link = Partial<Pick<DiagramEdge, "label" | "kind" | "sourceSide" | "targetSide" | "line" | "startArrow" | "endArrow">> & { as?: string };

/** Draws with library items at absolute positions; children of a zone are stored relative to it. */
class Sketch {
  nodes: DiagramNode[] = [];
  edges: DiagramEdge[] = [];
  private next = counter();
  private byId = new Map<string, DiagramNode>();

  add(key: string, x: number, y: number, place: Place = {}): string {
    const item = libraryItem(key);
    if (!item) throw new Error(`No library item ${key}`);
    const { in: parent, ...over } = place;
    const origin = parent ? absoluteBox(this.byId.get(parent)!, this.byId) : { x: 0, y: 0 };
    const node: DiagramNode = { ...nodeFromItem(item, { x: x - origin.x, y: y - origin.y }, parent ?? null)!, ...over, id: this.next() };
    if (over.style && item.kind === "shape" && item.style) node.style = { ...item.style, ...over.style };
    const def = node.kind === "shape" ? shapeDef(node.shape) : null;
    if (def?.rows && def.rows !== "table" && over.h === undefined) node.h = Math.max(node.h ?? def.h, rowsLayout(def.rows, node.label).height);
    this.nodes.push(node);
    this.byId.set(node.id, node);
    return node.id;
  }

  link(from: string, to: string, link: Link = {}): void {
    const { as, ...over } = link;
    const preset = as ? libraryItem(as) : undefined;
    const style: ConnectorStyle = preset?.kind === "connector" ? preset.edge : {};
    const [s, t] = sidesBetween(this.box(from), this.box(to));
    this.edges.push({ id: this.next(), source: from, target: to, ...style, sourceSide: s, targetSide: t, ...over });
  }

  private box(id: string): Box {
    return absoluteBox(this.byId.get(id)!, this.byId);
  }

  done(): Diagram {
    return { nodes: this.nodes, edges: this.edges };
  }
}

const sketch = (draw: (s: Sketch) => void) => async () => {
  const s = new Sketch();
  draw(s);
  return s.done();
};

const side = (sourceSide: Side, targetSide: Side) => ({ sourceSide, targetSide });

const GREEN: NodeStyle = { fill: "#D5E8D4", stroke: "#82B366" };
const YELLOW: NodeStyle = { fill: "#FFF2CC", stroke: "#D6B656" };
const BLUE: NodeStyle = { fill: "#DAE8FC", stroke: "#6C8EBF" };
const ORANGE: NodeStyle = { fill: "#FFE6CC", stroke: "#D79B00" };
const RED: NodeStyle = { fill: "#F8CECC", stroke: "#B85450" };
const PURPLE: NodeStyle = { fill: "#E1D5E7", stroke: "#9673A6" };

// --- the gallery ---------------------------------------------------------------------------------

export const TEMPLATES: Template[] = [
  {
    id: "three-tier",
    category: "Architecture",
    name: "Three-tier web app",
    description: "Users through a CDN and load balancer to app servers, a database and a cache.",
    build: laidOut(
      {
        nodes: [
          gn("users", "client", "Users"),
          gn("mobile", "client", "Mobile app"),
          gn("cdn", "gateway", "CDN", { tech: "CloudFront" }),
          gn("assets", "database", "Static assets", { tech: "S3" }),
          gn("lb", "gateway", "Load balancer"),
          gn("app", "service", "App server", { tech: "Node.js", replicas: 3 }),
          gn("db", "database", "Database", { tech: "PostgreSQL", replicas: 2 }),
          gn("cache", "cache", "Cache", { tech: "Redis" }),
        ],
        edges: [
          ge("users", "cdn", { protocol: "HTTPS" }),
          ge("mobile", "lb", { protocol: "HTTPS", endpoint: "/api" }),
          ge("cdn", "assets", { endpoint: "GET /assets" }),
          ge("cdn", "lb", { endpoint: "/api" }),
          ge("lb", "app", { protocol: "HTTP" }),
          ge("app", "db", { protocol: "SQL" }),
          ge("app", "cache", { endpoint: "GET/SET" }),
        ],
      },
      "Web application",
    ),
  },
  {
    id: "microservices",
    category: "Architecture",
    name: "Microservices",
    description: "An API gateway in front of services that each own their data, with events and payments.",
    build: laidOut(
      {
        nodes: [
          gn("web", "client", "Web app"),
          gn("mobile", "client", "Mobile app"),
          gn("gw", "gateway", "API gateway"),
          gn("auth", "service", "Auth service"),
          gn("orders", "service", "Order service", { replicas: 2 }),
          gn("catalog", "service", "Catalog service", { replicas: 2 }),
          gn("usersdb", "database", "Users DB", { tech: "PostgreSQL" }),
          gn("ordersdb", "database", "Orders DB", { tech: "PostgreSQL" }),
          gn("catalogdb", "database", "Catalog DB", { tech: "MongoDB" }),
          gn("events", "queue", "Order events", { tech: "Kafka" }),
          gn("notify", "worker", "Notification worker"),
          gn("email", "external", "Email", { tech: "SendGrid" }),
          gn("stripe", "external", "Payments", { tech: "Stripe" }),
        ],
        edges: [
          ge("web", "gw", { protocol: "HTTPS" }),
          ge("mobile", "gw", { protocol: "HTTPS" }),
          ge("gw", "auth", { endpoint: "/auth" }),
          ge("gw", "orders", { endpoint: "POST /orders" }),
          ge("gw", "catalog", { endpoint: "GET /products" }),
          ge("auth", "usersdb", { protocol: "SQL" }),
          ge("orders", "ordersdb", { protocol: "SQL" }),
          ge("catalog", "catalogdb"),
          ge("orders", "stripe", { endpoint: "POST /charges", timeout_ms: 3000, retry: true }),
          ge("orders", "events", { kind: "async", endpoint: "order.created" }),
          ge("events", "notify", { kind: "async", retry: true }),
          ge("notify", "email", { endpoint: "POST /mail/send" }),
        ],
      },
      "Shop platform",
    ),
  },
  {
    id: "event-driven",
    category: "Architecture",
    name: "Event-driven",
    description: "An ingest API publishing to an event stream that several consumers read.",
    build: laidOut(
      {
        nodes: [
          gn("app", "client", "Web app"),
          gn("ingest", "service", "Ingest API", { replicas: 2 }),
          gn("bus", "queue", "Event stream", { tech: "Kafka" }),
          gn("analytics", "worker", "Analytics worker"),
          gn("indexer", "worker", "Search indexer"),
          gn("notifier", "worker", "Notification worker"),
          gn("warehouse", "database", "Warehouse", { tech: "Snowflake" }),
          gn("search", "database", "Search index", { tech: "Elasticsearch" }),
          gn("dlq", "queue", "Dead-letter queue", { tech: "Kafka" }),
          gn("push", "external", "Push service", { tech: "Firebase" }),
        ],
        edges: [
          ge("app", "ingest", { endpoint: "POST /events" }),
          ge("ingest", "bus", { kind: "async", endpoint: "events" }),
          ge("bus", "analytics", { kind: "stream" }),
          ge("bus", "indexer", { kind: "stream" }),
          ge("bus", "notifier", { kind: "async", retry: true }),
          ge("analytics", "warehouse", { protocol: "SQL" }),
          ge("indexer", "search"),
          ge("notifier", "push", { timeout_ms: 2000 }),
          ge("notifier", "dlq", { kind: "async", endpoint: "failed" }),
        ],
      },
      "Event platform",
    ),
  },
  {
    id: "data-pipeline",
    category: "Architecture",
    name: "Data pipeline",
    description: "Change data capture into a stream, processed into a lake and a warehouse for BI.",
    build: laidOut(
      {
        nodes: [
          gn("appdb", "database", "App DB", { tech: "PostgreSQL" }),
          gn("cdc", "worker", "CDC connector", { tech: "Debezium" }),
          gn("stream", "queue", "Change stream", { tech: "Kafka" }),
          gn("proc", "worker", "Stream processor", { tech: "Flink" }),
          gn("lake", "database", "Data lake", { tech: "S3" }),
          gn("wh", "database", "Warehouse", { tech: "Snowflake" }),
          gn("bi", "client", "BI dashboard", { tech: "Looker" }),
        ],
        edges: [
          ge("cdc", "appdb", { endpoint: "read WAL" }),
          ge("cdc", "stream", { kind: "stream" }),
          ge("stream", "proc", { kind: "stream" }),
          ge("proc", "lake", { kind: "async", endpoint: "parquet" }),
          ge("proc", "wh", { kind: "async", endpoint: "INSERT" }),
          ge("bi", "wh", { protocol: "SQL" }),
        ],
      },
      "Data platform",
    ),
  },
  {
    id: "aws-serverless",
    category: "Cloud",
    name: "AWS serverless API",
    description: "CloudFront, API Gateway, Lambda, DynamoDB and SQS with a worker function.",
    build: laidOut(
      {
        nodes: [
          gn("users", "client", "Users"),
          gn("cf", "gateway", "CloudFront"),
          gn("site", "database", "Website bucket", { tech: "Amazon S3" }),
          gn("api", "gateway", "API Gateway"),
          gn("auth", "service", "Cognito"),
          gn("fn", "service", "Orders function", { tech: "AWS Lambda" }),
          gn("table", "database", "Orders table", { tech: "Amazon DynamoDB" }),
          gn("queue", "queue", "Jobs queue", { tech: "Amazon SQS" }),
          gn("worker", "worker", "Worker function", { tech: "AWS Lambda" }),
          gn("mail", "external", "SES"),
        ],
        edges: [
          ge("users", "cf", { protocol: "HTTPS" }),
          ge("cf", "site", { endpoint: "GET /*" }),
          ge("users", "api", { protocol: "HTTPS", endpoint: "/api" }),
          ge("api", "auth", { endpoint: "authorize" }),
          ge("api", "fn", { endpoint: "POST /orders" }),
          ge("fn", "table", { endpoint: "PutItem" }),
          ge("fn", "queue", { kind: "async", endpoint: "SendMessage" }),
          ge("queue", "worker", { kind: "async", retry: true }),
          ge("worker", "mail", { endpoint: "SendEmail", timeout_ms: 5000 }),
        ],
      },
      "AWS",
      { users: "aws:users", cf: "aws:cloudfront", site: "aws:s3", api: "aws:api-gateway", auth: "aws:cognito", fn: "aws:lambda", table: "aws:dynamodb", queue: "aws:sqs", worker: "aws:lambda", mail: "aws:ses" },
    ),
  },
  {
    id: "azure-web",
    category: "Cloud",
    name: "Azure web app",
    description: "Front Door, App Service, Azure SQL and Redis, with Service Bus and Functions for background work.",
    build: laidOut(
      {
        nodes: [
          gn("users", "client", "Users"),
          gn("fd", "gateway", "Front Door"),
          gn("app", "service", "Web app", { tech: "Azure App Service", replicas: 2 }),
          gn("sql", "database", "SQL Database"),
          gn("redis", "cache", "Cache for Redis"),
          gn("bus", "queue", "Service Bus"),
          gn("fn", "worker", "Functions"),
          gn("blob", "database", "Blob Storage"),
          gn("id", "service", "Entra ID"),
        ],
        edges: [
          ge("users", "fd", { protocol: "HTTPS" }),
          ge("fd", "app"),
          ge("app", "id", { endpoint: "OIDC" }),
          ge("app", "sql", { protocol: "SQL" }),
          ge("app", "redis"),
          ge("app", "bus", { kind: "async", endpoint: "orders" }),
          ge("bus", "fn", { kind: "async", retry: true }),
          ge("fn", "blob", { endpoint: "PUT invoice.pdf" }),
        ],
      },
      "Azure",
      { users: "azure:users", fd: "azure:front-door", app: "azure:app-service", sql: "azure:sql-database", redis: "azure:cache-for-redis", bus: "azure:service-bus", fn: "azure:functions", blob: "azure:blob-storage", id: "azure:entra-id" },
    ),
  },
  {
    id: "gcp-events",
    category: "Cloud",
    name: "Google Cloud event pipeline",
    description: "Cloud Run publishing to Pub/Sub, processed by Dataflow into BigQuery.",
    build: laidOut(
      {
        nodes: [
          gn("users", "client", "Users"),
          gn("lb", "gateway", "Load Balancing"),
          gn("run", "service", "API", { tech: "Cloud Run", replicas: 2 }),
          gn("sql", "database", "Cloud SQL"),
          gn("ps", "queue", "Pub/Sub"),
          gn("df", "worker", "Dataflow"),
          gn("bq", "database", "BigQuery"),
          gn("gcs", "database", "Cloud Storage"),
        ],
        edges: [
          ge("users", "lb", { protocol: "HTTPS" }),
          ge("lb", "run"),
          ge("run", "sql", { protocol: "SQL" }),
          ge("run", "ps", { kind: "async", endpoint: "events" }),
          ge("ps", "df", { kind: "stream" }),
          ge("df", "bq", { kind: "async", endpoint: "streaming insert" }),
          ge("df", "gcs", { kind: "async", endpoint: "archive" }),
        ],
      },
      "Google Cloud",
      { users: "gcp:users", lb: "gcp:load-balancing", run: "gcp:cloud-run", sql: "gcp:cloud-sql", ps: "gcp:pub-sub", df: "gcp:dataflow", bq: "gcp:bigquery", gcs: "gcp:cloud-storage" },
    ),
  },
  {
    id: "kubernetes",
    category: "Cloud",
    name: "Kubernetes web app",
    description: "An ingress, services and deployments, a StatefulSet database and a nightly CronJob.",
    build: laidOut(
      {
        nodes: [
          gn("user", "client", "User"),
          gn("ing", "gateway", "Ingress", { tech: "ingress-nginx" }),
          gn("websvc", "gateway", "web-svc"),
          gn("web", "service", "web", { replicas: 3 }),
          gn("apisvc", "gateway", "api-svc"),
          gn("api", "service", "api", { replicas: 3 }),
          gn("db", "database", "postgres", { tech: "PostgreSQL", replicas: 1 }),
          gn("redis", "cache", "redis", { tech: "Redis" }),
          gn("cron", "worker", "nightly-report"),
        ],
        edges: [
          ge("user", "ing", { protocol: "HTTPS" }),
          ge("ing", "websvc", { endpoint: "/" }),
          ge("ing", "apisvc", { endpoint: "/api" }),
          ge("websvc", "web"),
          ge("apisvc", "api"),
          ge("web", "apisvc", { protocol: "HTTP" }),
          ge("api", "db", { protocol: "SQL" }),
          ge("api", "redis"),
          ge("cron", "db", { protocol: "SQL" }),
        ],
      },
      "Cluster",
      { user: "k8s:user", ing: "k8s:ingress", websvc: "k8s:service", web: "k8s:deployment", apisvc: "k8s:service", api: "k8s:deployment", db: "k8s:statefulset", redis: "k8s:statefulset", cron: "k8s:cronjob" },
    ),
  },
  {
    id: "flowchart",
    category: "Flowchart",
    name: "Order process",
    description: "A flowchart with decisions: stock check, payment, shipping.",
    build: sketch((s) => {
      const start = s.add("flowchart:terminator", 200, 0, { label: "Start", style: GREEN });
      const receive = s.add("flowchart:data", 190, 90, { w: 140, label: "Receive order" });
      const stock = s.add("flowchart:decision", 210, 190, { w: 100, h: 100, label: "In stock?", style: YELLOW });
      const reserve = s.add("flowchart:process", 190, 340, { w: 140, label: "Reserve items", style: BLUE });
      const pay = s.add("flowchart:process", 190, 440, { w: 140, label: "Charge card", style: BLUE });
      const paid = s.add("flowchart:decision", 210, 540, { w: 100, h: 100, label: "Paid?", style: YELLOW });
      const ship = s.add("flowchart:process", 190, 690, { w: 140, label: "Ship order", style: BLUE });
      const end = s.add("flowchart:terminator", 200, 790, { label: "End", style: RED });
      const notify = s.add("flowchart:process", 400, 210, { w: 140, label: "Notify customer", style: BLUE });
      const end2 = s.add("flowchart:terminator", 410, 330, { label: "End", style: RED });
      const cancel = s.add("flowchart:process", 400, 560, { w: 140, label: "Cancel order", style: BLUE });
      const end3 = s.add("flowchart:terminator", 410, 680, { label: "End", style: RED });
      const down = side("bottom", "top");
      s.link(start, receive, down);
      s.link(receive, stock, down);
      s.link(stock, reserve, { ...down, label: "Yes" });
      s.link(stock, notify, { ...side("right", "left"), label: "No" });
      s.link(reserve, pay, down);
      s.link(pay, paid, down);
      s.link(paid, ship, { ...down, label: "Yes" });
      s.link(paid, cancel, { ...side("right", "left"), label: "No" });
      s.link(ship, end, down);
      s.link(notify, end2, down);
      s.link(cancel, end3, down);
    }),
  },
  {
    id: "swimlanes",
    category: "Flowchart",
    name: "Cross-functional flow",
    description: "An approval process across two lanes: requester and manager.",
    build: sketch((s) => {
      const lane1 = s.add("general:group-swimlane", 0, 0, { w: 760, h: 170, label: "Requester" });
      const lane2 = s.add("general:group-swimlane", 0, 190, { w: 760, h: 170, label: "Manager" });
      const start = s.add("flowchart:terminator", 40, 70, { in: lane1, label: "Start", style: GREEN });
      const request = s.add("flowchart:process", 210, 65, { in: lane1, label: "Submit request", style: BLUE });
      const review = s.add("flowchart:process", 210, 255, { in: lane2, label: "Review request", style: BLUE });
      const ok = s.add("flowchart:decision", 400, 245, { in: lane2, w: 80, h: 80, label: "Approve?", style: YELLOW });
      const done = s.add("flowchart:process", 560, 65, { in: lane1, label: "Get the result", style: BLUE });
      s.link(start, request, side("right", "left"));
      s.link(request, review, side("bottom", "top"));
      s.link(review, ok, side("right", "left"));
      s.link(ok, done, { ...side("right", "bottom"), label: "Yes" });
      s.link(ok, request, { ...side("top", "right"), label: "No" });
    }),
  },
  {
    id: "uml-class",
    category: "Software",
    name: "UML class diagram",
    description: "Classes with attributes and methods, associations, composition and inheritance.",
    build: sketch((s) => {
      const customer = s.add("uml:class", 0, 0, { w: 180, label: "Customer\n+ id: UUID\n+ name: String\n--\n+ placeOrder(): Order" });
      const order = s.add("uml:class", 300, 0, { w: 220, label: "Order\n+ id: UUID\n+ total: Money\n+ status: Status\n--\n+ addLine(product, qty)\n+ submit(): void" });
      const product = s.add("uml:class", 640, 0, { w: 180, label: "Product\n+ sku: String\n+ price: Money" });
      const payment = s.add("uml:class", 310, 260, { w: 200, label: "«abstract»\nPayment\n+ amount: Money\n--\n+ authorize(): bool" });
      const card = s.add("uml:class", 180, 450, { w: 180, label: "CardPayment\n+ cardToken: String" });
      const bank = s.add("uml:class", 460, 450, { w: 180, label: "BankTransfer\n+ iban: String" });
      s.link(customer, order, { as: "uml:line-directed-association", label: "places", ...side("right", "left") });
      s.link(order, product, { as: "uml:line-aggregation", label: "contains", ...side("right", "left") });
      s.link(order, payment, { as: "uml:line-composition", label: "paid by", ...side("bottom", "top") });
      s.link(card, payment, { as: "uml:line-inheritance", ...side("top", "bottom") });
      s.link(bank, payment, { as: "uml:line-inheritance", ...side("top", "bottom") });
    }),
  },
  {
    id: "er",
    category: "Software",
    name: "Entity relationship",
    description: "Customers, orders, order items and products, with crow's foot cardinality.",
    build: sketch((s) => {
      const customer = s.add("er:table", 0, 0, { label: "Customer\nPK id\nname\nemail" });
      const order = s.add("er:table", 300, 0, { label: "Order\nPK id\nFK customer_id\ncreated_at\ntotal" });
      const item = s.add("er:table", 600, 0, { label: "OrderItem\nPK id\nFK order_id\nFK product_id\nquantity" });
      const product = s.add("er:table", 600, 220, { label: "Product\nPK id\nname\nprice" });
      s.link(customer, order, { as: "er:line-one-to-zero-or-many", ...side("right", "left") });
      s.link(order, item, { as: "er:line-one-to-one-or-many", ...side("right", "left") });
      s.link(product, item, { as: "er:line-one-to-zero-or-many", ...side("top", "bottom") });
    }),
  },
  {
    id: "c4-context",
    category: "Software",
    name: "C4 system context",
    description: "A software system, the people who use it and the systems it depends on.",
    build: sketch((s) => {
      const customer = s.add("c4:person", 230, 0, { label: "Customer\n[Person]\nBuys products online." });
      const shop = s.add("c4:software-system", 200, 260, { label: "Online Shop\n[Software System]\nLets customers browse and buy." });
      const staff = s.add("c4:person", 560, 235, { label: "Staff\n[Person]\nManages the catalogue." });
      const payments = s.add("c4:external-system", 40, 470, { w: 200, h: 110, label: "Payment provider\n[Software System]\nTakes card payments." });
      const email = s.add("c4:external-system", 380, 470, { w: 200, h: 110, label: "Email system\n[Software System]\nSends order emails." });
      s.link(customer, shop, { as: "c4:line-relationship", label: "Places orders using", ...side("bottom", "top") });
      s.link(staff, shop, { as: "c4:line-relationship", label: "Manages products in", ...side("left", "right") });
      s.link(shop, payments, { as: "c4:line-relationship", label: "Takes payments via", ...side("bottom", "top") });
      s.link(shop, email, { as: "c4:line-relationship", label: "Sends emails using", ...side("bottom", "top") });
    }),
  },
  {
    id: "office-network",
    category: "Network",
    name: "Office network",
    description: "Internet, firewall, router and switch down to the office's devices.",
    build: sketch((s) => {
      const lan = s.add("net:group-network", 20, 250, { w: 700, h: 620, label: "Office network" });
      const internet = s.add("net:internet", 338, 0);
      const firewall = s.add("net:firewall", 338, 140);
      const router = s.add("net:router", 338, 300, { in: lan });
      const sw = s.add("net:switch", 338, 440, { in: lan });
      const leaves = [
        s.add("net:server", 58, 590, { in: lan }),
        s.add("net:desktop", 198, 590, { in: lan }),
        s.add("net:laptop", 338, 590, { in: lan }),
        s.add("net:printer", 478, 590, { in: lan }),
      ];
      const wifi = s.add("net:wireless-ap", 618, 590, { in: lan });
      const tablet = s.add("net:tablet", 618, 740, { in: lan });
      const down = side("bottom", "top");
      s.link(internet, firewall, { ...down, endArrow: "none" });
      s.link(firewall, router, { ...down, endArrow: "none" });
      s.link(router, sw, { ...down, endArrow: "none" });
      for (const leaf of [...leaves, wifi]) s.link(sw, leaf, { ...down, endArrow: "none" });
      s.link(wifi, tablet, { ...down, kind: "async", endArrow: "none" });
    }),
  },
  {
    id: "mind-map",
    category: "Basic",
    name: "Mind map",
    description: "A central topic with branches around it.",
    build: sketch((s) => {
      const topic = s.add("general:ellipse", 460, 240, { w: 180, h: 90, label: "Product launch", style: { ...BLUE, fontSize: 16, bold: true } });
      const branches: [string, number, number, NodeStyle, Side, Side][] = [
        ["Design", 480, 60, PURPLE, "top", "bottom"],
        ["Marketing", 180, 140, GREEN, "left", "right"],
        ["Sales", 180, 380, ORANGE, "left", "right"],
        ["Engineering", 780, 140, YELLOW, "right", "left"],
        ["Support", 780, 380, RED, "right", "left"],
        ["Finance", 480, 470, GREEN, "bottom", "top"],
      ];
      for (const [label, x, y, style, from, to] of branches) {
        const b = s.add("general:rounded-rectangle", x, y, { w: 140, h: 50, label, style });
        s.link(topic, b, { line: "curved", endArrow: "none", sourceSide: from, targetSide: to });
      }
    }),
  },
  {
    id: "org-chart",
    category: "Basic",
    name: "Org chart",
    description: "A chief executive, three leads and their teams.",
    build: sketch((s) => {
      const ceo = s.add("general:rectangle", 390, 0, { w: 160, h: 60, label: "CEO\nAda Lovelace", style: BLUE });
      const leads: [string, number][] = [
        ["CTO", 70],
        ["COO", 390],
        ["CFO", 710],
      ];
      const teams = ["Platform", "Product", "Operations", "Support", "Finance", "People"];
      leads.forEach(([title, x], i) => {
        const lead = s.add("general:rectangle", x, 130, { w: 160, h: 60, label: title, style: GREEN });
        s.link(ceo, lead, { sourceSide: "bottom", targetSide: "top", endArrow: "none" });
        for (const j of [0, 1]) {
          const team = s.add("general:rectangle", (i * 2 + j) * 160, 260, { w: 140, h: 50, label: teams[i * 2 + j] });
          s.link(lead, team, { sourceSide: "bottom", targetSide: "top", endArrow: "none" });
        }
      });
    }),
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
