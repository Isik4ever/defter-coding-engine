import { tokens } from './normalize';

export type BayesCounts = { token: string; code: string; count: number }[];

/**
 * AI-förbättringar (26): besides the words, the naive Bayes sees three structural features of the row – the direction of the
 * money, the order of magnitude of the amount (AZN: < 10, < 100, < 1 000, < 10 000, ≥ 10 000) and the weekday. They are
 * tokens with a prefix no word can have (`§`), counted like words in `bayes_counts` and weighted `FEATURE_WEIGHT` in the
 * posterior – a supplier's small POS payments and its large transfers, or the same text in and out, no longer share one
 * distribution. Rows without a date have no weekday feature.
 */
export const FEATURE_WEIGHT = 0.5;
export const FEATURE_PREFIX = '§';

export function bayesFeatures(input: { amount?: number | null; direction?: 'in' | 'out' | null; date?: string | null }): string[] {
	const out: string[] = [];
	if (input.direction) out.push(`${FEATURE_PREFIX}dir:${input.direction}`);
	if (input.amount != null && Number.isFinite(input.amount) && input.amount !== 0) {
		const azn = Math.abs(input.amount) / 100;
		const bucket = azn < 10 ? 0 : azn < 100 ? 1 : azn < 1000 ? 2 : azn < 10000 ? 3 : 4;
		out.push(`${FEATURE_PREFIX}amt:${bucket}`);
	}
	if (input.date && /^\d{4}-\d{2}-\d{2}/.test(input.date)) {
		const d = new Date(input.date.slice(0, 10) + 'T00:00:00Z').getUTCDay();
		if (Number.isFinite(d)) out.push(`${FEATURE_PREFIX}dow:${d}`);
	}
	return out;
}

export const isFeatureToken = (t: string) => t.startsWith(FEATURE_PREFIX);

/** Multinomial naive Bayes over normalized tokens. */
export class NaiveBayes {
	private tokenCounts = new Map<string, Map<string, number>>(); // code → token → count
	private classTotals = new Map<string, number>(); // code → total tokens
	private docCounts = new Map<string, number>(); // code → docs
	private vocab = new Set<string>();
	private docs = 0;

	constructor(public minDocs = 20) {}

	get ready() {
		return this.docs >= this.minDocs && this.classTotals.size >= 2;
	}
	get size() {
		return this.docs;
	}

	train(text: string, code: string, weight = 1, features: string[] = []) {
		const words = tokens(text);
		if (!words.length) return;
		const ts = [...words, ...features];
		this.docs += weight;
		this.docCounts.set(code, (this.docCounts.get(code) ?? 0) + weight);
		const m = this.tokenCounts.get(code) ?? new Map<string, number>();
		for (const t of ts) {
			m.set(t, (m.get(t) ?? 0) + weight);
			this.vocab.add(t);
			this.classTotals.set(code, (this.classTotals.get(code) ?? 0) + weight);
		}
		this.tokenCounts.set(code, m);
	}

	/** Posterior per class, normalized to sum 1, sorted desc. `features` (26) count `FEATURE_WEIGHT` each. */
	predict(text: string, features: string[] = []): { code: string; p: number }[] {
		const ts = tokens(text);
		if (!ts.length || !this.classTotals.size) return [];
		const V = this.vocab.size || 1;
		// a feature the model never saw (counts trained before item 26) says nothing – it is left out rather than smoothed
		const fs = features.filter((f) => this.vocab.has(f));
		const logs: { code: string; lp: number }[] = [];
		for (const [code, total] of this.classTotals) {
			const m = this.tokenCounts.get(code)!;
			let lp = Math.log((this.docCounts.get(code) ?? 1) / this.docs);
			for (const t of ts) lp += Math.log(((m.get(t) ?? 0) + 1) / (total + V));
			for (const f of fs) lp += FEATURE_WEIGHT * Math.log(((m.get(f) ?? 0) + 1) / (total + V));
			logs.push({ code, lp });
		}
		const max = Math.max(...logs.map((l) => l.lp));
		const exps = logs.map((l) => ({ code: l.code, e: Math.exp(l.lp - max) }));
		const sum = exps.reduce((s, x) => s + x.e, 0);
		return exps.map((x) => ({ code: x.code, p: x.e / sum })).sort((a, b) => b.p - a.p);
	}

	/** (21) the words of `text` that speak most for `code` against the runner-up – for the Why of a bayes suggestion */
	evidence(text: string, code: string, against?: string | null, n = 2): string[] {
		const m = this.tokenCounts.get(code);
		if (!m) return [];
		const V = this.vocab.size || 1;
		const lp = (c: string, t: string) => Math.log(((this.tokenCounts.get(c)?.get(t) ?? 0) + 1) / ((this.classTotals.get(c) ?? 0) + V));
		return [...new Set(tokens(text))]
			.filter((t) => (m.get(t) ?? 0) > 0)
			.map((t) => ({ t, s: lp(code, t) - (against ? lp(against, t) : 0) }))
			.sort((a, b) => b.s - a.s)
			.slice(0, n)
			.map((x) => x.t);
	}

	export(): BayesCounts {
		const out: BayesCounts = [];
		for (const [code, m] of this.tokenCounts) for (const [token, count] of m) out.push({ token, code, count });
		for (const [code, count] of this.docCounts) out.push({ token: '__doc__', code, count });
		return out;
	}

	static from(counts: BayesCounts, minDocs = 20): NaiveBayes {
		const nb = new NaiveBayes(minDocs);
		for (const c of counts) {
			if (c.token === '__doc__') {
				nb.docCounts.set(c.code, (nb.docCounts.get(c.code) ?? 0) + c.count);
				nb.docs += c.count;
				continue;
			}
			const m = nb.tokenCounts.get(c.code) ?? new Map<string, number>();
			m.set(c.token, (m.get(c.token) ?? 0) + c.count);
			nb.tokenCounts.set(c.code, m);
			nb.vocab.add(c.token);
			nb.classTotals.set(c.code, (nb.classTotals.get(c.code) ?? 0) + c.count);
		}
		return nb;
	}
}
