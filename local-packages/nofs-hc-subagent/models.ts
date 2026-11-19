// A loose model name ("opus", "gpt 6.1", "claude-opus-4-5") -> one exact
// provider/id out of the models pi can run right now.

/**
 * The newest id matching `query`. Throws when nothing matches or when the
 * newest version has several variants.
 */
export function pickModel(ids: string[], query: string): string {
	const matches = matchModels(ids, query);
	if (!matches.length) throw new Error(`No available model matches "${query}". Available: ${ids.join(", ")}`);
	return newest(matches, query);
}

/** The first word of the id: anthropic/claude-opus-5-5 -> claude. */
export function family(id: string): string {
	return id.slice(id.lastIndexOf("/") + 1).split("-")[0];
}

/** "." and "-" are interchangeable: "4.6" finds claude-opus-4-6. */
function normalize(text: string): string {
	return text.toLowerCase().replace(/\./g, "-");
}

/**
 * An exact id (with or without provider) wins outright. Otherwise every word of
 * the query must start a part of the id, so "4" finds claude-opus-4-5 but "pus" finds nothing.
 */
function matchModels(ids: string[], query: string): string[] {
	const q = normalize(query.trim());
	const exact = ids.filter((id) => normalize(id) === q || normalize(id).endsWith(`/${q}`));
	if (exact.length) return exact;
	const words = q
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => new RegExp(`(^|[-/])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	return ids.filter((id) => words.every((word) => word.test(normalize(id))));
}

/**
 * Highest version wins, numbers compared left to right; numbers of 4+ digits
 * are dates, not versions. Among equal versions an alias wins over the ids it
 * prefixes (claude-opus-4-5 over claude-opus-4-5-20251101); other ties are ambiguous.
 */
function newest(ids: string[], query: string): string {
	const version = (id: string) => (id.match(/\d+/g) ?? []).filter((n) => n.length < 4).map(Number);
	const compare = (a: string, b: string) => {
		const va = version(a);
		const vb = version(b);
		for (let i = 0; i < Math.max(va.length, vb.length); i++) {
			const diff = (vb[i] ?? -1) - (va[i] ?? -1);
			if (diff) return diff;
		}
		return 0;
	};
	const sorted = [...ids].sort(compare);
	const tied = sorted.filter((id) => compare(id, sorted[0]) === 0);
	const alias = tied.find((id) => tied.every((other) => other.startsWith(id)));
	if (alias) return alias;
	throw new Error(`"${query}" is ambiguous: ${tied.join(", ")}; name one of them`);
}
