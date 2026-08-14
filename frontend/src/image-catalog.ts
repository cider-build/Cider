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
  blurb: string;
  install: string;
  logo: string | null;
};

export type Channel = {
  id: ChannelId;
  name: string;
  description: string;
  plugin: boolean;
  logo: string | null;
};

export const APPLE_LOGO = "https://svgl.app/library/apple.svg";
export const XCODE_LOGO = "https://developer.apple.com/assets/elements/icons/xcode/xcode-128x128_2x.png";

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
    blurb: "Anthropic's coding agent",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    logo: "https://svgl.app/library/claude-ai-icon.svg",
  },
  {
    id: "codex",
    name: "Codex",
    vendor: "OpenAI",
    description: "Terminal coding agent.",
    blurb: "OpenAI's coding agent",
    install: "npm install -g @openai/codex",
    logo: "https://svgl.app/library/openai.svg",
  },
  {
    id: "cursor",
    name: "Cursor",
    vendor: "Anysphere",
    description: "AI code editor.",
    blurb: "The AI code editor",
    install: "brew install --cask cursor",
    logo: "https://cdn.simpleicons.org/cursor/000000",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    vendor: "Open source",
    description: "Personal AI assistant gateway. Pick the chat channels to preconfigure below.",
    blurb: "Your personal AI assistant",
    install: "curl -fsSL https://openclaw.ai/install.sh | bash",
    logo: null,
  },
];

export function macos(image: string | null | undefined) {
  if (image == null) return "—";
  const release = OS_RELEASES.find((item) => image.includes(item.id));
  return release ? `${release.version} ${release.name}` : image;
}

export const OPENCLAW_CHANNELS: Channel[] = [
  { id: "imessage", name: "iMessage", description: "Native on macOS via the signed-in Messages app.", plugin: false, logo: "https://cdn.simpleicons.org/imessage/34DA50" },
  { id: "webchat", name: "WebChat", description: "Browser chat UI, ships with the core install.", plugin: false, logo: null },
  { id: "telegram", name: "Telegram", description: "Simplest external setup — needs a bot token.", plugin: false, logo: "https://cdn.simpleicons.org/telegram/26A5E4" },
  { id: "discord", name: "Discord", description: "Official plugin.", plugin: true, logo: "https://cdn.simpleicons.org/discord/5865F2" },
  { id: "slack", name: "Slack", description: "Official plugin.", plugin: true, logo: "https://svgl.app/library/slack.svg" },
  { id: "whatsapp", name: "WhatsApp", description: "Official plugin, links via QR code.", plugin: true, logo: "https://cdn.simpleicons.org/whatsapp/25D366" },
];
