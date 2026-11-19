import assert from "node:assert/strict";
import { test } from "node:test";
import { family, pickModel } from "./models.ts";

const ids = [
	"anthropic/claude-haiku-4-5",
	"anthropic/claude-haiku-4-5-20251001",
	"anthropic/claude-haiku-5-5",
	"anthropic/claude-opus-4-5",
	"anthropic/claude-opus-4-5-20251101",
	"anthropic/claude-opus-4-6",
	"anthropic/claude-opus-5",
	"anthropic/claude-opus-5-5",
	"openai-codex/gpt-6-sol",
	"openai-codex/gpt-6.1-sol",
	"openai-codex/gpt-6.1-terra",
	"openai-codex/gpt-6.2-astra",
	"openai-codex/gpt-6.2-sol",
];

test("a loose name picks the newest match", () => {
	assert.equal(pickModel(ids, "opus"), "anthropic/claude-opus-5-5");
	assert.equal(pickModel(ids, "haiku"), "anthropic/claude-haiku-5-5");
	assert.equal(pickModel(ids, "terra"), "openai-codex/gpt-6.1-terra");
	assert.equal(pickModel(ids, "sol"), "openai-codex/gpt-6.2-sol");
	assert.equal(pickModel(ids, "gpt 6.1 sol"), "openai-codex/gpt-6.1-sol");
});

test("a version picks the alias over its dated ids", () => {
	assert.equal(pickModel(ids, "opus 4.5"), "anthropic/claude-opus-4-5");
	assert.equal(pickModel(ids, "haiku 4-5"), "anthropic/claude-haiku-4-5");
});

test("an exact id wins, with or without provider", () => {
	assert.equal(pickModel(ids, "claude-opus-4-5-20251101"), "anthropic/claude-opus-4-5-20251101");
	assert.equal(pickModel(ids, "openai-codex/gpt-6-sol"), "openai-codex/gpt-6-sol");
	assert.equal(pickModel(ids, "Claude-Opus-5"), "anthropic/claude-opus-5");
});

test("words must start a part of the id", () => {
	assert.throws(() => pickModel(ids, "pus"), /No available model matches "pus"/);
	assert.throws(() => pickModel(ids, "gemini"), /No available model matches "gemini"/);
});

test("variants of the newest version are ambiguous", () => {
	assert.throws(() => pickModel(ids, "gpt"), /"gpt" is ambiguous: openai-codex\/gpt-6.2-astra, openai-codex\/gpt-6.2-sol/);
});

test("family is the first word of the id", () => {
	assert.equal(family("anthropic/claude-opus-5-5"), "claude");
	assert.equal(family("openai-codex/gpt-6.1-terra"), "gpt");
	assert.equal(family("gpt-6.1-terra"), "gpt");
});
