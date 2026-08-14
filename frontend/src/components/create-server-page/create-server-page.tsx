import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { createServer, listAllNodes } from "../../api";
import type { Node as CiderNode } from "../../api";
import {
  APPLE_LOGO,
  OPENCLAW_CHANNELS,
  OS_RELEASES,
  SOFTWARE,
  VARIANTS,
  XCODE_LOGO,
} from "../../image-catalog";
import type {
  ChannelId,
  OsId,
  SoftwareId,
  VariantId,
} from "../../image-catalog";
import { Button, Dropdown } from "../ui/ui";
import styles from "./create-server-page.module.css";

const PROVIDERS = [
  { id: "ANTHROPIC_API_KEY", name: "Anthropic", placeholder: "sk-ant-…" },
  { id: "OPENAI_API_KEY", name: "OpenAI", placeholder: "sk-…" },
  { id: "OPENROUTER_API_KEY", name: "OpenRouter", placeholder: "sk-or-…" },
  { id: "GROQ_API_KEY", name: "Groq", placeholder: "gsk-…" },
  { id: "XAI_API_KEY", name: "xAI", placeholder: "xai-…" },
];

const SOFTWARE_KEY: Partial<
  Record<SoftwareId, { id: string; label: string; placeholder: string }>
> = {
  "claude-code": {
    id: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    placeholder: "sk-ant-…",
  },
  codex: { id: "OPENAI_API_KEY", label: "OpenAI API key", placeholder: "sk-…" },
};

const CHANNEL_KEY: Partial<
  Record<ChannelId, Array<{ id: string; label: string; placeholder: string }>>
> = {
  telegram: [
    {
      id: "TELEGRAM_BOT_TOKEN",
      label: "Telegram bot token",
      placeholder: "123456:ABC…",
    },
  ],
  discord: [
    {
      id: "DISCORD_BOT_TOKEN",
      label: "Discord bot token",
      placeholder: "MTIz…",
    },
  ],
  slack: [
    { id: "SLACK_BOT_TOKEN", label: "Slack bot token", placeholder: "xoxb-…" },
    { id: "SLACK_APP_TOKEN", label: "Slack app token", placeholder: "xapp-…" },
  ],
};

function toggled<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function nodeLabel(node: CiderNode) {
  return node.metadata ? `${node.name}, ${node.metadata.chip}` : node.name;
}

export function CreateServerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [os, setOs] = useState<OsId>("tahoe");
  const [variant, setVariant] = useState<VariantId>("vanilla");
  const [software, setSoftware] = useState<SoftwareId[]>([]);
  const [channels, setChannels] = useState<ChannelId[]>([
    "imessage",
    "webchat",
  ]);
  const [provider, setProvider] = useState("");
  const [env, setEnv] = useState<Record<string, string>>({});
  const [nodeId, setNodeId] = useState("auto");

  const nodes = useQuery({
    queryKey: ["nodes", "all-pages"],
    queryFn: listAllNodes,
  });
  const create = useMutation({
    mutationFn: createServer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
      navigate("/servers");
    },
  });

  const openclaw = software.includes("openclaw");
  const allNodes = nodes.data ?? [];
  const release = OS_RELEASES.find((item) => item.id === os) ?? OS_RELEASES[0];
  const variantName = (
    VARIANTS.find((item) => item.id === variant) ?? VARIANTS[0]
  ).name;
  const softwareNames = SOFTWARE.filter((item) =>
    software.includes(item.id),
  ).map((item) => item.name);
  const channelNames = OPENCLAW_CHANNELS.filter((item) =>
    channels.includes(item.id),
  ).map((item) => item.name);

  function activeKeys(): string[] {
    const fromSoftware = software.flatMap((id) =>
      SOFTWARE_KEY[id] ? [SOFTWARE_KEY[id]!.id] : [],
    );
    const fromChannels = openclaw
      ? channels.flatMap((id) => (CHANNEL_KEY[id] ?? []).map((key) => key.id))
      : [];
    return [
      ...new Set([
        ...fromSoftware,
        ...fromChannels,
        ...(openclaw && provider !== "" ? [provider] : []),
      ]),
    ];
  }

  function submit() {
    const entries = activeKeys()
      .map((key) => [key, (env[key] ?? "").trim()] as const)
      .filter(([, value]) => value !== "");
    create.mutate({
      name: name.trim(),
      node_id: nodeId === "auto" ? null : nodeId,
      config: {
        image: os,
        software: variant === "xcode" ? ["xcode", ...software] : [...software],
        channels: openclaw ? channels : [],
        env: entries.length > 0 ? Object.fromEntries(entries) : undefined,
      },
    });
  }

  function keyField(key: { id: string; label: string; placeholder: string }) {
    return (
      <label className={styles.key} key={key.id}>
        <span>{key.label}</span>
        <input
          className={styles.input}
          type="password"
          value={env[key.id] ?? ""}
          onChange={(event) =>
            setEnv((current) => ({ ...current, [key.id]: event.target.value }))
          }
          placeholder={key.placeholder}
          autoComplete="new-password"
          spellCheck={false}
        />
      </label>
    );
  }

  const summary: Array<[string, string]> = [
    ["Name", name.trim() === "" ? "Not set" : name.trim()],
    ["macOS", `${release.version} ${release.name}`],
    ["Image", variantName],
    [
      "Software",
      softwareNames.length === 0 ? "None" : softwareNames.join(", "),
    ],
    ...(openclaw
      ? [
          [
            "Channels",
            channelNames.length === 0 ? "None" : channelNames.join(", "),
          ] as [string, string],
        ]
      : []),
    [
      "Node",
      nodeId === "auto"
        ? "Automatic"
        : (allNodes.find((node) => node.id === nodeId)?.name ?? "Automatic"),
    ],
  ];

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Button kind="quiet" onClick={() => navigate("/servers")}>
          ← Servers
        </Button>
        <h1>New server</h1>
        <p>A Mac that keeps running until you stop it.</p>
      </header>

      <div className={styles.grid}>
        <div className={styles.stack}>
          <div className={styles.panel}>
            <h2>Name</h2>
            <input
              className={styles.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-server"
              maxLength={63}
              autoComplete="off"
              spellCheck={false}
              aria-label="Server name"
            />
          </div>

          <div className={styles.panel}>
            <h2>macOS</h2>
            <div
              className={styles.os}
              role="radiogroup"
              aria-label="macOS version"
            >
              {OS_RELEASES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={os === item.id}
                  className={styles.osCard}
                  onClick={() => setOs(item.id)}
                >
                  <span className={styles.osTop}>
                    <img src={APPLE_LOGO} alt="" />
                    <span className={styles.mark} aria-hidden="true" />
                  </span>
                  <b>{item.version}</b>
                  <span>
                    {item.name}, {item.year}
                  </span>
                </button>
              ))}
            </div>
            <div
              className={styles.rows}
              role="radiogroup"
              aria-label="Image variant"
            >
              {VARIANTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={variant === item.id}
                  className={styles.row}
                  onClick={() => setVariant(item.id)}
                >
                  <span className={styles.rowIcon}>
                    <img
                      src={item.id === "xcode" ? XCODE_LOGO : APPLE_LOGO}
                      alt=""
                    />
                  </span>
                  <span className={styles.rowText}>
                    <strong>{item.name}</strong>
                    <span>{item.description}</span>
                  </span>
                  <span className={styles.mark} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <h2>Software</h2>
            <div className={styles.rows}>
              {SOFTWARE.map((item) => {
                const selected = software.includes(item.id);
                const key = SOFTWARE_KEY[item.id];
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      className={styles.row}
                      onClick={() =>
                        setSoftware((current) => toggled(current, item.id))
                      }
                    >
                      <span className={styles.rowIcon}>
                        {item.logo ? <img src={item.logo} alt="" /> : "🦞"}
                      </span>
                      <span className={styles.rowText}>
                        <strong>{item.name}</strong>
                        <span>{item.blurb}</span>
                      </span>
                      <span
                        className={`${styles.mark} ${styles.check}`}
                        aria-hidden="true"
                      />
                    </button>
                    {selected && key !== undefined && (
                      <div className={styles.sub}>{keyField(key)}</div>
                    )}
                    {selected && item.id === "openclaw" && (
                      <div className={styles.sub}>
                        <p className={styles.subLabel}>
                          Where you talk to OpenClaw
                        </p>
                        <div className={styles.channels}>
                          {OPENCLAW_CHANNELS.map((channel) => {
                            const on = channels.includes(channel.id);
                            const keys = CHANNEL_KEY[channel.id] ?? [];
                            return (
                              <div
                                className={styles.channel}
                                data-wide={
                                  on && keys.length > 0 ? "" : undefined
                                }
                                key={channel.id}
                              >
                                <button
                                  type="button"
                                  aria-pressed={on}
                                  className={styles.chip}
                                  onClick={() =>
                                    setChannels((current) =>
                                      toggled(current, channel.id),
                                    )
                                  }
                                >
                                  {channel.logo ? (
                                    <img src={channel.logo} alt="" />
                                  ) : null}
                                  {channel.name}
                                </button>
                                {on && keys.length > 0 && (
                                  <div className={styles.sub}>
                                    {keys.map(keyField)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <p className={styles.subLabel}>Model provider</p>
                        <Dropdown
                          value={provider}
                          onChange={setProvider}
                          options={[
                            { value: "", label: "Choose a provider" },
                            ...PROVIDERS.map((item) => ({
                              value: item.id,
                              label: item.name,
                            })),
                          ]}
                          width={240}
                        />
                        {provider !== "" &&
                          keyField({
                            id: provider,
                            label: `${PROVIDERS.find((item) => item.id === provider)?.name ?? provider} API key`,
                            placeholder:
                              PROVIDERS.find((item) => item.id === provider)
                                ?.placeholder ?? "",
                          })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.panel}>
            <h2>Placement</h2>
            <Dropdown
              value={nodeId}
              onChange={setNodeId}
              options={[
                {
                  value: "auto",
                  label: "Automatic, first Mac with free capacity",
                },
                ...allNodes.map((node) => ({
                  value: node.id,
                  label: nodeLabel(node),
                })),
              ]}
            />
          </div>
        </div>

        <aside className={styles.summary}>
          <h2>Summary</h2>
          <dl>
            {summary.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {create.error && (
            <p className={styles.error} role="alert">
              {create.error.message}
            </p>
          )}
          <Button
            kind="primary"
            block
            disabled={create.isPending || name.trim() === ""}
            onClick={submit}
          >
            {create.isPending ? "Creating" : "Create server"}
          </Button>
        </aside>
      </div>
    </section>
  );
}
