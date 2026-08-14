import { useQuery } from "@tanstack/react-query";
import { Cpu, HardDrive, MemoryStick } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  getNode,
  getSandbox,
  getServer,
} from "../../api";
import type { Node, Sandbox, Server } from "../../api";
import { APPLE_LOGO, OS_RELEASES } from "../../image-catalog";
import { NodeIcon } from "../node-icon";
import { ResourceMetrics } from "./resource-metrics";
import styles from "./resource-detail-page.module.css";

type ResourceKind = "server" | "sandbox";
type Resource = Server | Sandbox;
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const GIBIBYTE = 1024 ** 3;
const TEBIBYTE = 1024 ** 4;

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function createdAt(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function resourceAge(value: string) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hr`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) return `${elapsedDays} ${elapsedDays === 1 ? "day" : "days"}`;
  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${elapsedMonths} ${elapsedMonths === 1 ? "month" : "months"}`;
  const elapsedYears = Math.floor(elapsedDays / 365);
  return `${elapsedYears} ${elapsedYears === 1 ? "year" : "years"}`;
}

function formatBytes(bytes: number) {
  if (bytes >= TEBIBYTE) return `${number.format(bytes / TEBIBYTE)} TB`;
  return `${number.format(bytes / GIBIBYTE)} GB`;
}

function resourceName(kind: ResourceKind, resource: Resource) {
  return kind === "server" ? (resource as Server).name : resource.id;
}

function ResourceDetails({ resource }: { resource: Resource }) {
  const status = resource.deleted_at === null ? statusLabel(resource.status) : "Deleted";
  return (
    <section className={styles.detailsSection}>
      <h2>Resource</h2>
      <dl className={styles.detailsList}>
        <div><dt>Status</dt><dd>{status}</dd></div>
        <div><dt>Created</dt><dd>{createdAt(resource.created_at)}</dd></div>
        {resource.deleted_at !== null && <div><dt>Deleted</dt><dd>{createdAt(resource.deleted_at)}</dd></div>}
        <div><dt>Age</dt><dd>{resourceAge(resource.created_at)}</dd></div>
      </dl>
    </section>
  );
}

function ResourceStat({
  icon,
  title,
  value,
  unit,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  unit: string;
}) {
  return (
    <div className={styles.allocationStat}>
      <div className={styles.cardTitle}>{icon}<h2>{title}</h2></div>
      <div className={styles.metricValue}><strong>{value}</strong><span>{unit}</span></div>
    </div>
  );
}

function ResourceStats({ node, storageUsedBytes }: { node: Node; storageUsedBytes: number | null }) {
  if (node.configuration === null) {
    return (
      <section className={styles.allocationBand}>
        <h2>Resources</h2>
        <p className={styles.unavailable}>Resource data is unavailable.</p>
      </section>
    );
  }

  const { configuration } = node;

  return (
    <section className={`${styles.allocationBand} ${storageUsedBytes === null ? styles.twoStats : ""}`}>
      <ResourceStat
        icon={<Cpu size={15} />}
        title="CPU"
        value={String(configuration.sandbox_cpu_count)}
        unit="cores"
      />
      <ResourceStat
        icon={<MemoryStick size={15} />}
        title="Memory"
        value={formatBytes(configuration.sandbox_memory_bytes)}
        unit="memory"
      />
      {storageUsedBytes !== null && (
        <ResourceStat
          icon={<HardDrive size={15} />}
          title="Storage"
          value={formatBytes(storageUsedBytes)}
          unit="used"
        />
      )}
    </section>
  );
}

function OperatingSystem({ image }: { image: string }) {
  const release = OS_RELEASES.find((item) => image.includes(item.id));
  if (release === undefined) throw new Error(`Unknown server image: ${image}`);
  return (
    <section className={styles.operatingSystem}>
      <span className={styles.operatingSystemIcon}><img src={APPLE_LOGO} alt="" /></span>
      <span className={styles.operatingSystemCopy}>
        <small>Operating system</small>
        <strong>{release.version} {release.name}</strong>
      </span>
    </section>
  );
}

type ResourceTab = "overview" | "metrics";

function ResourceDetailPage({ kind, id, tab }: { kind: ResourceKind; id: string; tab: ResourceTab }) {
  const parentPath = kind === "server" ? "/servers" : "/sandboxes";
  const parentLabel = kind === "server" ? "Servers" : "Sandboxes";
  const detail = useQuery({
    queryKey: [kind, id, "detail"],
    queryFn: async () => {
      const resource = kind === "server" ? await getServer(id) : await getSandbox(id);
      const node = await getNode(resource.node_id);
      return {
        resource,
        node,
        storageUsedBytes: resource.storage_used_bytes,
      };
    },
  });

  if (detail.status === "pending") {
    return <section className={styles.state}>Loading resource…</section>;
  }

  if (detail.error) {
    return <section className={`${styles.state} ${styles.error}`} role="alert">{detail.error.message}</section>;
  }

  const { resource, node, storageUsedBytes } = detail.data;
  const server = kind === "server" ? resource as Server : null;
  const running = resource.deleted_at === null
    && (kind === "server" ? resource.status === "running" : resource.status === "active");

  return (
    <section className={styles.page}>
      <div className={styles.chrome}>
        <div className={styles.chromeInner}>
          <Link className={styles.backlink} to={parentPath}>← {parentLabel}</Link>
          <div className={styles.titleRow}>
            <h1>{resourceName(kind, resource)}</h1>
            <Link className={styles.headerNodeLink} to={`/nodes/${node.id}`}>
              <NodeIcon size={14} />
              <span>{node.name}</span>
              <span className={styles.nodeLinkArrow} aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </div>
      <div className={styles.layout}>
        <aside className={styles.rail}>
          <Link to={parentPath + `/${id}`} aria-current={tab === "overview" ? "page" : undefined}>Overview</Link>
          <Link to={parentPath + `/${id}/metrics`} aria-current={tab === "metrics" ? "page" : undefined}>Metrics</Link>
        </aside>
        <main className={styles.content}>
          <div className={styles.contentInner}>
            {tab === "overview" ? (
              <>
                <ResourceStats node={node} storageUsedBytes={storageUsedBytes} />
                <ResourceDetails resource={resource} />
                {server !== null && server.config !== null && <OperatingSystem image={server.config.image} />}
              </>
            ) : (
              <ResourceMetrics
                kind={kind}
                id={id}
                running={running}
              />
            )}
          </div>
        </main>
      </div>
    </section>
  );
}

export function ServerDetailPage() {
  const { serverId } = useParams<{ serverId: string }>();
  if (serverId === undefined) throw new Error("The server route requires a server ID.");
  return <ResourceDetailPage kind="server" id={serverId} tab="overview" />;
}

export function ServerMetricsPage() {
  const { serverId } = useParams<{ serverId: string }>();
  if (serverId === undefined) throw new Error("The server route requires a server ID.");
  return <ResourceDetailPage kind="server" id={serverId} tab="metrics" />;
}

export function SandboxDetailPage() {
  const { sandboxId } = useParams<{ sandboxId: string }>();
  if (sandboxId === undefined) throw new Error("The sandbox route requires a sandbox ID.");
  return <ResourceDetailPage kind="sandbox" id={sandboxId} tab="overview" />;
}

export function SandboxMetricsPage() {
  const { sandboxId } = useParams<{ sandboxId: string }>();
  if (sandboxId === undefined) throw new Error("The sandbox route requires a sandbox ID.");
  return <ResourceDetailPage kind="sandbox" id={sandboxId} tab="metrics" />;
}
