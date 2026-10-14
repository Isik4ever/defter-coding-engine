/**
 * AI-förbättringar (22) – kalibrerad konfidens. The router's confidence is a score, not a probability: a memory hit at 0.92 may
 * be right 99 % of the time in one company and 85 % in another. Given the company's own decisions (the proposal that stood on
 * a row, its source and confidence, and whether the accountant kept it), this measures the real hit rate per source and
 * confidence band and derives the lowest confidence from which the automation may code the source on its own.
 *
 * The recommendation only ever *raises* the configured threshold (`effectiveMin`): too little evidence says nothing, and a
 * source whose best band still misses the target is closed to automation (`BLOCKED`) until it improves. Pure.
 */

/** lower bounds of the confidence bands; the last band is [0.95, 1] */
export const CALIBRATION_BANDS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95] as const;
/** the hit rate the automation must reach from its threshold on */
export const CALIBRATION_TARGET = 0.95;
/** decisions needed at or above a cut-off before it may be recommended (or a source closed) */
export const CALIBRATION_MIN_N = 20;
/** a recommended minimum above 1 – no stored confidence reaches it: the source is not automated */
export const BLOCKED = 1.01;

/** `bulk` (förbättringar 3, 87): the decision came from "Hamısını təsdiq et" – nobody looked at the row, see `BULK_WEIGHT` */
export type CalibrationRow = { source: string; confidence: number; accepted: boolean; bulk?: boolean };
/**
 * Förbättringar 3 (87): a bulk approval is weak evidence – it counts a quarter of a reviewed decision, and it can only lower
 * the rate a cut-off is judged by, never raise it: a source whose reviewed decisions miss the target is not opened by
 * pressing "approve all", and a source with bulk approvals only has no evidence to be opened on.
 */
export const BULK_WEIGHT = 0.25;
export type CalibrationBand = { from: number; to: number; n: number; hits: number; rate: number };
export type SourceCalibration = {
	source: string;
	n: number;
	hits: number;
	rate: number;
	bands: CalibrationBand[];
	/** the lowest cut-off whose rows reach the target, `BLOCKED` when even the top band misses it with enough rows, null = too little evidence */
	autoMin: number | null;
	/** the observed rate of the rows at or above the configured threshold (null = none) */
	atThreshold: { n: number; rate: number } | null;
};
export type Calibration = { total: number; target: number; minN: number; bySource: SourceCalibration[] };

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function bandOf(confidence: number): number {
	let i = -1;
	for (const [k, b] of CALIBRATION_BANDS.entries()) if (confidence >= b - 1e-9) i = k;
	return i;
}

/**
 * Per source: the bands, and the recommended automation minimum – the smallest band bound `c` such that the decisions with
 * confidence ≥ c number at least `minN` and were right at least `target` of the time. `threshold` is the company's
 * configured minimum (0.9 by default) – only cut-offs at or above it are considered, so the result can only raise it.
 */
export function calibrate(rows: CalibrationRow[], opts: { target?: number; minN?: number; threshold?: number } = {}): Calibration {
	const target = opts.target ?? CALIBRATION_TARGET;
	const minN = opts.minN ?? CALIBRATION_MIN_N;
	const threshold = opts.threshold ?? 0.9;
	const bySourceRows = new Map<string, CalibrationRow[]>();
	for (const r of rows) {
		if (!Number.isFinite(r.confidence)) continue;
		const list = bySourceRows.get(r.source) ?? [];
		list.push(r);
		bySourceRows.set(r.source, list);
	}
	const bySource: SourceCalibration[] = [];
	for (const [source, list] of [...bySourceRows.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		const bands: CalibrationBand[] = CALIBRATION_BANDS.map((from, i) => ({ from, to: CALIBRATION_BANDS[i + 1] ?? 1, n: 0, hits: 0, rate: 0 }));
		for (const r of list) {
			const i = bandOf(r.confidence);
			if (i < 0) continue;
			bands[i].n++;
			if (r.accepted) bands[i].hits++;
		}
		for (const b of bands) b.rate = b.n ? round3(b.hits / b.n) : 0;
		const at = (c: number) => {
			const sel = list.filter((r) => r.confidence >= c - 1e-9);
			let n = 0;
			let hits = 0;
			let rn = 0;
			let rh = 0;
			for (const r of sel) {
				const w = r.bulk ? BULK_WEIGHT : 1;
				n += w;
				if (r.accepted) hits += w;
				if (!r.bulk) {
					rn++;
					if (r.accepted) rh++;
				}
			}
			// (87) the weighted rate, never above what the reviewed decisions alone show
			const rate = rn ? Math.min(n ? hits / n : 0, rh / rn) : n ? hits / n : 0;
			return { n, hits, rate, reviewed: rn, raw: sel.length, rawHits: sel.filter((r) => r.accepted).length };
		};
		const cuts = [threshold, ...CALIBRATION_BANDS.filter((b) => b > threshold + 1e-9)];
		let autoMin: number | null = null;
		for (const c of cuts) {
			const s = at(c);
			if (s.n >= minN && s.reviewed > 0 && s.rate >= target) {
				autoMin = c;
				break;
			}
		}
		if (autoMin == null) {
			// enough evidence at the configured threshold and still no cut-off reaches the target → closed; otherwise unknown
			const base = at(threshold);
			if (base.n >= minN && base.rate < target) autoMin = BLOCKED;
		}
		const base = at(threshold);
		const hits = list.filter((r) => r.accepted).length;
		bySource.push({ source, n: list.length, hits, rate: list.length ? round3(hits / list.length) : 0, bands, autoMin, atThreshold: base.raw ? { n: base.raw, rate: round3(base.rawHits / base.raw) } : null });
	}
	return { total: rows.length, target, minN, bySource };
}

/** The threshold the gates use for a source: the configured one, raised (never lowered) to the calibrated minimum. */
export function effectiveMin(configured: number, calibrated: number | null | undefined): number {
	return calibrated != null && calibrated > configured ? calibrated : configured;
}
