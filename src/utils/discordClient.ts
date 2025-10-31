// Hardened Discord webhook client with backoff and embeds.
// Requires: process.env.DISCORD_WEBHOOK_URL
// Node 18+ (fetch built-in). If older, install node-fetch and polyfill fetch.

export type DiscordEmbed = {
    title?: string;
    description?: string;
    url?: string;
    color?: number;
    timestamp?: string;
    fields?: { name: string; value: string; inline?: boolean }[];
    footer?: { text: string };
  };
  
  export interface DiscordMessage {
    content?: string;
    username?: string;
    avatar_url?: string;
    embeds?: DiscordEmbed[];
    allowed_mentions?: {
      parse?: Array<"users" | "roles" | "everyone">;
      users?: string[];
      roles?: string[];
      replied_user?: boolean;
    };
  }
  
  const WEBHOOK = process.env.DISCORD_WEBHOOK_URL?.trim();
  export const isDiscordConfigured = Boolean(WEBHOOK);
  
  let warnedMissingWebhook = false;
  
  function warnMissingWebhook() {
    if (!warnedMissingWebhook) {
      warnedMissingWebhook = true;
      console.warn(
        "Discord webhook not configured; set DISCORD_WEBHOOK_URL to enable notifications."
      );
    }
  }
  
  // Discord 429 JSON looks like:
  // { message: "You are being rate limited.", retry_after: 3, global: false }
  type DiscordRateLimitJson = { retry_after?: number; message?: string; global?: boolean };
  
  async function postWithBackoff(body: DiscordMessage, attempt = 0): Promise<void> {
    if (!isDiscordConfigured) {
      warnMissingWebhook();
      return;
    }
  
    let res: Response;
    try {
      res = await fetch(WEBHOOK!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        return postWithBackoff(body, attempt + 1);
      }
      throw new Error(`Discord fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  
    // Success path: Discord returns 204 No Content
    if (res.status === 204) return;
  
    // Rate limited: respect retry_after
    if (res.status === 429 && attempt < 5) {
      const data = (await res.json().catch(() => ({ retry_after: 1 }))) as DiscordRateLimitJson;
      const ms = Math.ceil((data.retry_after ?? 1) * 1000);
      await new Promise((r) => setTimeout(r, ms));
      return postWithBackoff(body, attempt + 1);
    }
  
    // Any other error
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Discord error ${res.status}: ${text || "unknown error"}`);
    }
  }
  
  const MAX_FIELD_VALUE_LENGTH = 1024;
  
  function truncateFieldValue(value: string): string {
    return value.length > MAX_FIELD_VALUE_LENGTH
      ? `${value.slice(0, MAX_FIELD_VALUE_LENGTH - 3)}...`
      : value;
  }
  
  function formatFieldValue(value: unknown): string {
    if (value === undefined) return "";
    if (value === null) return "null";
    if (typeof value === "string") return truncateFieldValue(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      const base = `${value.name}: ${value.message}`;
      return value.stack ? truncateFieldValue(`${base}\n${value.stack}`) : truncateFieldValue(base);
    }
  
    try {
      return truncateFieldValue(JSON.stringify(value, null, 2));
    } catch {
      return truncateFieldValue(String(value));
    }
  }
  
  function fieldsFromMeta(meta?: Record<string, unknown>): DiscordEmbed["fields"] {
    if (!meta) return [];
    return Object.entries(meta).map(([k, v]) => ({
      name: String(k),
      value: formatFieldValue(v),
      inline: true,
    }));
  }
  
  export const Discord = {
    async sendText(content: string) {
      return postWithBackoff({ content, allowed_mentions: { parse: [] } });
    },
  
    async sendEmbed(embed: DiscordEmbed, content?: string) {
      return postWithBackoff({
        content,
        embeds: [embed],
        allowed_mentions: { parse: [] },
      });
    },
  
    async sendInfo(title: string, description?: string, meta?: Record<string, unknown>) {
      return this.sendEmbed(
        {
          title,
          description,
          color: 0x2563eb, // blue
          timestamp: new Date().toISOString(),
          fields: fieldsFromMeta(meta),
          footer: { text: "Info" },
        },
        ""
      );
    },
  
    async sendSuccess(title: string, description?: string, meta?: Record<string, unknown>) {
      return this.sendEmbed(
        {
          title,
          description,
          color: 0x10b981, // green
          timestamp: new Date().toISOString(),
          fields: fieldsFromMeta(meta),
          footer: { text: "Success" },
        },
        ""
      );
    },
  
    async sendWarn(title: string, description?: string, meta?: Record<string, unknown>) {
      return this.sendEmbed(
        {
          title,
          description,
          color: 0xf59e0b, // amber
          timestamp: new Date().toISOString(),
          fields: fieldsFromMeta(meta),
          footer: { text: "Warning" },
        },
        ""
      );
    },
  
    async sendError(title: string, description?: string, meta?: Record<string, unknown>) {
      return this.sendEmbed(
        {
          title,
          description,
          color: 0xef4444, // red
          timestamp: new Date().toISOString(),
          fields: fieldsFromMeta(meta),
          footer: { text: "Server alert" },
        },
        ""
      );
    },
  };
  