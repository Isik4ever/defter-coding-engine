import { NaiveBayes, bayesFeatures } from './bayes';
import { CodingMemory } from './memory';
import { applyRules } from './rules';
import type { CodingInput, Llm, Rule, Suggestion, CodingSource } from './types';
import { codingExplanation } from './explain';

export type Thresholds = { auto: number; memory: number; bayes: number; llmBelow: number };
export const DEFAULT_THRESHOLDS: Thresholds = { auto: 0.9, memory: 0.85, bayes: 0.6, llmBelow: 0.6 };

export type RouterDeps = {
	rules: Rule[];
	memory: CodingMemory;
	bayes: NaiveBayes;
	llm?: Llm | null;
	accounts?: { code: string; name: string }[];
	thresholds?: Partial<Thresholds>;
	/** V4 62: few-shot block (fewShotContext) handed to the LLM with every question */
	llmContext?: string;
};

type Cand = { code: string; confidence: number; source: CodingSource; why?: string };

/** rules → memory → bayes → llm. First layer over its threshold wins; else best candidate. */
/** accounts an invoice can never be coded to (its own receivable/payable and the money accounts) */
export const SETTLEMENT_ACCOUNT = /^(211|217|221|223|531)(-|$)/;

export class CodingRouter {
	private th: Thresholds;
	constructor(private deps: RouterDeps) {
		this.th = { ...DEFAULT_THRESHOLDS, ...(deps.thresholds ?? {}) };
	}

	async suggest(input: CodingInput): Promise<Suggestion | null> {
		const cands: Cand[] = [];
		const rule = applyRules(this.deps.rules, input);
		// a company's own rule (has an id) is a decision and always wins; a shipped default rule is a heuristic that yields once
		// the company has confirmed another account for the same text at least twice (bench 2026-09-18: POS receipts 601 vs 217).
		// Automationsvåg 2 (1): a company rule demoted by corrections yields the same way – the corrections taught the memory.
		if (rule && !rule.defaultRule && !rule.demoted) return rule;
		// F-2.7: for an invoice, hits that point at a settlement account come from the payments' memory and are not candidates
		const mem = (await this.deps.memory.query(input.text, 5, input.direction)).filter((h) => input.kind !== 'invoice' || !SETTLEMENT_ACCOUNT.test(h.code));
		if (rule) {
			const top = mem[0];
			if (top && top.score >= this.th.memory && top.votes >= 2 && top.code !== rule.code) {
				cands.push({ code: top.code, confidence: Math.min(0.97, top.score), source: 'memory', why: `${top.shared ? 'firm' : 'memory'}: "${top.text ?? ''}" ${Math.round(top.score * 100)} % ×${top.votes}${top.exact && top.of != null ? `/${top.of}` : ''} (overrides ${rule.demoted ? 'demoted' : 'default'} rule → ${rule.code})` });
				cands.push({ code: rule.code, confidence: rule.confidence - 0.1, source: 'rule', why: rule.why });
				return this.finish(cands);
			}
			return rule;
		}
		// förbättringar 3 (83): an exact hit's score already carries its votes and their agreement ("×5/6" in the Why); a
		// neighbour hit (kNN) keeps the single-neighbour discount
		for (const h of mem.slice(0, 3)) cands.push({ code: h.code, confidence: Math.min(0.97, h.exact ? h.score : h.score * (h.votes > 1 ? 1 : 0.98)), source: 'memory', why: `${h.shared ? 'firm' : 'memory'}: "${h.text ?? ''}" ${Math.round(h.score * 100)} % ×${h.votes}${h.exact && h.of != null ? `/${h.of}` : ''}${h.recency != null ? ` · köhnə təcrübə ×${h.recency}` : ''}` });
		if (mem[0] && mem[0].score >= this.th.memory) return this.finish(cands);

		if (this.deps.bayes.ready) {
			// AI-förbättringar (26): direction, order of magnitude and weekday next to the words
			const pred = this.deps.bayes.predict(input.text, bayesFeatures(input));
			for (const [i, p] of pred.slice(0, 3).entries()) {
				const words = this.deps.bayes.evidence(input.text, p.code, i === 0 ? pred[1]?.code : pred[0]?.code);
				cands.push({ code: p.code, confidence: Math.min(0.9, p.p * 0.9), source: 'bayes', why: `bayes: ${Math.round(p.p * 100)} % (${this.deps.bayes.size} nümunə)${words.length ? ` · "${words.join('", "')}"` : ''}` });
			}
			if (pred[0] && pred[0].p >= this.th.bayes) return this.finish(cands);
		}

		const best = cands.reduce((m, c) => (c.confidence > (m?.confidence ?? -1) ? c : m), null as Cand | null);
		if (this.deps.llm && (!best || best.confidence < this.th.llmBelow) && this.deps.accounts?.length) {
			const r = await this.deps.llm.suggest({ text: input.text, amount: input.amount, direction: input.direction, accounts: this.deps.accounts, context: this.deps.llmContext });
			if (r && this.deps.accounts.some((a) => a.code === r.code)) cands.push({ code: r.code, confidence: Math.min(0.75, r.confidence), source: 'llm', why: `llm: ${this.deps.llm.name}` });
		}
		return this.finish(cands);
	}

	private finish(cands: Cand[]): Suggestion | null {
		if (!cands.length) return null;
		const sorted = [...cands].sort((a, b) => b.confidence - a.confidence);
		const seen = new Set<string>();
		const uniq = sorted.filter((c) => (seen.has(c.code) ? false : (seen.add(c.code), true)));
		const [top, ...rest] = uniq;
		const out: Suggestion = { code: top.code, confidence: round(top.confidence), source: top.source, why: top.why, alternatives: rest.slice(0, 3).map((r) => ({ code: r.code, source: r.source, confidence: round(r.confidence) })) };
		out.explanation = codingExplanation(out);
		return out;
	}

	get thresholds() {
		return this.th;
	}

	/**
	 * Record a confirmed coding so future suggestions improve. `at` (AI-förbättringar 23) is when it was confirmed – the
	 * inbox passes the wall clock (as the stored memory rows carry), a replay (coding:eval) the document's date.
	 */
	async learn(input: CodingInput, code: string, at?: string | null) {
		await this.deps.memory.add(input.text, code, input.direction, at ?? input.date ?? null);
		this.deps.bayes.train(input.text, code, 1, bayesFeatures(input));
	}
}

function round(x: number) {
	return Math.round(x * 100) / 100;
}
