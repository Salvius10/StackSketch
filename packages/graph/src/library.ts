// The shape libraries, as in draw.io's sidebar: the standard ones (General, Misc,
// Advanced, Basic, Arrows, Flowchart, Entity Relation, UML) and more to switch on
// from "More shapes" (architecture components, C4, AWS, Azure, Google Cloud,
// Kubernetes, network). Components, and shapes that carry a type, are what the
// reviewer reads; everything else is drawing.

import { type DiagramEdge, type DiagramNode, newDiagramId } from "./diagram";
import { type Glyph, type IconFrame, iconFor } from "./icons";
import type { ZoneKind } from "./layout";
import type { NodeType } from "./schema";
import { type NodeStyle, rowsLayout, shapeDef } from "./shapes";

/** What a connector item sets on the connectors you draw next. */
export type ConnectorStyle = Pick<DiagramEdge, "kind" | "line" | "startArrow" | "endArrow" | "width">;

interface ItemBase {
  key: string;
  name: string;
  keywords: string;
}

export type LibraryItem =
  | (ItemBase & { kind: "shape"; shape: string; w: number; h: number; label: string; style?: NodeStyle; type?: NodeType; tech?: string })
  | (ItemBase & { kind: "component"; label: string; type: NodeType | null; tech?: string; icon: Glyph; tint?: string; frame?: IconFrame })
  | (ItemBase & { kind: "zone"; label: string; zone: ZoneKind; w: number; h: number; style?: NodeStyle; icon?: Glyph; tint?: string; lane?: boolean })
  | (ItemBase & { kind: "note" })
  | (ItemBase & { kind: "connector"; edge: ConnectorStyle });

export interface Library {
  id: string;
  title: string;
  /** Its section in the More shapes dialog. */
  group: "Standard" | "Software" | "Cloud" | "Networking";
  description: string;
  items: LibraryItem[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

type ShapeOver = { w?: number; h?: number; label?: string; style?: NodeStyle; type?: NodeType; tech?: string; keywords?: string };

/** Builders for one library's items; keys are "<library>:<name>". */
function makers(lib: string, icons: { tint?: string; frame?: IconFrame } = {}) {
  return {
    shape(shape: string, name?: string, over: ShapeOver = {}): LibraryItem {
      const def = shapeDef(shape);
      const title = name ?? def.name;
      const label = over.label ?? "";
      const h = def.rows && def.rows !== "table" && label ? Math.max(over.h ?? def.h, rowsLayout(def.rows, label).height) : (over.h ?? def.h);
      return {
        kind: "shape",
        key: `${lib}:${slug(title)}`,
        name: title,
        shape,
        w: over.w ?? def.w,
        h,
        label,
        ...(over.style ? { style: over.style } : {}),
        ...(over.type ? { type: over.type } : {}),
        ...(over.tech ? { tech: over.tech } : {}),
        keywords: `${title} ${def.name} ${over.keywords ?? ""}`.toLowerCase(),
      };
    },
    icon(name: string, type: NodeType | null, icon: Glyph, over: { tech?: string; tint?: string; frame?: IconFrame; label?: string; keywords?: string } = {}): LibraryItem {
      const tint = over.tint ?? icons.tint;
      const frame = over.frame ?? icons.frame;
      return {
        kind: "component",
        key: `${lib}:${slug(name)}`,
        name,
        label: over.label ?? name,
        type,
        ...(over.tech ? { tech: over.tech } : {}),
        icon,
        ...(tint ? { tint } : {}),
        ...(frame ? { frame } : {}),
        keywords: `${name} ${over.tech ?? ""} ${type ?? ""} ${over.keywords ?? ""}`.toLowerCase(),
      };
    },
    group(name: string, over: { label?: string; zone?: ZoneKind; w?: number; h?: number; style?: NodeStyle; icon?: Glyph; tint?: string; lane?: boolean; keywords?: string } = {}): LibraryItem {
      return {
        kind: "zone",
        key: `${lib}:group-${slug(name)}`,
        name,
        label: over.label ?? name,
        zone: over.zone ?? "system",
        w: over.w ?? 360,
        h: over.h ?? 240,
        ...(over.style ? { style: over.style } : {}),
        ...(over.icon ? { icon: over.icon } : {}),
        ...(over.tint ? { tint: over.tint } : {}),
        ...(over.lane ? { lane: true } : {}),
        keywords: `${name} group container zone boundary ${over.keywords ?? ""}`.toLowerCase(),
      };
    },
    line(name: string, edge: ConnectorStyle, keywords = ""): LibraryItem {
      return { kind: "connector", key: `${lib}:line-${slug(name)}`, name, edge, keywords: `${name} connector line edge arrow ${keywords}`.toLowerCase() };
    },
  };
}

// --- standard libraries ------------------------------------------------------------------------

const general = (() => {
  const m = makers("general");
  return [
    m.shape("rect"),
    m.shape("rounded"),
    m.shape("text", "Text", { label: "Text" }),
    m.shape("text", "Textbox", { w: 180, h: 80, label: "Heading\nWrite a few lines here.", style: { align: "left", valign: "top" }, keywords: "paragraph" }),
    m.shape("ellipse"),
    m.shape("rect", "Square", { w: 80, h: 80 }),
    m.shape("ellipse", "Circle", { w: 80, h: 80 }),
    m.shape("process"),
    m.shape("diamond"),
    m.shape("parallelogram"),
    m.shape("hexagon"),
    m.shape("triangle"),
    m.shape("cylinder", "Cylinder", { keywords: "database db" }),
    m.shape("cloud"),
    m.shape("document"),
    m.shape("internal-storage"),
    m.shape("cube"),
    m.shape("step"),
    m.shape("trapezoid"),
    m.shape("tape"),
    m.shape("note"),
    m.shape("card"),
    m.shape("callout", "Callout", { keywords: "speech bubble" }),
    m.shape("actor", "Actor", { label: "Actor", keywords: "person user stick figure" }),
    m.group("Container", { label: "Container", w: 320, h: 200, style: { stroke: "#9AA5B1" } }),
    m.group("Swimlane", { label: "Lane", w: 360, h: 200, lane: true, keywords: "pool lane" }),
    m.line("Line", { endArrow: "none" }),
    m.line("Arrow", { endArrow: "arrow" }),
    m.line("Dashed arrow", { kind: "async", endArrow: "arrow" }),
    m.line("Bidirectional arrow", { startArrow: "arrow", endArrow: "arrow" }),
    m.line("Curved arrow", { line: "curved", endArrow: "arrow" }),
  ];
})();

const misc = (() => {
  const m = makers("misc");
  return [
    m.shape("text", "Heading", { w: 140, h: 40, label: "Heading", style: { fontSize: 20, bold: true }, keywords: "title" }),
    m.shape("text", "Link", { label: "Link", style: { fontColor: "#0B6BCB", underline: true }, keywords: "url hyperlink" }),
    m.shape("table", "Table", { label: "Name | Role | Team\nAda | Engineer | Core\nGrace | Designer | Web" }),
    m.shape("list", "List", { label: "List\nItem 1\nItem 2\nItem 3" }),
    m.shape("note", "Sticky note", { w: 140, h: 100, label: "Note", style: { fill: "#FFF2CC", stroke: "#D6B656" } }),
    m.shape("rect", "Dashed box", { style: { dashed: true } }),
    m.shape("rounded", "Highlight", { label: "Highlight", style: { fill: "#DAE8FC", stroke: "#6C8EBF" } }),
    m.shape("hline"),
    m.shape("vline"),
    m.shape("curly-left"),
    m.shape("curly-right"),
    m.shape("folder"),
    { kind: "note", key: "misc:note-box", name: "Text box", keywords: "note comment annotation text box" },
  ] satisfies LibraryItem[];
})();

const advanced = (() => {
  const m = makers("advanced");
  return [
    m.shape("corner"),
    m.shape("tee"),
    m.shape("datastore"),
    m.shape("data-storage"),
    m.shape("or"),
    m.shape("summing"),
    m.shape("sort"),
    m.shape("collate"),
    m.shape("delay"),
    m.shape("display"),
    m.shape("multi-document"),
    m.shape("direct-data", "Horizontal cylinder"),
    m.shape("sequential-data"),
    m.shape("off-page"),
    m.shape("loop-limit"),
    m.shape("double-rect"),
    m.shape("double-ellipse"),
    m.shape("terminator", "Stadium"),
    m.shape("annotation", "Annotation", { label: "Annotation" }),
  ];
})();

const basic = (() => {
  const m = makers("basic");
  return [
    m.shape("rect"),
    m.shape("rounded"),
    m.shape("octagon"),
    m.shape("pentagon"),
    m.shape("cube", "Isocube", { w: 80, h: 80 }),
    m.shape("cylinder"),
    m.shape("cone"),
    m.shape("pyramid"),
    m.shape("star"),
    m.shape("heart"),
    m.shape("moon"),
    m.shape("smiley"),
    m.shape("cross", "Plus"),
    m.shape("x"),
    m.shape("no"),
    m.shape("pie"),
    m.shape("donut"),
    m.shape("frame"),
    m.shape("lightning", "Flash"),
    m.shape("ellipse", "Circle", { w: 80, h: 80 }),
  ];
})();

const arrows = (() => {
  const m = makers("arrows");
  return [
    m.shape("arrow-right"),
    m.shape("arrow-left"),
    m.shape("arrow-up"),
    m.shape("arrow-down"),
    m.shape("arrow-double"),
    m.shape("arrow-double-v"),
    m.shape("arrow-quad"),
    m.shape("chevron"),
    m.shape("step"),
    m.shape("arrow-notched"),
    m.shape("arrow-callout"),
    m.line("Line", { endArrow: "none" }),
    m.line("Arrow", { endArrow: "arrow" }),
    m.line("Open arrow", { endArrow: "open" }),
    m.line("Bidirectional", { startArrow: "arrow", endArrow: "arrow" }),
    m.line("Dashed", { kind: "async", endArrow: "arrow" }),
    m.line("Dotted", { kind: "stream", endArrow: "arrow" }),
    m.line("Straight", { line: "straight", endArrow: "arrow" }),
    m.line("Curved", { line: "curved", endArrow: "arrow" }),
    m.line("Thick", { width: 3, endArrow: "arrow" }),
  ];
})();

const flowchart = (() => {
  const m = makers("flowchart");
  return [
    m.shape("rect", "Process"),
    m.shape("diamond", "Decision"),
    m.shape("terminator", "Terminator", { keywords: "start end" }),
    m.shape("parallelogram", "Data", { keywords: "input output" }),
    m.shape("process", "Predefined process", { keywords: "subroutine" }),
    m.shape("document"),
    m.shape("multi-document"),
    m.shape("manual-input"),
    m.shape("manual-operation"),
    m.shape("hexagon", "Preparation"),
    m.shape("delay"),
    m.shape("display"),
    m.shape("stored-data"),
    m.shape("internal-storage"),
    m.shape("direct-data"),
    m.shape("sequential-data"),
    m.shape("cylinder", "Database"),
    m.shape("card"),
    m.shape("tape", "Paper tape"),
    m.shape("off-page"),
    m.shape("ellipse", "On-page reference", { w: 40, h: 40 }),
    m.shape("loop-limit"),
    m.shape("collate"),
    m.shape("sort"),
    m.shape("extract"),
    m.shape("merge"),
    m.shape("or"),
    m.shape("summing"),
    m.shape("annotation", "Annotation", { label: "Annotation" }),
    m.line("Flow", { endArrow: "arrow" }),
  ];
})();

const er = (() => {
  const m = makers("er");
  return [
    m.shape("entity-table", "Table", { label: "Customer\nPK id\nname\nemail", keywords: "entity sql columns" }),
    m.shape("rect", "Entity", { label: "Entity" }),
    m.shape("double-rect", "Weak entity", { label: "Weak entity" }),
    m.shape("ellipse", "Attribute", { w: 100, h: 50, label: "Attribute" }),
    m.shape("ellipse", "Key attribute", { w: 100, h: 50, label: "Key", style: { underline: true } }),
    m.shape("double-ellipse", "Multivalued attribute", { w: 110, h: 54, label: "Attribute" }),
    m.shape("ellipse", "Derived attribute", { w: 100, h: 50, label: "Attribute", style: { dashed: true } }),
    m.shape("diamond", "Relationship", { w: 110, h: 70, label: "Relation" }),
    m.shape("double-diamond", "Identifying relationship", { w: 120, h: 76, label: "Relation" }),
    m.line("One to one", { startArrow: "er-one", endArrow: "er-one" }),
    m.line("One to many", { startArrow: "er-one", endArrow: "er-many" }),
    m.line("One to zero or many", { startArrow: "er-one", endArrow: "er-zero-many" }),
    m.line("One to one or many", { startArrow: "er-one", endArrow: "er-one-many" }),
    m.line("Zero or one to many", { startArrow: "er-zero-one", endArrow: "er-many" }),
    m.line("Many to many", { startArrow: "er-many", endArrow: "er-many" }),
  ];
})();

const uml = (() => {
  const m = makers("uml");
  return [
    m.shape("uml-class", "Class", { label: "Class\n+ field: Type\n--\n+ method(): Type" }),
    m.shape("uml-class", "Interface", { label: "«interface»\nName\n+ method(): Type" }),
    m.shape("folder", "Package", { label: "Package" }),
    m.shape("uml-component", "Component", { label: "Component" }),
    m.shape("cube", "Node", { label: "Node" }),
    m.shape("actor", "Actor", { label: "Actor" }),
    m.shape("ellipse", "Use case", { w: 140, h: 70, label: "Use case" }),
    m.shape("note", "Note", { w: 140, h: 70, label: "Note" }),
    m.shape("rect", "Object", { w: 140, h: 50, label: "object:Class", style: { underline: true } }),
    m.shape("uml-lifeline", "Lifeline", { label: ":Object" }),
    m.shape("rect", "Activation", { w: 10, h: 80 }),
    m.shape("uml-frame", "Frame", { label: "sd" }),
    m.shape("rounded", "State", { label: "State" }),
    m.shape("uml-initial"),
    m.shape("uml-final"),
    m.shape("diamond", "Choice", { w: 40, h: 40 }),
    m.shape("uml-fork"),
    m.line("Association", { endArrow: "none" }),
    m.line("Directed association", { endArrow: "open" }),
    m.line("Inheritance", { endArrow: "triangle" }, "generalization extends"),
    m.line("Realization", { kind: "async", endArrow: "triangle" }, "implements interface"),
    m.line("Dependency", { kind: "async", endArrow: "open" }, "uses"),
    m.line("Aggregation", { startArrow: "diamond-open", endArrow: "none" }),
    m.line("Composition", { startArrow: "diamond", endArrow: "none" }),
  ];
})();

// --- architecture -----------------------------------------------------------------------------

const architecture = (() => {
  const m = makers("arch");
  // Each pins the icon its type and name call for, so a "Function" stays a λ after a rename.
  const c = (name: string, type: NodeType, keywords = "") => m.icon(name, type, iconFor({ type, label: name }).glyph, { keywords });
  return [
    c("User", "client", "person actor customer"),
    c("Users", "client", "people actors customers"),
    c("Web app", "client", "browser frontend spa react next"),
    c("Mobile app", "client", "ios android phone"),
    c("API gateway", "gateway", "kong apigee bff ingress"),
    c("Load balancer", "gateway", "lb alb elb nginx haproxy envoy proxy"),
    c("CDN", "gateway", "cloudfront akamai fastly cloudflare edge"),
    c("Service", "service", "microservice api backend server container"),
    c("Function", "service", "lambda serverless faas cloud function"),
    c("Worker", "worker", "consumer job background celery sidekiq"),
    c("Scheduler", "worker", "cron timer batch periodic"),
    c("Database", "database", "sql postgres mysql mongo dynamodb rds"),
    c("Cache", "cache", "redis memcached valkey"),
    c("Object storage", "database", "s3 blob gcs bucket files"),
    c("Search index", "database", "elasticsearch opensearch solr"),
    c("Data warehouse", "database", "bigquery snowflake redshift analytics olap"),
    c("Queue", "queue", "sqs rabbitmq amqp broker"),
    c("Event stream", "queue", "kafka kinesis pulsar stream"),
    c("Pub/sub topic", "queue", "sns eventbridge topic event bus fanout"),
    c("Auth service", "service", "identity login sso oauth keycloak cognito"),
    c("ML model", "service", "inference ai llm recommendation"),
    c("External API", "external", "third party saas"),
    c("Payments", "external", "stripe paypal adyen billing"),
    c("Email / SMS", "external", "sendgrid twilio ses notification"),
    c("LLM API", "external", "openai anthropic claude gpt openrouter"),
    m.group("System", { zone: "system", keywords: "vpc cloud region" }),
    m.group("Clients", { zone: "clients", keywords: "users actors" }),
    m.group("External services", { zone: "external", keywords: "third party" }),
    { kind: "note", key: "arch:note", name: "Note", keywords: "note text comment annotation" },
    m.line("Sync call", { kind: "sync", endArrow: "arrow" }, "request response"),
    m.line("Async message", { kind: "async", endArrow: "arrow" }, "event fire and forget"),
    m.line("Stream", { kind: "stream", endArrow: "arrow" }, "continuous data"),
  ] satisfies LibraryItem[];
})();

const c4 = (() => {
  const m = makers("c4");
  const white = { fontColor: "#FFFFFF" };
  return [
    m.shape("c4-person", "Person", { label: "Person\n[Person]\nA user of the system.", type: "client", style: { ...white, fill: "#08427B", stroke: "#073B6F" } }),
    m.shape("c4-person", "External person", { label: "Person\n[Person]\nSomeone outside.", type: "client", style: { ...white, fill: "#6B6B6B", stroke: "#4D4D4D" } }),
    m.shape("rounded", "Software system", { w: 220, h: 120, label: "Software System\n[Software System]\nWhat it does.", type: "service", style: { ...white, fill: "#1168BD", stroke: "#0B4884" } }),
    m.shape("rounded", "External system", { w: 220, h: 120, label: "External System\n[Software System]\nWhat it does.", type: "external", style: { ...white, fill: "#999999", stroke: "#8A8A8A" } }),
    m.shape("rounded", "Container", { w: 220, h: 120, label: "Container\n[Container: Technology]\nWhat it does.", type: "service", style: { ...white, fill: "#438DD5", stroke: "#3C7FC0" } }),
    m.shape("cylinder", "Database container", { w: 160, h: 120, label: "Database\n[Container: Technology]", type: "database", style: { ...white, fill: "#438DD5", stroke: "#3C7FC0" } }),
    m.shape("direct-data", "Queue container", { w: 220, h: 80, label: "Queue\n[Container: Technology]", type: "queue", style: { ...white, fill: "#438DD5", stroke: "#3C7FC0" } }),
    m.shape("rounded", "Component", { w: 200, h: 110, label: "Component\n[Component: Technology]\nWhat it does.", type: "service", style: { fill: "#85BBF0", stroke: "#78A8D8", fontColor: "#000000" } }),
    m.group("System boundary", { label: "System boundary", w: 420, h: 280, style: { stroke: "#666666", dashed: true, fill: "none" } }),
    m.line("Relationship", { endArrow: "arrow" }, "uses"),
  ];
})();

// --- cloud providers ------------------------------------------------------------------------------

const AWS = { compute: "#ED7100", storage: "#7AA116", database: "#C925D1", network: "#8C4FFF", integration: "#E7157B", security: "#DD344C", ml: "#01A88D", analytics: "#8C4FFF" };

const aws = (() => {
  const m = makers("aws", { frame: "tile" });
  const plain = { frame: "plain" as const };
  return [
    m.icon("Users", "client", "users", plain),
    m.icon("Client", "client", "browser", plain),
    m.icon("Mobile client", "client", "mobile", plain),
    m.icon("EC2", "service", "chip", { tint: AWS.compute, tech: "Amazon EC2", keywords: "instance vm server" }),
    m.icon("Lambda", "service", "function", { tint: AWS.compute, tech: "AWS Lambda", keywords: "function serverless" }),
    m.icon("ECS", "service", "containers", { tint: AWS.compute, tech: "Amazon ECS", keywords: "container docker" }),
    m.icon("EKS", "service", "helm", { tint: AWS.compute, tech: "Amazon EKS", keywords: "kubernetes" }),
    m.icon("Fargate", "service", "containers", { tint: AWS.compute, tech: "AWS Fargate", keywords: "container serverless" }),
    m.icon("Batch", "worker", "worker", { tint: AWS.compute, tech: "AWS Batch", keywords: "jobs" }),
    m.icon("S3", "database", "bucket", { tint: AWS.storage, tech: "Amazon S3", keywords: "bucket object storage" }),
    m.icon("EFS", "database", "folder", { tint: AWS.storage, tech: "Amazon EFS", keywords: "file system nfs" }),
    m.icon("EBS", null, "disk", { tint: AWS.storage, tech: "Amazon EBS", keywords: "volume block storage" }),
    m.icon("RDS", "database", "database", { tint: AWS.database, tech: "Amazon RDS", keywords: "postgres mysql sql" }),
    m.icon("Aurora", "database", "database", { tint: AWS.database, tech: "Amazon Aurora", keywords: "postgres mysql sql" }),
    m.icon("DynamoDB", "database", "table", { tint: AWS.database, tech: "Amazon DynamoDB", keywords: "nosql key value" }),
    m.icon("ElastiCache", "cache", "cache", { tint: AWS.database, tech: "Amazon ElastiCache", keywords: "redis memcached" }),
    m.icon("Redshift", "database", "analytics", { tint: AWS.analytics, tech: "Amazon Redshift", keywords: "warehouse" }),
    m.icon("OpenSearch", "database", "search", { tint: AWS.analytics, tech: "Amazon OpenSearch", keywords: "elasticsearch search" }),
    m.icon("Athena", "service", "search", { tint: AWS.analytics, tech: "Amazon Athena", keywords: "query sql" }),
    m.icon("Kinesis", "queue", "stream", { tint: AWS.analytics, tech: "Amazon Kinesis", keywords: "stream" }),
    m.icon("MSK", "queue", "stream", { tint: AWS.analytics, tech: "Amazon MSK", keywords: "kafka stream" }),
    m.icon("API Gateway", "gateway", "gateway", { tint: AWS.network, tech: "Amazon API Gateway", keywords: "api rest" }),
    m.icon("CloudFront", "gateway", "cdn", { tint: AWS.network, tech: "Amazon CloudFront", keywords: "cdn edge" }),
    m.icon("Load balancer", "gateway", "loadbalancer", { tint: AWS.network, tech: "Elastic Load Balancing", keywords: "elb alb nlb" }),
    m.icon("Route 53", null, "dns", { tint: AWS.network, tech: "Amazon Route 53", keywords: "dns domain" }),
    m.icon("VPC", null, "cloud", { tint: AWS.network, tech: "Amazon VPC", keywords: "network" }),
    m.icon("SQS", "queue", "queue", { tint: AWS.integration, tech: "Amazon SQS", keywords: "queue" }),
    m.icon("SNS", "queue", "topic", { tint: AWS.integration, tech: "Amazon SNS", keywords: "topic pub sub notification" }),
    m.icon("EventBridge", "queue", "topic", { tint: AWS.integration, tech: "Amazon EventBridge", keywords: "event bus" }),
    m.icon("Step Functions", "service", "workflow", { tint: AWS.integration, tech: "AWS Step Functions", keywords: "workflow state machine" }),
    m.icon("SES", "external", "email", { tint: AWS.security, tech: "Amazon SES", keywords: "email" }),
    m.icon("Cognito", "service", "auth", { tint: AWS.security, tech: "Amazon Cognito", keywords: "auth login users" }),
    m.icon("IAM", null, "key", { tint: AWS.security, tech: "AWS IAM", keywords: "roles permissions" }),
    m.icon("Secrets Manager", null, "lock", { tint: AWS.security, tech: "AWS Secrets Manager", keywords: "secrets" }),
    m.icon("WAF", null, "firewall", { tint: AWS.security, tech: "AWS WAF", keywords: "firewall" }),
    m.icon("CloudWatch", null, "monitoring", { tint: AWS.integration, tech: "Amazon CloudWatch", keywords: "logs metrics monitoring" }),
    m.icon("SageMaker", "service", "ml", { tint: AWS.ml, tech: "Amazon SageMaker", keywords: "ml model" }),
    m.icon("Bedrock", "external", "ml", { tint: AWS.ml, tech: "Amazon Bedrock", keywords: "llm ai genai" }),
    m.group("AWS Cloud", { style: { stroke: "#232F3E", fill: "none" }, icon: "cloud", tint: "#232F3E", w: 560, h: 360 }),
    m.group("Region", { style: { stroke: "#00A4A6", dashed: true, fill: "none" }, w: 500, h: 320 }),
    m.group("VPC", { style: { stroke: "#8C4FFF", fill: "none" }, icon: "cloud", tint: "#8C4FFF", w: 440, h: 280 }),
    m.group("Availability Zone", { style: { stroke: "#00A4A6", dashed: true, fill: "none" }, w: 300, h: 240 }),
    m.group("Public subnet", { style: { stroke: "#7AA116", fill: "#F2F6E8" }, icon: "lock", tint: "#7AA116", w: 280, h: 200 }),
    m.group("Private subnet", { style: { stroke: "#00A4A6", fill: "#E6F6F7" }, icon: "lock", tint: "#00A4A6", w: 280, h: 200 }),
    m.group("Security group", { style: { stroke: "#DD344C", fill: "none" }, w: 260, h: 180 }),
    m.group("Auto Scaling group", { style: { stroke: "#ED7100", dashed: true, fill: "none" }, icon: "scale", tint: "#ED7100", w: 300, h: 180 }),
  ];
})();

const AZ = { compute: "#0078D4", data: "#0063B1", integration: "#5C2D91", security: "#B4009E", ai: "#00A2AD" };

const azure = (() => {
  const m = makers("azure", { frame: "tile" });
  return [
    m.icon("Users", "client", "users", { frame: "plain" }),
    m.icon("Virtual machine", "service", "desktop", { tint: AZ.compute, tech: "Azure Virtual Machines", keywords: "vm" }),
    m.icon("App Service", "service", "browser", { tint: AZ.compute, tech: "Azure App Service", keywords: "web app" }),
    m.icon("Functions", "service", "function", { tint: AZ.compute, tech: "Azure Functions", keywords: "serverless" }),
    m.icon("AKS", "service", "helm", { tint: AZ.compute, tech: "Azure Kubernetes Service", keywords: "kubernetes" }),
    m.icon("Container Apps", "service", "containers", { tint: AZ.compute, tech: "Azure Container Apps", keywords: "containers" }),
    m.icon("SQL Database", "database", "database", { tint: AZ.data, tech: "Azure SQL Database", keywords: "sql server" }),
    m.icon("Cosmos DB", "database", "database", { tint: AZ.data, tech: "Azure Cosmos DB", keywords: "nosql" }),
    m.icon("Cache for Redis", "cache", "cache", { tint: AZ.data, tech: "Azure Cache for Redis", keywords: "redis" }),
    m.icon("Blob Storage", "database", "bucket", { tint: AZ.data, tech: "Azure Blob Storage", keywords: "storage files" }),
    m.icon("Storage account", "database", "storage", { tint: AZ.data, tech: "Azure Storage", keywords: "storage" }),
    m.icon("Synapse", "database", "analytics", { tint: AZ.data, tech: "Azure Synapse Analytics", keywords: "warehouse" }),
    m.icon("Service Bus", "queue", "queue", { tint: AZ.integration, tech: "Azure Service Bus", keywords: "queue" }),
    m.icon("Event Hubs", "queue", "stream", { tint: AZ.integration, tech: "Azure Event Hubs", keywords: "stream kafka" }),
    m.icon("Event Grid", "queue", "topic", { tint: AZ.integration, tech: "Azure Event Grid", keywords: "events" }),
    m.icon("Logic Apps", "service", "workflow", { tint: AZ.integration, tech: "Azure Logic Apps", keywords: "workflow" }),
    m.icon("API Management", "gateway", "gateway", { tint: AZ.compute, tech: "Azure API Management", keywords: "api gateway" }),
    m.icon("Front Door", "gateway", "cdn", { tint: AZ.compute, tech: "Azure Front Door", keywords: "cdn edge" }),
    m.icon("Application Gateway", "gateway", "loadbalancer", { tint: AZ.compute, tech: "Azure Application Gateway", keywords: "load balancer waf" }),
    m.icon("Load balancer", "gateway", "loadbalancer", { tint: AZ.compute, tech: "Azure Load Balancer", keywords: "lb" }),
    m.icon("Entra ID", "service", "auth", { tint: AZ.security, tech: "Microsoft Entra ID", keywords: "active directory identity" }),
    m.icon("Key Vault", null, "key", { tint: AZ.security, tech: "Azure Key Vault", keywords: "secrets keys" }),
    m.icon("Monitor", null, "monitoring", { tint: AZ.ai, tech: "Azure Monitor", keywords: "logs metrics" }),
    m.icon("OpenAI", "external", "ml", { tint: AZ.ai, tech: "Azure OpenAI", keywords: "llm ai gpt" }),
    m.icon("Machine Learning", "service", "ml", { tint: AZ.ai, tech: "Azure Machine Learning", keywords: "ml model" }),
    m.icon("AI Search", "database", "search", { tint: AZ.ai, tech: "Azure AI Search", keywords: "search" }),
    m.group("Subscription", { style: { stroke: "#0078D4", fill: "none" }, w: 560, h: 360 }),
    m.group("Resource group", { style: { stroke: "#767676", dashed: true, fill: "none" }, w: 460, h: 300 }),
    m.group("Virtual network", { style: { stroke: "#0078D4", dashed: true, fill: "#F3F9FD" }, icon: "cloud", tint: "#0078D4", w: 400, h: 260 }),
    m.group("Subnet", { style: { stroke: "#50A0D8", dashed: true, fill: "none" }, w: 300, h: 200 }),
  ];
})();

const GCP = { blue: "#4285F4", green: "#34A853", red: "#EA4335", yellow: "#F9AB00" };

const gcp = (() => {
  const m = makers("gcp", { frame: "card", tint: GCP.blue });
  return [
    m.icon("Users", "client", "users", { frame: "plain" }),
    m.icon("Compute Engine", "service", "chip", { tech: "Compute Engine", keywords: "vm instance" }),
    m.icon("Cloud Run", "service", "containers", { tech: "Cloud Run", keywords: "containers serverless" }),
    m.icon("Cloud Functions", "service", "function", { tech: "Cloud Functions", keywords: "serverless" }),
    m.icon("GKE", "service", "helm", { tech: "Google Kubernetes Engine", keywords: "kubernetes" }),
    m.icon("App Engine", "service", "service", { tech: "App Engine", keywords: "paas" }),
    m.icon("Cloud SQL", "database", "database", { tint: GCP.green, tech: "Cloud SQL", keywords: "postgres mysql" }),
    m.icon("Spanner", "database", "database", { tint: GCP.green, tech: "Cloud Spanner", keywords: "sql" }),
    m.icon("Firestore", "database", "table", { tint: GCP.green, tech: "Firestore", keywords: "nosql documents" }),
    m.icon("Bigtable", "database", "table", { tint: GCP.green, tech: "Cloud Bigtable", keywords: "nosql wide column" }),
    m.icon("Memorystore", "cache", "cache", { tint: GCP.green, tech: "Memorystore", keywords: "redis" }),
    m.icon("Cloud Storage", "database", "bucket", { tint: GCP.green, tech: "Cloud Storage", keywords: "gcs bucket" }),
    m.icon("BigQuery", "database", "analytics", { tint: GCP.yellow, tech: "BigQuery", keywords: "warehouse analytics" }),
    m.icon("Dataflow", "worker", "stream", { tint: GCP.yellow, tech: "Dataflow", keywords: "beam stream batch" }),
    m.icon("Pub/Sub", "queue", "topic", { tech: "Pub/Sub", keywords: "messaging topic" }),
    m.icon("Cloud Tasks", "queue", "queue", { tech: "Cloud Tasks", keywords: "queue" }),
    m.icon("Cloud Scheduler", "worker", "scheduler", { tech: "Cloud Scheduler", keywords: "cron" }),
    m.icon("Load Balancing", "gateway", "loadbalancer", { tech: "Cloud Load Balancing", keywords: "lb" }),
    m.icon("Cloud CDN", "gateway", "cdn", { tech: "Cloud CDN", keywords: "cdn" }),
    m.icon("API Gateway", "gateway", "gateway", { tech: "API Gateway", keywords: "api" }),
    m.icon("Apigee", "gateway", "gateway", { tech: "Apigee", keywords: "api management" }),
    m.icon("Cloud DNS", null, "dns", { tech: "Cloud DNS", keywords: "dns" }),
    m.icon("Identity Platform", "service", "auth", { tint: GCP.red, tech: "Identity Platform", keywords: "auth login" }),
    m.icon("IAM", null, "key", { tint: GCP.red, tech: "Cloud IAM", keywords: "roles" }),
    m.icon("Secret Manager", null, "lock", { tint: GCP.red, tech: "Secret Manager", keywords: "secrets" }),
    m.icon("Vertex AI", "service", "ml", { tech: "Vertex AI", keywords: "ml ai gemini" }),
    m.icon("Cloud Monitoring", null, "monitoring", { tech: "Cloud Monitoring", keywords: "logs metrics" }),
    m.group("Google Cloud", { style: { stroke: "#4285F4", fill: "none" }, icon: "cloud", tint: "#4285F4", w: 560, h: 360 }),
    m.group("Project", { style: { stroke: "#9AA0A6", fill: "#F8F9FA" }, w: 460, h: 300 }),
    m.group("VPC network", { style: { stroke: "#4285F4", dashed: true, fill: "none" }, w: 400, h: 260 }),
    m.group("Region", { style: { stroke: "#9AA0A6", dashed: true, fill: "none" }, w: 340, h: 220 }),
  ];
})();

const k8s = (() => {
  const m = makers("k8s", { frame: "heptagon", tint: "#326CE5" });
  return [
    m.icon("User", "client", "user", { frame: "plain" }),
    m.icon("Pod", "service", "service", { tech: "Kubernetes Pod" }),
    m.icon("Deployment", "service", "layers", { tech: "Kubernetes Deployment", keywords: "deploy" }),
    m.icon("ReplicaSet", "service", "layers", { tech: "Kubernetes ReplicaSet", keywords: "rs" }),
    m.icon("StatefulSet", "database", "database", { tech: "Kubernetes StatefulSet", keywords: "sts stateful" }),
    m.icon("DaemonSet", "service", "layers", { tech: "Kubernetes DaemonSet", keywords: "ds" }),
    m.icon("Job", "worker", "worker", { tech: "Kubernetes Job" }),
    m.icon("CronJob", "worker", "scheduler", { tech: "Kubernetes CronJob", keywords: "cron schedule" }),
    m.icon("Service", "gateway", "loadbalancer", { tech: "Kubernetes Service", keywords: "svc" }),
    m.icon("Ingress", "gateway", "ingress", { tech: "Kubernetes Ingress", keywords: "ing nginx" }),
    m.icon("ConfigMap", null, "document", { tech: "Kubernetes ConfigMap", keywords: "cm config" }),
    m.icon("Secret", null, "lock", { tech: "Kubernetes Secret" }),
    m.icon("Persistent volume", null, "disk", { tech: "Kubernetes PersistentVolume", keywords: "pv storage" }),
    m.icon("Volume claim", null, "storage", { tech: "Kubernetes PersistentVolumeClaim", keywords: "pvc" }),
    m.icon("Namespace", null, "namespace", { tech: "Kubernetes Namespace", keywords: "ns" }),
    m.icon("Node", null, "server", { tech: "Kubernetes Node", keywords: "worker machine" }),
    m.icon("Autoscaler", null, "scale", { tech: "HorizontalPodAutoscaler", keywords: "hpa scaling" }),
    m.icon("Control plane", null, "helm", { tech: "Kubernetes control plane", keywords: "api server master" }),
    m.group("Cluster", { style: { stroke: "#326CE5", fill: "#F5F8FE" }, icon: "helm", tint: "#326CE5", w: 560, h: 360 }),
    m.group("Namespace", { style: { stroke: "#326CE5", dashed: true, fill: "none" }, w: 420, h: 280 }),
    m.group("Node", { style: { stroke: "#7F8C8D", fill: "none" }, icon: "server", tint: "#7F8C8D", w: 320, h: 220 }),
  ];
})();

const network = (() => {
  const m = makers("net", { frame: "plain" });
  return [
    m.icon("Internet", "external", "cloud", { keywords: "cloud wan" }),
    m.icon("Firewall", null, "firewall"),
    m.icon("Router", null, "router"),
    m.icon("Switch", null, "switch"),
    m.icon("Load balancer", "gateway", "loadbalancer", { keywords: "lb" }),
    m.icon("Server", "service", "server"),
    m.icon("Database server", "database", "database", { keywords: "db" }),
    m.icon("Storage", null, "storage", { keywords: "nas san" }),
    m.icon("Desktop", "client", "desktop", { keywords: "pc workstation" }),
    m.icon("Laptop", "client", "laptop"),
    m.icon("Phone", "client", "mobile", { keywords: "mobile" }),
    m.icon("Tablet", "client", "tablet"),
    m.icon("Printer", null, "printer"),
    m.icon("Wireless AP", null, "wifi", { keywords: "wifi access point" }),
    m.icon("Users", "client", "users"),
    m.icon("DNS", null, "dns"),
    m.group("Network", { style: { stroke: "#545B64", dashed: true, fill: "none" }, keywords: "lan subnet" }),
    m.group("DMZ", { style: { stroke: "#DD344C", dashed: true, fill: "none" } }),
  ];
})();

export const LIBRARIES: Library[] = [
  { id: "general", title: "General", group: "Standard", description: "Rectangles, ellipses, text, containers and the other basics.", items: general },
  { id: "misc", title: "Misc", group: "Standard", description: "Headings, links, tables, lists, lines and braces.", items: misc },
  { id: "advanced", title: "Advanced", group: "Standard", description: "Data stores, corners, tees and less common outlines.", items: advanced },
  { id: "basic", title: "Basic", group: "Standard", description: "Polygons, stars, hearts and other simple figures.", items: basic },
  { id: "arrows", title: "Arrows", group: "Standard", description: "Block arrows and connector styles.", items: arrows },
  { id: "flowchart", title: "Flowchart", group: "Standard", description: "The standard flowchart symbols.", items: flowchart },
  { id: "er", title: "Entity Relation", group: "Standard", description: "Tables, entities, attributes and crow's foot connectors.", items: er },
  { id: "uml", title: "UML", group: "Standard", description: "Classes, components, sequence and state diagram shapes.", items: uml },
  {
    id: "architecture",
    title: "Architecture",
    group: "Software",
    description: "Components the reviewer understands: clients, gateways, services, data stores, queues and outside services.",
    items: architecture,
  },
  { id: "c4", title: "C4", group: "Software", description: "People, software systems, containers and components (reviewed).", items: c4 },
  { id: "aws", title: "AWS", group: "Cloud", description: "AWS services and groups (VPC, subnets, regions).", items: aws },
  { id: "azure", title: "Azure", group: "Cloud", description: "Azure services and groups.", items: azure },
  { id: "gcp", title: "Google Cloud", group: "Cloud", description: "Google Cloud services and groups.", items: gcp },
  { id: "k8s", title: "Kubernetes", group: "Cloud", description: "Kubernetes resources and clusters.", items: k8s },
  { id: "network", title: "Network", group: "Networking", description: "Routers, switches, firewalls, servers and devices.", items: network },
];

/** What draw.io shows out of the box, plus the components the reviewer reads. */
export const DEFAULT_LIBRARIES = ["general", "misc", "advanced", "basic", "arrows", "flowchart", "er", "uml", "architecture"];

const ITEMS = new Map(LIBRARIES.flatMap((l) => l.items).map((i) => [i.key, i]));

export function libraryItem(key: string): LibraryItem | undefined {
  return ITEMS.get(key);
}

/** Size of what an item adds. */
export function itemSize(item: LibraryItem): { w: number; h: number } {
  switch (item.kind) {
    case "shape":
    case "zone":
      return { w: item.w, h: item.h };
    case "note":
      return { w: 200, h: 64 };
    default:
      return { w: 64, h: 64 };
  }
}

/** A new diagram node for a library item, with its top-left corner at `at`. Connector items add none. */
export function nodeFromItem(item: LibraryItem, at: { x: number; y: number }, parent: string | null = null): DiagramNode | null {
  const base = { id: newDiagramId(), x: Math.round(at.x), y: Math.round(at.y), parent };
  switch (item.kind) {
    case "shape":
      return {
        ...base,
        kind: "shape",
        shape: item.shape,
        w: item.w,
        h: item.h,
        label: item.label,
        ...(item.style ? { style: { ...item.style } } : {}),
        ...(item.type ? { type: item.type, origin: "user" as const, confidence: 1 } : {}),
        ...(item.tech ? { tech: item.tech } : {}),
      };
    case "component":
      return {
        ...base,
        kind: "component",
        label: item.label,
        type: item.type,
        icon: item.icon,
        ...(item.tech ? { tech: item.tech } : {}),
        ...(item.tint ? { tint: item.tint } : {}),
        ...(item.frame ? { frame: item.frame } : {}),
        origin: "user",
        confidence: 1,
      };
    case "zone":
      return {
        ...base,
        kind: "zone",
        label: item.label,
        zone: item.zone,
        w: item.w,
        h: item.h,
        ...(item.style ? { style: { ...item.style } } : {}),
        ...(item.icon ? { icon: item.icon } : {}),
        ...(item.tint ? { tint: item.tint } : {}),
        ...(item.lane ? { shape: "swimlane" } : {}),
      };
    case "note":
      return { ...base, kind: "note", label: "Note", w: 200, h: 64 };
    case "connector":
      return null;
  }
}

/** Library items to search: name and keywords contain every word of the query. */
export function searchLibraries(query: string, limit = 80): LibraryItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const seen = new Set<string>();
  const out: LibraryItem[] = [];
  for (const lib of LIBRARIES) {
    for (const item of lib.items) {
      const hay = `${item.name.toLowerCase()} ${item.keywords} ${lib.title.toLowerCase()}`;
      // The same outline in several libraries shows once.
      const dedupe = item.kind === "shape" ? `${item.shape}|${item.label}|${JSON.stringify(item.style ?? {})}|${item.w}x${item.h}` : item.key;
      if (words.every((w) => hay.includes(w)) && !seen.has(dedupe)) {
        seen.add(dedupe);
        out.push(item);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
