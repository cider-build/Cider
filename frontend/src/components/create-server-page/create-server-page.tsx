import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { createServer, listNodes } from "../../api";
import type { Node as CiderNode } from "../../api";
import {
  OPENCLAW_CHANNELS,
  OS_RELEASES,
  SOFTWARE,
  VARIANTS,
  imageReference,
} from "../../image-catalog";
import type { ChannelId, OsId, SoftwareId, VariantId } from "../../image-catalog";
import { Button } from "../button/button";
import { PageHeader } from "../page-header/page-header";
import styles from "./create-server-page.module.css";

const APPLE_LOGO = "https://svgl.app/library/apple.svg";
const XCODE_LOGO = "https://developer.apple.com/assets/elements/icons/xcode/xcode-128x128_2x.png";

const SOFTWARE_META: Record<SoftwareId, { blurb: string; logo: string | null }> = {
  "claude-code": { blurb: "Anthropic's coding agent", logo: "https://svgl.app/library/claude-ai-icon.svg" },
  codex: { blurb: "OpenAI's coding agent", logo: "https://svgl.app/library/openai.svg" },
  cursor: { blurb: "The AI code editor", logo: "https://cdn.simpleicons.org/cursor/000000" },
  openclaw: { blurb: "Your personal AI assistant", logo: null },
};

const CHANNEL_LOGOS: Record<ChannelId, string | null> = {
  imessage: "https://cdn.simpleicons.org/imessage/34DA50",
  webchat: null,
  telegram: "https://cdn.simpleicons.org/telegram/26A5E4",
  discord: "https://cdn.simpleicons.org/discord/5865F2",
  slack: "https://svgl.app/library/slack.svg",
  whatsapp: "https://cdn.simpleicons.org/whatsapp/25D366",
};

function channelIcon(id: ChannelId) {
  const logo = CHANNEL_LOGOS[id];
  if (logo) return <img src={logo} alt="" />;
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function nodeSub(node: CiderNode) {
  return node.metadata ? `${node.metadata.chip}, macOS ${node.metadata.macos_version}` : "Connected";
}

function toggled<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function NodePicker({
  nodes,
  value,
  onChange,
}: {
  nodes: CiderNode[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as HTMLElement)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setUp(false);
      return;
    }
    // Flip the menu upward when the viewport doesn't have room below the
    // trigger (the Node field sits at the bottom of the create page).
    // Re-evaluated on every open, after the list is built.
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (trigger && menu) {
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setUp(spaceBelow < menu.offsetHeight + 12);
    }
    searchRef.current?.focus();
  }, [open]);

  const selected = value === null ? null : nodes.find((node) => node.id === value) ?? null;
  const trimmed = query.trim().toLowerCase();
  const matches = nodes.filter((node) => {
    if (trimmed === "") return true;
    const haystack = `${node.name} ${node.metadata ? `${node.metadata.chip} macos ${node.metadata.macos_version}` : ""}`;
    return haystack.toLowerCase().includes(trimmed);
  });

  function toggle() {
    if (!open) setQuery("");
    setOpen(!open);
  }

  function pick(id: string | null) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div className={styles.nodeSelect} ref={rootRef}>
      <button
        type="button"
        className={styles.nodeTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        ref={triggerRef}
        onClick={toggle}
      >
        <span className={styles.nodeVal}>
          {selected ? (
            <>
              {selected.name} <span>{nodeSub(selected)}</span>
            </>
          ) : (
            <>
              Automatic <span>— first Mac with free capacity</span>
            </>
          )}
        </span>
        <span className={styles.caret} aria-hidden="true">
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 1l4 4 4-4" />
          </svg>
        </span>
      </button>
      {open && (
        <div className={up ? `${styles.nodeMenu} ${styles.up}` : styles.nodeMenu} ref={menuRef}>
          <div className={styles.nodeSearch}>
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="text"
              placeholder="Search nodes"
              autoComplete="off"
              spellCheck={false}
              aria-label="Filter nodes"
            />
          </div>
          <div className={styles.nodeList} role="listbox">
            <button
              type="button"
              role="option"
              className={styles.nodeRow}
              aria-selected={value === null}
              onClick={() => pick(null)}
            >
              <span className={styles.nodeText}>
                <strong>Automatic</strong>
                <span className={styles.nodeRowSub}>First Mac with free capacity</span>
              </span>
            </button>
            {matches.map((node) => (
              <button
                key={node.id}
                type="button"
                role="option"
                className={styles.nodeRow}
                aria-selected={value === node.id}
                disabled={!node.connected}
                onClick={() => pick(node.id)}
              >
                <span className={styles.nodeText}>
                  <strong>{node.name}</strong>
                  <span className={styles.nodeRowSub}>{nodeSub(node)}</span>
                </span>
                {!node.connected && <span className={styles.nodeRight}>Offline</span>}
              </button>
            ))}
            {matches.length === 0 && trimmed !== "" && (
              <div className={styles.nodeEmpty}>No Macs match “{query.trim()}”</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CreateServerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [os, setOs] = useState<OsId>("tahoe");
  const [variant, setVariant] = useState<VariantId>("vanilla");
  const [software, setSoftware] = useState<SoftwareId[]>([]);
  const [channels, setChannels] = useState<ChannelId[]>(["imessage", "webchat"]);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const nodes = useQuery({ queryKey: ["nodes", 1, ""], queryFn: () => listNodes({ page: 1, search: "" }) });
  const create = useMutation({
    mutationFn: createServer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
      navigate("/servers");
    },
  });

  const openclawSelected = software.includes("openclaw");
  const allNodes = nodes.data?.items ?? [];
  const selectedNode = nodeId === null ? null : allNodes.find((node) => node.id === nodeId) ?? null;

  function submit() {
    create.mutate({
      name: name.trim(),
      node_id: nodeId,
      image: {
        os,
        variant,
        software,
        openclaw_channels: openclawSelected ? channels : [],
      },
    });
  }

  const softwareNames = SOFTWARE.filter((item) => software.includes(item.id)).map((item) => item.name);
  const channelNames = OPENCLAW_CHANNELS.filter((channel) => channels.includes(channel.id)).map(
    (channel) => channel.name,
  );

  return (
    <section className={styles.page}>
      <Link className={styles.backlink} to="/servers">
        ← Servers
      </Link>
      <PageHeader title="New server" lede="A Mac that keeps running until you stop it." />
      <div className={styles.createGrid}>
        <div className={styles.sections}>
          <section className={styles.fpanel}>
            <h3>Name</h3>
            <p className={styles.desc}>A durable, restartable Mac — unlike sandboxes, servers keep their state.</p>
            <input
              className={styles.nameInput}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-server"
              maxLength={63}
              autoComplete="off"
              spellCheck={false}
            />
          </section>
          <section className={styles.fpanel}>
            <h3>macOS</h3>
            <p className={styles.desc}>
              Pulled from the public registry to the node on first use, then cached — later servers clone locally in
              seconds.
            </p>
            <div className={styles.osGrid} role="radiogroup" aria-label="macOS version">
              {OS_RELEASES.map((release) => (
                <button
                  key={release.id}
                  type="button"
                  role="radio"
                  aria-checked={os === release.id}
                  className={styles.osCard}
                  onClick={() => setOs(release.id)}
                >
                  <img src={APPLE_LOGO} alt="" />
                  <span className={styles.osVersion}>{release.version}</span>
                  <span className={styles.osName}>
                    {release.name}, {release.year}
                  </span>
                </button>
              ))}
            </div>
            <div className={styles.rowList} role="radiogroup" aria-label="Image variant">
              {VARIANTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={variant === item.id}
                  className={styles.rowItem}
                  onClick={() => setVariant(item.id)}
                >
                  <span className={styles.rowIc}>
                    <img src={item.id === "xcode" ? XCODE_LOGO : APPLE_LOGO} alt="" />
                  </span>
                  <span className={styles.rowText}>
                    <strong>{item.name}</strong>
                    <span>{item.description}</span>
                  </span>
                  <span className={styles.radioMark} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
          <section className={styles.fpanel}>
            <h3>Software</h3>
            <p className={styles.desc}>
              Installed when the image is first prepared on the node, so every server gets the latest version.
            </p>
            <div className={styles.softList}>
              {SOFTWARE.map((item) => (
                <Fragment key={item.id}>
                  <button
                    type="button"
                    aria-pressed={software.includes(item.id)}
                    className={styles.softRow}
                    onClick={() => setSoftware((current) => toggled(current, item.id))}
                  >
                    <span className={styles.softIc}>
                      {SOFTWARE_META[item.id].logo ? <img src={SOFTWARE_META[item.id].logo ?? ""} alt="" /> : "🦞"}
                    </span>
                    <span className={styles.softText}>
                      <strong>{item.name}</strong>
                      <span>{SOFTWARE_META[item.id].blurb}</span>
                    </span>
                    <span className={styles.check} aria-hidden="true">
                      ✓
                    </span>
                  </button>
                  {item.id === "openclaw" && openclawSelected && (
                    <div className={styles.chanSub}>
                      <p>Where you’ll talk to OpenClaw</p>
                      <div className={styles.chips}>
                        {OPENCLAW_CHANNELS.map((channel) => (
                          <button
                            key={channel.id}
                            type="button"
                            aria-pressed={channels.includes(channel.id)}
                            className={styles.chip}
                            onClick={() => setChannels((current) => toggled(current, channel.id))}
                          >
                            {channelIcon(channel.id)}
                            {channel.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </section>
          <section className={styles.fpanel}>
            <h3>Node</h3>
            <p className={styles.desc}>Which Mac runs this server. Search by name, chip or macOS version.</p>
            <NodePicker nodes={allNodes} value={nodeId} onChange={setNodeId} />
          </section>
        </div>
        <aside className={styles.stage}>
          <div className={styles.sumcard}>
            <h3>Summary</h3>
            <dl className={styles.sumlist}>
              <div>
                <dt>Name</dt>
                <dd className={name.trim() === "" ? styles.ghost : undefined}>{name.trim() || "my-server"}</dd>
              </div>
              <div>
                <dt>Base image</dt>
                <dd>
                  <code>{imageReference(os, variant)}</code>
                </dd>
              </div>
              <div>
                <dt>Software</dt>
                <dd>{softwareNames.length === 0 ? "None" : softwareNames.join(", ")}</dd>
              </div>
              {openclawSelected && (
                <div>
                  <dt>Channels</dt>
                  <dd>{channelNames.length === 0 ? "None" : channelNames.join(", ")}</dd>
                </div>
              )}
              <div>
                <dt>Node</dt>
                <dd>{nodeId === null ? "Automatic" : selectedNode?.name ?? "—"}</dd>
              </div>
            </dl>
            {create.error && (
              <p className={styles.error} role="alert">
                {create.error.message}
              </p>
            )}
            <div className={styles.submit}>
              <Button
                styleType={Button.Style.Primary}
                type="button"
                onClick={submit}
                disabled={create.isPending || name.trim() === ""}
              >
                {create.isPending ? "Creating…" : "Create server"}
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
