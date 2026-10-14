import type { MetricRow } from './metrics';

/**
 * V4 59: active learning – which uncoded rows should a human look at first, and how did past corrections move
 * the acceptance rate. Pure functions over plain rows; the service feeds them from the inbox and coding_metrics.
 */

export type ReviewInput = {
	id: number;
	kind?: 'txn' | 'invoice';
	/** stored suggestion confidence 0..1, null when nothing was proposed */
	confidence: number | null;
	source: string | null;
	/** signed qəpik */
	amount: number;
	text: string;
	/** true when the memory already knows this text (exact normalised hit) – such rows teach nothing new */
	memoryHit?: boolean;
};

export type ReviewReason = 'uncertain' | 'bigAmount' | 'novel' | 'noSuggestion' | 'routine';

export type ReviewItem = ReviewInput & { score: number; reason: ReviewReason; rank: number };

/** Band where a correction (or an acceptance) is most informative for the suggester. */
export const UNCERTAIN_BAND = { low: 0.5, high: 0.8 } as const;

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function uncertainty(c: number | null): number {
	if (c == null || c < UNCERTAIN_BAND.low || c > UNCERTAIN_BAND.high) return 0;
	const mid = (UNCERTAIN_BAND.low + UNCERTAIN_BAND.high) / 2;
	const half = (UNCERTAIN_BAND.high - UNCERTAIN_BAND.low) / 2;
	return round3(1 - Math.abs(c - mid) / half);
}

/**
 * Orders rows for review: uncertain suggestions (0.5–0.8) first, then large amounts, then texts the memory has never
 * seen, then the rest. The score is tier + a within-tier component so callers can show it: 3.x uncertain,
 * 2.x big amount, 1.x novel, 0.x routine. Rows without a suggestion count as novel when the memory has no hit.
 */
export function rankForReview(items: ReviewInput[], opts: { bigShare?: number; minBig?: number } = {}): ReviewItem[] {
	if (!items.length) return [];
	const abs = items.map((i) => Math.abs(i.amount));
	const maxAbs = Math.max(1, ...abs);
	const sorted = [...abs].sort((a, b) => a - b);
	const q = sorted[Math.floor((sorted.length - 1) * (opts.bigShare ?? 0.75))];
	const minBig = opts.minBig ?? 10000; // 100 AZN
	const amountScore = (a: number) => round3(Math.log10(1 + a / 100) / Math.log10(1 + maxAbs / 100));
	const out: ReviewItem[] = items.map((it) => {
		const a = Math.abs(it.amount);
		const u = uncertainty(it.confidence);
		const as = amountScore(a);
		const novel = !it.memoryHit && it.source !== 'memory' && it.source !== 'rule';
		let reason: ReviewReason;
		let score: number;
		if (u > 0) {
			reason = 'uncertain';
			score = 3 + u;
		} else if (a >= Math.max(q, minBig) && a > 0) {
			reason = 'bigAmount';
			score = 2 + as;
		} else if (it.confidence == null && novel) {
			reason = 'noSuggestion';
			score = 1 + as;
		} else if (novel) {
			reason = 'novel';
			score = 1 + as * 0.9;
		} else {
			reason = 'routine';
			score = as * 0.9;
		}
		return { ...it, score: round3(score), reason, rank: 0 };
	});
	out.sort((x, y) => y.score - x.score || Math.abs(y.amount) - Math.abs(x.amount) || x.id - y.id);
	out.forEach((x, i) => (x.rank = i + 1));
	return out;
}

export type CurvePoint = {
	/** number of outcomes covered so far (cumulative) */
	n: number;
	/** cumulative Bronn number after this bucket */
	bronn: number;
	/** Bronn number inside this bucket only */
	windowBronn: number;
	/** change of the cumulative Bronn vs the previous point */
	delta: number;
	accepted: number;
	corrected: number;
	manual: number;
	/** first/last timestamps in the bucket */
	from: string;
	to: string;
};

/**
 * Cumulative Bronn number in buckets of `step` outcomes (chronological). `delta` shows how the corrections and
 * acceptances in each bucket moved the overall rate – a learning suggester makes it climb, a stale one flattens.
 */
export function learningCurve(rows: MetricRow[], step = 50): CurvePoint[] {
	if (!rows.length) return [];
	const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at));
	const out: CurvePoint[] = [];
	let acc = 0;
	let prev = 0;
	for (let i = 0; i < sorted.length; i += step) {
		const bucket = sorted.slice(i, i + step);
		const accepted = bucket.filter((r) => r.outcome === 'accepted').length;
		const corrected = bucket.filter((r) => r.outcome === 'corrected').length;
		const manual = bucket.length - accepted - corrected;
		acc += accepted;
		const n = Math.min(sorted.length, i + step);
		const bronn = round3(acc / n);
		out.push({ n, bronn, windowBronn: round3(accepted / bucket.length), delta: round3(bronn - prev), accepted, corrected, manual, from: bucket[0].at.slice(0, 10), to: bucket[bucket.length - 1].at.slice(0, 10) });
		prev = bronn;
	}
	return out;
}

/**
 * Per correction: the acceptance rate for that account in the `window` outcomes before vs after it.
 * Positive `moved` means later suggestions for the same account were accepted more often.
 */
export function correctionImpact(rows: MetricRow[], window = 20): { at: string; finalCode: string; before: number | null; after: number | null; moved: number | null }[] {
	const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at));
	const out: { at: string; finalCode: string; before: number | null; after: number | null; moved: number | null }[] = [];
	const rate = (rs: MetricRow[]) => (rs.length ? round3(rs.filter((r) => r.outcome === 'accepted').length / rs.length) : null);
	sorted.forEach((r, i) => {
		if (r.outcome !== 'corrected') return;
		const same = (x: MetricRow) => x.finalCode === r.finalCode;
		const before = rate(sorted.slice(Math.max(0, i - window), i).filter(same));
		const after = rate(sorted.slice(i + 1, i + 1 + window).filter(same));
		out.push({ at: r.at, finalCode: r.finalCode, before, after, moved: before != null && after != null ? round3(after - before) : null });
	});
	return out;
}
