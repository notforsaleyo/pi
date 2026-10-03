// input-box.ts / footer.ts 공용 색 헬퍼. package.json 의 extensions 에 없으므로 확장으로 로드되지 않음

export type RGB = [number, number, number];

export const GREEN: RGB = [56, 150, 60];
export const TEAL: RGB = [0, 150, 170];
export const YELLOW: RGB = [190, 140, 0];
export const ORANGE: RGB = [230, 110, 0];
export const RED: RGB = [220, 0, 0];
export const BLUE: RGB = [30, 100, 220];

export const fg = (rgb: RGB, s: string) => `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${s}\x1b[39m`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
export const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;

const RAINBOW: RGB[] = [
	[230, 57, 70],
	[244, 140, 6],
	[214, 170, 0],
	[56, 176, 0],
	[0, 150, 199],
	[86, 90, 220],
	[176, 70, 200],
];

// 무지개색이 시간에 따라 흐르고, 밝은 하이라이트가 지나감. 움직이려면 ANIM_MS 마다 다시 그려야 함
export const ANIM_MS = 100;
export function animatedLabel(text: string): string {
	const t = Date.now() / ANIM_MS;
	const shift = Math.floor(t / 2);
	const shine = (Math.floor(t) % (text.length + 8)) - 2; // 하이라이트 위치 (일부 구간은 쉼)
	return bold(
		[...text]
			.map((c, i) => {
				const base = RAINBOW[(i + shift) % RAINBOW.length]!;
				const d = Math.abs(i - shine);
				const f = d === 0 ? 0.6 : d === 1 ? 0.3 : 0;
				return fg(base.map((v) => Math.round(v + (255 - v) * f)) as RGB, c);
			})
			.join(""),
	);
}

// 추론 강도: low 초록 / medium 청록 / high 굵은 노랑 / xhigh 굵은 빨강 / max 무지개
// medium 부터 번개 1개, 이후 단계마다 1개씩 추가
const BOLT = "\uf0e7";
const THINKING: Record<string, { bolts: number; style: (s: string) => string }> = {
	low: { bolts: 0, style: (s) => fg(GREEN, s) },
	medium: { bolts: 1, style: (s) => fg(TEAL, s) },
	high: { bolts: 2, style: (s) => bold(fg(YELLOW, s)) },
	xhigh: { bolts: 3, style: (s) => bold(fg(RED, s)) },
	max: { bolts: 4, style: animatedLabel },
};

export function thinkingLabel(level: string): string {
	const t = THINKING[level];
	if (!t) return dim(level);
	return t.style(t.bolts ? `${BOLT.repeat(t.bolts)} ${level}` : level);
}
