// Single function: notifyDiscord(payload)
// Call this from controllers/services/cron/etc.

import { Discord, isDiscordConfigured } from "./discordClient.js";
import type { Request } from "express";

type MetaRecord = Record<string, unknown>;

export interface NotifyDiscordPayload {
  type?: "info" | "success" | "warn" | "error";
  title?: string;
  message?: string;
  step?: string;
  meta?: MetaRecord;
  error?: unknown;
  // Optional: pass Express Request to auto-add path/method/ip
  req?: Request;
}

function withReqMeta(base: MetaRecord | undefined, req?: Request): MetaRecord | undefined {
  if (!req) return base;
  return {
    ...(base ?? {}),
    path: req.originalUrl || req.url || "",
    method: req.method || "",
    ip: req.ip || "",
  };
}

function errorToMeta(error: unknown): MetaRecord {
  if (!error) return {};

  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }

  if (typeof error === "string") {
    return { errorMessage: error };
  }

  return { error: error };
}

export async function notifyDiscord(payload: NotifyDiscordPayload) {
  if (!isDiscordConfigured) return;

  try {
    const { type = "info", title, message, meta, step, error, req } = payload;
    let mergedMeta = withReqMeta(meta ? { ...meta } : undefined, req);

    if (step) {
      mergedMeta = { ...(mergedMeta ?? {}), step };
    }

    if (error) {
      mergedMeta = { ...(mergedMeta ?? {}), ...errorToMeta(error) };
    }

    switch (type) {
      case "success":
        await Discord.sendSuccess(title ?? "Success", message ?? "", mergedMeta);
        break;
      case "warn":
        await Discord.sendWarn(title ?? "Warning", message ?? "", mergedMeta);
        break;
      case "error":
        await Discord.sendError(title ?? "Error", message ?? "", mergedMeta);
        break;
      default:
        await Discord.sendInfo(title ?? "Info", message ?? "", mergedMeta);
        break;
    }
  } catch (e) {
    // Never throw; avoid breaking your API flow
    console.error("Failed to send Discord notification:", e);
  }
}
