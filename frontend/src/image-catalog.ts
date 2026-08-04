// Catalog for the sandbox image picker. Base OS images are cirruslabs builds
// pulled from ghcr.io by the node on first use (lume pulls OCI images natively),
// so nothing is stored on our machines. Xcode is a baked image variant because
// it is ~50 GB and cirruslabs rebuilds it monthly; everything else installs at
// first boot so sandboxes always get the latest version.

export type OsId = "tahoe" | "sequoia" | "sonoma";
export type VariantId = "vanilla" | "xcode";
export type SoftwareId = "claude-code" | "codex" | "cursor" | "openclaw";
export type ChannelId = "imessage" | "telegram" | "webchat" | "discord" | "slack" | "whatsapp";

export type OsRelease = {
  id: OsId;
  name: string;
  version: string;
  year: string;
};

export type Variant = {
  id: VariantId;
  name: string;
  description: string;
};

export type Software = {
  id: SoftwareId;
  name: string;
  vendor: string;
  description: string;
  install: string;
};

export type Channel = {
  id: ChannelId;
  name: string;
  description: string;
  plugin: boolean;
};

export const OS_RELEASES: OsRelease[] = [
  { id: "tahoe", name: "Tahoe", version: "macOS 26", year: "2025" },
  { id: "sequoia", name: "Sequoia", version: "macOS 15", year: "2024" },
  { id: "sonoma", name: "Sonoma", version: "macOS 14", year: "2023" },
];

export const VARIANTS: Variant[] = [
  {
    id: "vanilla",
    name: "Vanilla",
    description: "Minimal macOS with auto-login. Smallest image, fastest first pull.",
  },
  {
    id: "xcode",
    name: "Xcode",
    description: "Adds Xcode and Homebrew. Baked into the image (~50 GB) because it is too large to install at boot; rebuilt monthly upstream.",
  },
];

export const SOFTWARE: Software[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    description: "Terminal coding agent.",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
  },
  {
    id: "codex",
    name: "Codex",
    vendor: "OpenAI",
    description: "Terminal coding agent.",
    install: "npm install -g @openai/codex",
  },
  {
    id: "cursor",
    name: "Cursor",
    vendor: "Anysphere",
    description: "AI code editor.",
    install: "brew install --cask cursor",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    vendor: "Open source",
    description: "Personal AI assistant gateway. Pick the chat channels to preconfigure below.",
    install: "curl -fsSL https://openclaw.ai/install.sh | bash",
  },
];

export const OPENCLAW_CHANNELS: Channel[] = [
  { id: "imessage", name: "iMessage", description: "Native on macOS via the signed-in Messages app.", plugin: false },
  { id: "webchat", name: "WebChat", description: "Browser chat UI, ships with the core install.", plugin: false },
  { id: "telegram", name: "Telegram", description: "Simplest external setup — needs a bot token.", plugin: false },
  { id: "discord", name: "Discord", description: "Official plugin.", plugin: true },
  { id: "slack", name: "Slack", description: "Official plugin.", plugin: true },
  { id: "whatsapp", name: "WhatsApp", description: "Official plugin, links via QR code.", plugin: true },
];

export function imageReference(os: OsId, variant: VariantId) {
  return `ghcr.io/cirruslabs/macos-${os}-${variant}:latest`;
}
