import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dim, fg, GREEN, ORANGE, RED, YELLOW } from "./colors.ts";

const WEEK_MINUTES = 7 * 24 * 60;
const MAX_AGE_MS = 5 * 60_000;
const ANTHROPIC_MAX_AGE_MS = 5 * 60_000;
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

// The public usage:v1 API reports reset times in milliseconds (Anthropic headers use seconds).
export function codexUsage(result: unknown, model: Model, now: number): UsageWindows {
	const r = object(result), report = object(r.report);
	if (r.status !== "ready" || r.providerId !== "openai-codex" || report.providerId !== r.providerId ||
		!(Number.isFinite(r.expiresAt) && now < r.expiresAt) || !Array.isArray(report.buckets)) return {};
	const buckets: Record<string, any>[] = (report.buckets as unknown[]).map(object).filter(b => typeof b.groupId === "string");
	const norm = (v: unknown) => typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "";
	const names = [norm(model.id), norm(model.name)].filter(Boolean);
	const group = buckets.find(b => [b.groupId, b.groupLabel].some(v => names.includes(norm(v))))?.groupId
		?? buckets.find(b => b.groupId === "codex")?.groupId
		?? (new Set(buckets.map(b => b.groupId)).size === 1 ? buckets[0].groupId : undefined);
	const week = buckets.find(b => b.groupId === group && b.windowMinutes === WEEK_MINUTES && b.unit === "percent");
	if (!week || !Number.isFinite(week.used) || week.used < 0 || !Number.isFinite(week.resetsAt) ||
		!Number.isFinite(report.capturedAt)) return {};
	return { weekly: { usedPercent: week.used, resetsAt: week.resetsAt, capturedAt: report.capturedAt } };
}

function fresh(w: UsageWindow | undefined, durationMinutes: number, now: number, maxAgeMs: number): w is UsageWindow {
	return !!w && now >= w.capturedAt && now - w.capturedAt <= maxAgeMs &&
		now < w.resetsAt && w.resetsAt - now <= durationMinutes * 60_000;
}

export function formatSubscriptionUsage(provider: string, usage: UsageWindows, now: number): string {
	if (provider !== "openai-codex" && provider !== "anthropic") return "";
	const maxAge = provider === "anthropic" ? ANTHROPIC_MAX_AGE_MS : MAX_AGE_MS;
	let weekly = dim("W--");
	if (fresh(usage.weekly, WEEK_MINUTES, now, maxAge)) {
		const elapsedPercent = (1 - (usage.weekly.resetsAt - now) / (WEEK_MINUTES * 60_000)) * 100;
		const margin = Math.round(elapsedPercent - usage.weekly.usedPercent);
		const value = `${margin < 0 ? "" : "+"}${margin === 0 ? 0 : margin}%p`;
		weekly = dim("W") + (margin === 0 ? dim(value) : fg(margin > 0 ? GREEN : YELLOW, value));
	}
	if (provider !== "anthropic") return weekly;
	let fiveHour = dim("--");
	if (fresh(usage.fiveHour, 300, now, maxAge)) {
		const used = Math.round(usage.fiveHour.usedPercent);
		fiveHour = fg(used >= 90 ? RED : used >= 75 ? ORANGE : GREEN, `${used}%`);
	}
	return `${weekly} ${dim("5h")} ${fiveHour}`;
}

export function createSubscriptionUsage() {
	let anthropic: UsageWindows = {};
	let codex: unknown;
	let pending: AbortController | undefined;
	let nextReadAt = 0;
	const clear = () => {
		pending?.abort();
		pending = undefined;
		codex = undefined;
		nextReadAt = 0;
	};
	return {
		clear,
		invalidateCodex() {
			// The service can evict an expired report while publishing its replacement.
			codex = undefined;
		},
		refresh(pi: ExtensionAPI, ctx: ExtensionContext, now = Date.now()) {
			if (ctx.model?.provider !== "openai-codex" || now < nextReadAt) return;
			pending?.abort();
			const controller = new AbortController();
			pending = controller;
			const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
			const session = ctx.sessionManager, sessionId = session.getSessionId();
			nextReadAt = now + 30_000; // Retry unavailable reads, never on each render.
			let open = true, offered = false;
			pi.events.emit("usage:query:v1", {
				session, sessionId, providerId: "openai-codex", refresh: true, signal,
				respond(value: unknown) {
					const reply = Promise.resolve(value).catch(() => undefined);
					if (!open || offered) return false;
					offered = true;
					void reply.then(result => {
						if (signal.aborted || pending !== controller || session.getSessionId() !== sessionId) return;
						codex = result;
						const r = object(result);
						if (r.status === "ready" && Number.isFinite(r.expiresAt)) {
							nextReadAt = Math.max(now + 5000, Math.min(r.expiresAt, now + MAX_AGE_MS) - 5000);
						}
					});
					return true;
				},
			});
			open = false;
		},
		observe(headers: Record<string, string>, now = Date.now()) {
			const observed = anthropicUsage(headers, now);
			if (observed.weekly) anthropic.weekly = observed.weekly;
			if (observed.fiveHour) anthropic.fiveHour = observed.fiveHour;
		},
		label(model: Model | undefined, now = Date.now()): string {
			if (!model) return "";
			return formatSubscriptionUsage(model.provider,
				model.provider === "anthropic" ? anthropic : codexUsage(codex, model, now), now);
		},
	};
}
