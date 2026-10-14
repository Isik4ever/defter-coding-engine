import type { CodingInput, CodingSource, Suggestion } from './types';

/**
 * Item 11: how good are the suggestions? Replays already-coded items in date order: the first `trainShare` of the
 * examples teach the coder, the rest are predicted and compared with the human's code.
 * Reports hit rate overall, per source, and for the "auto-approve" band (confidence ≥ 0.9).
 */
/**
 * Förbättringar 3 (88): `learnInput` = what production teaches for the item when it differs from what it suggests on (a
 * purchase qaimə is suggested with its line text, learnt without – `applyCoding`); `learn: false` = production never learns
 * from the item (coded by the automation, `auto_applied`) – the replay does not teach it either, so it cannot confirm itself.
 */
export type LabeledExample = { input: CodingInput; code: string; learnInput?: CodingInput; learn?: boolean };

/**
 * Förbättringar 3 (88): the newest `limit` examples by date – bank rows and qaimələr interleaved as they happened. (The replay
 * used to take the last `limit` of the list as it was read – bank rows first, invoices last – so a company with many
 * qaimələr replayed only invoices.) Stable: equal dates keep their order.
 */
export function evalSample(examples: LabeledExample[], limit?: number): LabeledExample[] {
	const sorted = examples.map((e, i) => ({ e, i })).sort((a, b) => (a.e.input.date ?? '').localeCompare(b.e.input.date ?? '') || a.i - b.i).map((x) => x.e);
	return limit && limit > 0 ? sorted.slice(-limit) : sorted;
}

/** Förbättringar 3 (88): how many bank rows and qaimələr an evaluation replayed (stored with every `ai_evals` row). */
export function evalMix(examples: LabeledExample[]): { bank: number; invoices: number } {
	const invoices = examples.filter((e) => e.input.kind === 'invoice').length;
	return { bank: examples.length - invoices, invoices };
}

export type EvalBucket = { n: number; hits: number; rate: number };
export type EvalReport = {
	train: number;
	test: number;
	covered: number; // predictions returned
	overall: EvalBucket;
	bySource: Record<CodingSource, EvalBucket>;
	auto: EvalBucket & { threshold: number }; // suggestions the inbox would approve without a human
	confusions: { expected: string; got: string; n: number }[];
};

export type EvalCoder = { learn(input: CodingInput, code: string): Promise<void> | void; suggest(input: CodingInput): Promise<Suggestion | null> | Suggestion | null };

/**
 * AI-förbättringar (29): did the nightly replay get worse? `prev`/`cur` = overall hit rate and test size of two runs. A drop of
 * at least `drop` (percentage points as a fraction) counts only when both runs replayed at least `minN` rows – a company
 * with 12 coded rows moves 8 points with one row.
 */
export const REGRESSION_DROP = 0.02;
export const REGRESSION_MIN_N = 30;
export type EvalPoint = { rate: number; n: number };

export function codingRegression(prev: EvalPoint | null | undefined, cur: EvalPoint, opts: { drop?: number; minN?: number } = {}): { regressed: boolean; drop: number } {
	const minN = opts.minN ?? REGRESSION_MIN_N;
	if (!prev || prev.n < minN || cur.n < minN) return { regressed: false, drop: 0 };
	const drop = Math.round((prev.rate - cur.rate) * 1000) / 1000;
	return { regressed: drop >= (opts.drop ?? REGRESSION_DROP) - 1e-9, drop };
}

const bucket = (): EvalBucket => ({ n: 0, hits: 0, rate: 0 });
const finish = (b: EvalBucket) => ({ ...b, rate: b.n ? Math.round((b.hits / b.n) * 1000) / 1000 : 0 });

export async function evaluateCoder(examples: LabeledExample[], coder: EvalCoder, opts: { trainShare?: number; autoThreshold?: number } = {}): Promise<EvalReport> {
	const share = opts.trainShare ?? 0.7;
	const th = opts.autoThreshold ?? 0.9;
	const sorted = [...examples].sort((a, b) => (a.input.date ?? '').localeCompare(b.input.date ?? ''));
	const cut = Math.floor(sorted.length * share);
	const train = sorted.slice(0, cut);
	const test = sorted.slice(cut);
	// (88) as production: an automated coding teaches nothing, a qaimə is learnt with the text production learns
	const teach = (e: LabeledExample) => (e.learn === false ? undefined : coder.learn(e.learnInput ?? e.input, e.code));
	for (const e of train) await teach(e);
	const overall = bucket();
	// `expected` never comes from the router (it is the bank row's match against the books) – kept for the record type
	const bySource: Record<CodingSource, EvalBucket> = { rule: bucket(), memory: bucket(), bayes: bucket(), llm: bucket(), expected: bucket() };
	const auto = { ...bucket(), threshold: th };
	const conf = new Map<string, number>();
	let covered = 0;
	for (const e of test) {
		const s = await coder.suggest(e.input);
		overall.n++;
		if (!s) continue;
		covered++;
		const hit = s.code === e.code;
		if (hit) overall.hits++;
		bySource[s.source].n++;
		if (hit) bySource[s.source].hits++;
		if (s.confidence >= th) {
			auto.n++;
			if (hit) auto.hits++;
		}
		if (!hit) {
			const k = `${e.code}→${s.code}`;
			conf.set(k, (conf.get(k) ?? 0) + 1);
		}
		// online: the human's answer becomes training data, as it does in the real inbox
		await teach(e);
	}
	const confusions = [...conf.entries()]
		.map(([k, n]) => ({ expected: k.split('→')[0], got: k.split('→')[1], n }))
		.sort((a, b) => b.n - a.n)
		.slice(0, 10);
	return { train: train.length, test: test.length, covered, overall: finish(overall), bySource: { rule: finish(bySource.rule), memory: finish(bySource.memory), bayes: finish(bySource.bayes), llm: finish(bySource.llm), expected: finish(bySource.expected) }, auto: { ...finish(auto), threshold: th }, confusions };
}
