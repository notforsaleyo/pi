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
const cache = (snapshots: unknown[], capturedAt = now) => ({ version: 1, entries: { codex: {
	createdAt: capturedAt, report: { provider: "codex", capturedAt, snapshots },
} } });
const weekly = (usedPercent = 42) => ({ usedPercent, windowMinutes: 10080, resetsAt: (now + week * 0.4) / 1000 });

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
	assert.equal(plain(formatSubscriptionUsage("anthropic", valid, now + 5 * 60_000 + 1)), "W-- 5h --");
	assert.equal(plain(formatSubscriptionUsage("anthropic", valid, now - 1)), "W-- 5h --");
	assert.equal(plain(formatSubscriptionUsage("anthropic", valid, now + 60_000)), "W+18%p 5h --");
	const reset = { ...headers(), "anthropic-ratelimit-unified-7d-reset": String(now / 1000) };
	assert.equal(plain(formatSubscriptionUsage("anthropic", anthropicUsage(reset, now), now)), "W-- 5h 19%");
});

test("Anthropic headers are case insensitive and fractions become percentages", () => {
	const h = Object.fromEntries(Object.entries(headers()).map(([k, v]) => [k.toUpperCase(), v]));
	assert.equal(plain(formatSubscriptionUsage("anthropic", anthropicUsage(h, now), now)), "W+18%p 5h 19%");
});

test("Codex uses window duration, including weekly primary with no 5h limit", () => {
	for (const snapshot of [
		{ limitId: "codex", primary: weekly() },
		{ limitId: "codex", primary: { usedPercent: 99, windowMinutes: 300 }, secondary: weekly() },
	]) {
		assert.equal(plain(formatSubscriptionUsage(model.provider, codexUsage(cache([snapshot]), model), now)), "W+18%p");
	}
	const noWeek = cache([{ limitId: "codex", primary: { ...weekly(), windowMinutes: 300 } }]);
	assert.equal(plain(formatSubscriptionUsage(model.provider, codexUsage(noWeek, model), now)), "W--");
});

test("Codex prefers model-specific limits; malformed/ambiguous cache stays unknown", () => {
	const data = cache([{ limitId: "codex", primary: weekly() }, { limitName: "GPT Astra", primary: weekly(67) }]);
	assert.equal(plain(formatSubscriptionUsage(model.provider, codexUsage(data, model), now)), "W-7%p");
	for (const bad of [null, [], {}, { version: 1, entries: { codex: { report: { snapshots: "bad" } } } }, cache([{}, {}])]) {
		assert.equal(plain(formatSubscriptionUsage(model.provider, codexUsage(bad, model), now)), "W--");
	}
});

test("reader throttles cache access, recovers from partial writes and expires old headers", () => {
	let reads = 0;
	let broken = false;
	const meter = createSubscriptionUsage(() => {
		reads++;
		if (broken) throw new Error("partial write");
		return cache([{ limitId: "codex", primary: weekly() }]);
	});
	assert.equal(plain(meter.label(model, now)), "W+18%p");
	meter.label(model, now + 1);
	assert.equal(reads, 1);
	broken = true;
	assert.equal(plain(meter.label(model, now + 5000)), "W--");
	broken = false;
	assert.equal(plain(meter.label(model, now + 10_000)), "W+18%p");
	const anthropic = { ...model, provider: "anthropic" };
	assert.equal(plain(meter.label(anthropic, now)), "W-- 5h --");
	meter.observe(headers(), now);
	meter.observe({}, now + 300_000);
	assert.equal(plain(meter.label(anthropic, now)), "W+18%p 5h 19%");
	assert.equal(plain(meter.label(anthropic, now + 300_001)), "W-- 5h --");
	assert.equal(reads, 3);
	assert.equal(meter.label(undefined), "");
});
