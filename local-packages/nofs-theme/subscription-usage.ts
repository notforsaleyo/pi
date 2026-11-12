import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dim, fg, GREEN, ORANGE, RED, YELLOW } from "./colors.ts";

const WEEK_MINUTES = 7 * 24 * 60;
const MAX_AGE_MS = 5 * 60_000;
const CACHE_POLL_MS = 5_000;
const CACHE_PATH = join(homedir(), ".pi", "agent", "usage-cache.json");

type UsageWindow = { usedPercent: number; resetsAt: number; capturedAt: number };
export type UsageWindows = { weekly?: UsageWindow; fiveHour?: UsageWindow };
type Model = { provider: string; id: string; name?: string };

const number = (value: unknown): number | undefined => {
	if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
};
const object = (value: unknown): Record<string, any> =>
	value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

function window(used: unknown, reset: unknown, captured: unknown): UsageWindow | undefined {
	const usedPercent = number(used), resetsAt = number(reset), capturedAt = number(captured);
	if (usedPercent == null || usedPercent < 0 || resetsAt == null || resetsAt <= 0 || capturedAt == null) return;
	return { usedPercent, resetsAt: resetsAt * 1000, capturedAt };
}

// OAuth inference headers use fractions, unlike the usage endpoint's percentages.
// No extra requests or credentials; absent headers remain unknown.
export function anthropicUsage(headers: Record<string, string>, now: number): UsageWindows {
	const h = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
	const read = (period: string) => {
		const prefix = `anthropic-ratelimit-unified-${period}`;
		const fraction = number(h[`${prefix}-utilization`]);
		return window(fraction == null ? undefined : fraction * 100, h[`${prefix}-reset`], now);
	};
	return { weekly: read("7d"), fiveHour: read("5h") };
}

// pi-usage's primary window can be weekly on Codex Pro. Never infer duration from its position.
export function codexUsage(cache: unknown, model: Model): UsageWindows {
	const root = object(cache);
	if (root.version !== 1) return {};
	const entry = object(object(root.entries).codex);
	const report = object(entry.report);
	if (report.provider !== "codex" || !Array.isArray(report.snapshots)) return {};
	const normalize = (value: unknown) => typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "";
	const names = [normalize(model.id), normalize(model.name)].filter(Boolean);
	const snapshots = report.snapshots.map(object);
	const snapshot = snapshots.find(s => [normalize(s.limitId), normalize(s.limitName)].some(n => names.includes(n)))
		?? snapshots.find(s => s.limitId === "codex" || s.limitName === "codex")
		?? (snapshots.length === 1 ? snapshots[0] : undefined);
	const weekly = [snapshot?.primary, snapshot?.secondary].map(object).find(w => w.windowMinutes === WEEK_MINUTES);
	return { weekly: window(weekly?.usedPercent, weekly?.resetsAt, report.capturedAt ?? entry.createdAt) };
}

function fresh(w: UsageWindow | undefined, durationMinutes: number, now: number): w is UsageWindow {
	return !!w && now >= w.capturedAt && now - w.capturedAt <= MAX_AGE_MS &&
		now < w.resetsAt && w.resetsAt - now <= durationMinutes * 60_000;
}

export function formatSubscriptionUsage(provider: string, usage: UsageWindows, now: number): string {
	if (provider !== "openai-codex" && provider !== "anthropic") return "";
	let weekly = dim("W--");
	if (fresh(usage.weekly, WEEK_MINUTES, now)) {
		const elapsedPercent = (1 - (usage.weekly.resetsAt - now) / (WEEK_MINUTES * 60_000)) * 100;
		const margin = Math.round(elapsedPercent - usage.weekly.usedPercent);
		const value = `${margin < 0 ? "" : "+"}${margin === 0 ? 0 : margin}%p`;
		weekly = dim("W") + (margin === 0 ? dim(value) : fg(margin > 0 ? GREEN : YELLOW, value));
	}
	if (provider !== "anthropic") return weekly;
	let fiveHour = dim("--");
	if (fresh(usage.fiveHour, 300, now)) {
		const used = Math.round(usage.fiveHour.usedPercent);
		fiveHour = fg(used >= 90 ? RED : used >= 75 ? ORANGE : GREEN, `${used}%`);
	}
	return `${weekly} ${dim("5h")} ${fiveHour}`;
}

export function createSubscriptionUsage(readCache: () => unknown = () => JSON.parse(readFileSync(CACHE_PATH, "utf8"))) {
	let anthropic: UsageWindows = {};
	let cache: unknown;
	let nextReadAt = 0;
	return {
		observe(headers: Record<string, string>, now = Date.now()) {
			const observed = anthropicUsage(headers, now);
			if (observed.weekly) anthropic.weekly = observed.weekly;
			if (observed.fiveHour) anthropic.fiveHour = observed.fiveHour;
		},
		label(model: Model | undefined, now = Date.now()): string {
			if (!model) return "";
			if (model.provider === "openai-codex" && now >= nextReadAt) {
				nextReadAt = now + CACHE_POLL_MS;
				try { cache = readCache(); } catch { cache = undefined; }
			}
			return formatSubscriptionUsage(model.provider,
				model.provider === "anthropic" ? anthropic : codexUsage(cache, model), now);
		},
	};
}
