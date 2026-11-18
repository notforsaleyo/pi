import assert from "node:assert/strict";
import { test } from "node:test";
import { anthropicUsage, codexUsage, createSubscriptionUsage, formatSubscriptionUsage } from "./subscription-usage.ts";

const now = 1_800_000_000_000;
const week = 7 * 24 * 60 * 60_000;
const model = { provider: "openai-codex", id: "gpt-astra", name: "GPT Astra" };
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const headers = (weekly = "0.42", five = "0.19") => ({
	"anthropic-ratelimit-unified-7d-utilization": weekly,
	"anthropic-ratelimit-unified-7d-reset": String((now + week * 0.4) / 1000),
	"anthropic-ratelimit-unified-5h-utilization": five,
	"anthropic-ratelimit-unified-5h-reset": String((now + 60_000) / 1000),
});
const weekly = (groupId = "codex", used = 42) => ({ groupId, unit: "percent", used, windowMinutes: 10080, resetsAt: now + week * 0.4 });
const ready = (buckets: unknown[]) => ({ status: "ready", providerId: model.provider, expiresAt: now + 300000,
	report: { providerId: model.provider, capturedAt: now, buckets } });

test("exact requested format, positive/negative/zero, 5h 100% and over-limit values", () => {
	for (const [used, expected] of [["0.42", "W+18%p"], ["0.67", "W-7%p"], ["0.60", "W+0%p"], ["0.601", "W+0%p"]]) {
		const usage = anthropicUsage(headers(used, "1"), now);
		assert.equal(plain(formatSubscriptionUsage("anthropic", usage, now)), `${expected} 5h 100%`);
		assert.equal(plain(formatSubscriptionUsage("openai-codex", usage, now)), expected);
	}
	assert.equal(plain(formatSubscriptionUsage("anthropic", anthropicUsage(headers("0.42", "1.1"), now), now)), "W+18%p 5h 110%");
	assert.equal(formatSubscriptionUsage("openai", {}, now), "");
});

test("5h percentage color: green below 75, orange from 75, red from 90, no bold", () => {
	const color = (five: string) => formatSubscriptionUsage("anthropic", anthropicUsage(headers("0.42", five), now), now);
	assert.match(color("0.74"), /\x1b\[38;2;56;150;60m74%\x1b\[39m/);
	assert.match(color("0.19"), /\x1b\[38;2;56;150;60m19%\x1b\[39m/);
	assert.match(color("0.75"), /\x1b\[38;2;230;110;0m75%\x1b\[39m/);
	assert.match(color("0.9"), /\x1b\[38;2;220;0;0m90%\x1b\[39m/);
	assert.match(color("1"), /\x1b\[38;2;220;0;0m100%\x1b\[39m/);
	for (const s of [color("0.19"), color("0.9")]) assert(!s.includes("\x1b[1m"), "no bold");
});

test("missing, empty, invalid, expired, future and stale data never become zero usage", () => {
	for (const invalid of ["", " ", "NaN", "Infinity", "-1"]) {
		assert.equal(plain(formatSubscriptionUsage("anthropic", anthropicUsage(headers(invalid, invalid), now), now)), "W-- 5h --");
	}
	assert.equal(plain(formatSubscriptionUsage("anthropic", anthropicUsage({}, now), now)), "W-- 5h --");
	const valid = anthropicUsage(headers(), now);
	assert.equal(plain(formatSubscriptionUsage("anthropic", valid, now + 30 * 60_000 + 1)), "W-- 5h --");
	assert.equal(plain(formatSubscriptionUsage("anthropic", valid, now - 1)), "W-- 5h --");
	assert.equal(plain(formatSubscriptionUsage("anthropic", valid, now + 60_000)), "W+18%p 5h --");
	const reset = { ...headers(), "anthropic-ratelimit-unified-7d-reset": String(now / 1000) };
	assert.equal(plain(formatSubscriptionUsage("anthropic", anthropicUsage(reset, now), now)), "W-- 5h 19%");
});

test("Anthropic headers are case insensitive and fractions become percentages", () => {
	const h = Object.fromEntries(Object.entries(headers()).map(([k, v]) => [k.toUpperCase(), v]));
	assert.equal(plain(formatSubscriptionUsage("anthropic", anthropicUsage(h, now), now)), "W+18%p 5h 19%");
});

test("normalized API buckets preserve weekly margins, group choice and unknown semantics", () => {
	const label = (r: unknown) => plain(formatSubscriptionUsage(model.provider, codexUsage(r, model, now), now));
	assert.equal(label(ready([{ ...weekly(), windowMinutes: 300 }, weekly()])), "W+18%p");
	assert.equal(label(ready([weekly(), { ...weekly("extra", 67), groupLabel: "GPT Astra" }])), "W-7%p");
	for (const bad of [null, ready([]), ready([weekly("a"), weekly("b")]), { ...ready([weekly()]), expiresAt: now },
		ready([{ ...weekly(), used: NaN }]), ready([{ ...weekly(), windowMinutes: 300 }])]) assert.equal(label(bad), "W--");
});

test("scoped refresh survives cache invalidation but not a lifecycle clear", async () => {
	let calls = 0, resolve!: (v: unknown) => void;
	const sessionManager = { getSessionId: () => "id" };
	const ctx = { model, sessionManager };
	const pi = { events: { emit(channel: string, req: any) {
		calls++;
		assert.equal(channel, "usage:query:v1");
		assert.equal(req.session, sessionManager);
		assert.equal(req.sessionId, "id");
		assert.equal(req.refresh, true);
		assert(req.respond(new Promise(r => { resolve = r; })));
		assert(!req.respond(undefined));
	} } };
	const meter = createSubscriptionUsage();
	const refresh = (at = now) => meter.refresh(pi as any, ctx as any, at);
	refresh(); refresh();
	assert.equal(calls, 1);
	resolve(ready([weekly()]));
	await new Promise(r => setImmediate(r));
	assert.equal(plain(meter.label(model, now)), "W+18%p");
	const due = now + 295_000;
	refresh(due);
	assert.equal(calls, 2);
	meter.invalidateCodex();
	assert.equal(plain(meter.label(model, due)), "W--");
	refresh(due + 1);
	assert.equal(calls, 2, "invalidation must not start a competing refresh");
	resolve(ready([weekly("codex", 67)]));
	await new Promise(r => setImmediate(r));
	assert.equal(plain(meter.label(model, due)), "W-7%p");

	meter.clear(); refresh(due); meter.clear();
	resolve(ready([weekly()]));
	await new Promise(r => setImmediate(r));
	assert.equal(plain(meter.label(model, now)), "W--");
});
