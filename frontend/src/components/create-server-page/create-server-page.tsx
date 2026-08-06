import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { createServer, listAllNodes } from "../../api";
import type { Node as CiderNode } from "../../api";
import {
  OPENCLAW_CHANNELS,
  OS_RELEASES,
  SOFTWARE,
  VARIANTS,
  APPLE_LOGO,
  XCODE_LOGO,
  imageReference,
} from "../../image-catalog";
import type { ChannelId, OsId, SoftwareId, VariantId } from "../../image-catalog";
import { Button } from "../button/button";
import { PageHeader } from "../page-header/page-header";
import styles from "./create-server-page.module.css";

function channelIcon(id: ChannelId) {
  const logo = OPENCLAW_CHANNELS.find((channel) => channel.id === id)!.logo;
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

  const selected = value === null ? null : nodes.find((node) => node.id === value) ?? null;
  const trimmed = query.trim().toLowerCase();
  const matches = nodes.filter((node) => {
    if (trimmed === "") return true;
    const haystack = `${node.name} ${node.metadata ? `${node.metadata.chip} macos ${node.metadata.macos_version}` : ""}`;
    return haystack.toLowerCase().includes(trimmed);
  });

  function toggle() {
    if (!open) {
      setQuery("");
      const trigger = triggerRef.current;
      setUp(trigger !== null && window.innerHeight - trigger.getBoundingClientRect().bottom < 300);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
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
        <div className={up ? `${styles.nodeMenu} ${styles.up}` : styles.nodeMenu}>
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

const PROVIDER_KEYS: Array<{ id: string; name: string; placeholder: string }> = [
  { id: "ANTHROPIC_API_KEY", name: "Anthropic", placeholder: "sk-ant-…" },
  { id: "OPENAI_API_KEY", name: "OpenAI", placeholder: "sk-…" },
  { id: "OPENROUTER_API_KEY", name: "OpenRouter", placeholder: "sk-or-…" },
  { id: "GROQ_API_KEY", name: "Groq", placeholder: "gsk-…" },
  { id: "XAI_API_KEY", name: "xAI", placeholder: "xai-…" },
];

export function CreateServerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [os, setOs] = useState<OsId>("tahoe");
  const [variant, setVariant] = useState<VariantId>("vanilla");
  const [software, setSoftware] = useState<SoftwareId[]>([]);
  const [channels, setChannels] = useState<ChannelId[]>(["imessage", "webchat"]);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [addedKeys, setAddedKeys] = useState<string[]>([]);
  const [keyMenuOpen, setKeyMenuOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const keyMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!keyMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      const root = keyMenuRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) setKeyMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [keyMenuOpen]);

  const nodes = useQuery({ queryKey: ["nodes", "all-pages"], queryFn: listAllNodes });
  const create = useMutation({
    mutationFn: createServer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
      navigate("/servers");
    },
  });

  const openclawSelected = software.includes("openclaw");
  const allNodes = nodes.data ?? [];
  const selectedNode = nodeId === null ? null : allNodes.find((node) => node.id === nodeId) ?? null;

  function submit() {
    create.mutate({
      name: name.trim(),
      node_id: nodeId,
      config: {
        image: os,
        software: variant === "xcode" ? ["xcode", ...software] : [...software],
        channels: openclawSelected ? channels : [],
        env: openclawSelected ? cleanedEnv() : undefined,
      },
    });
  }

  const channelKeys: Array<{ id: string; label: string; note: string; placeholder: string }> = [
    ...(channels.includes("telegram")
      ? [{ id: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token", note: "Telegram needs this", placeholder: "123456:ABC…" }]
      : []),
    ...(channels.includes("discord")
      ? [{ id: "DISCORD_BOT_TOKEN", label: "Discord bot token", note: "Discord needs this", placeholder: "MTIz…" }]
      : []),
    ...(channels.includes("slack")
      ? [
          { id: "SLACK_BOT_TOKEN", label: "Slack bot token", note: "Slack needs this", placeholder: "xoxb-…" },
          { id: "SLACK_APP_TOKEN", label: "Slack app token", note: "Slack needs this", placeholder: "xapp-…" },
        ]
      : []),
  ];
  const activeKeys = new Set([...channelKeys.map((key) => key.id), ...addedKeys]);
  const availableProviders = PROVIDER_KEYS.filter((provider) => !activeKeys.has(provider.id));

  function cleanedEnv(): Record<string, string> | undefined {
    const entries = [...activeKeys]
      .map((key) => [key, (envValues[key] ?? "").trim()] as const)
      .filter(([, value]) => value !== "");
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  function setEnvValue(id: string, value: string) {
    setEnvValues((current) => ({ ...current, [id]: value }));
  }

  function keyRow(id: string, label: string, meta: string, placeholder: string, removable: boolean) {
    return (
      <div className={styles.keyRow} key={id}>
        <div className={styles.keyName}>
          <span>{label}</span>
          <code>{id}</code>
        </div>
        <input
          className={styles.keyValue}
          type="password"
          value={envValues[id] ?? ""}
          onChange={(event) => setEnvValue(id, event.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
          spellCheck={false}
          aria-label={label}
        />
        {removable ? (
          <button
            type="button"
            className={styles.keyRemove}
            aria-label={`Remove ${label}`}
            onClick={() => setAddedKeys((current) => current.filter((key) => key !== id))}
          >
            ×
          </button>
        ) : (
          <span className={styles.keyNote}>{meta}</span>
        )}
      </div>
    );
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
                      {item.logo ? <img src={item.logo} alt="" /> : "🦞"}
                    </span>
                    <span className={styles.softText}>
                      <strong>{item.name}</strong>
                      <span>{item.blurb}</span>
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
                      <div className={styles.keyEditor}>
                        <p className={styles.keyIntro}>
                          Keys and variables, injected at boot. OpenClaw needs at least one model key
                          to think with.
                        </p>
                        {channelKeys.map((key) => keyRow(key.id, key.label, key.note, key.placeholder, false))}
                        {addedKeys.map((id) => {
                          const provider = PROVIDER_KEYS.find((item) => item.id === id);
                          return keyRow(id, provider?.name ?? id, "", provider?.placeholder ?? "", true);
                        })}
                        {customDraft !== null && (
                          <div className={styles.keyRow}>
                            <input
                              className={styles.keyCustomName}
                              value={customDraft}
                              onChange={(event) =>
                                setCustomDraft(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter" && customDraft.trim() !== "") {
                                  setAddedKeys((current) => [...current, customDraft]);
                                  setCustomDraft(null);
                                }
                                if (event.key === "Escape") setCustomDraft(null);
                              }}
                              placeholder="VARIABLE_NAME"
                              autoFocus
                              spellCheck={false}
                              aria-label="Variable name"
                            />
                            <button
                              type="button"
                              className={styles.keyConfirm}
                              disabled={customDraft.trim() === "" || activeKeys.has(customDraft)}
                              onClick={() => {
                                setAddedKeys((current) => [...current, customDraft]);
                                setCustomDraft(null);
                              }}
                            >
                              Add
                            </button>
                            <button type="button" className={styles.keyRemove} aria-label="Cancel" onClick={() => setCustomDraft(null)}>
                              ×
                            </button>
                          </div>
                        )}
                        <div className={styles.keyAdd} ref={keyMenuRef}>
                          <button
                            type="button"
                            className={styles.keyAddBtn}
                            aria-haspopup="menu"
                            aria-expanded={keyMenuOpen}
                            onClick={() => setKeyMenuOpen((current) => !current)}
                          >
                            Add key
                          </button>
                          {keyMenuOpen && (
                            <div className={styles.keyMenu} role="menu">
                              {availableProviders.map((provider) => (
                                <button
                                  key={provider.id}
                                  type="button"
                                  role="menuitem"
                                  className={styles.keyOpt}
                                  onClick={() => {
                                    setAddedKeys((current) => [...current, provider.id]);
                                    setKeyMenuOpen(false);
                                  }}
                                >
                                  <span>{provider.name}</span>
                                  <code>{provider.id}</code>
                                </button>
                              ))}
                              <button
                                type="button"
                                role="menuitem"
                                className={styles.keyOpt}
                                onClick={() => {
                                  setCustomDraft("");
                                  setKeyMenuOpen(false);
                                }}
                              >
                                <span>Custom variable</span>
                              </button>
                            </div>
                          )}
                        </div>
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
