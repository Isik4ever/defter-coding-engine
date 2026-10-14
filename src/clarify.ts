/**
 * AI-vågen (10) – "fråga i stället för att gissa". Given the coder's candidates for a row (the suggestion and its
 * alternatives: account, confidence, source), decide whether a person should get one targeted question instead of a guess:
 * - the best candidate is below the automation threshold (the gates would not code it anyway),
 * - the two best *plausible* candidates are within 0.15 of each other (the coder cannot tell them apart),
 * - both are plausible for the direction of the money / the kind of row (no income account for a payment, no expense for a
 *   receipt, never the money or settlement account of a qaimə, never 241 for a whole row – AI-7, VM 175: the input ƏDV
 *   comes only with the qaimə's ƏDV line, a payment to the ƏDV deposit account settles 531 – and never 521 for a qaimə).
 * The options (2–4) carry a short explanation from the template of the account pair (`rules/coding-questions.json`), the
 * question text is `cq.q.<key>` – `generic` when no template matches. Pure; the service stores the question.
 */
export type ClarifyCandidate = { code: string; confidence: number; source?: string };
export type QuestionTemplate = { key: string; a: string[]; b: string[]; hints: { a: string; b: string } };
export type ClarifyOption = { account: string; hint: string | null; confidence: number };
export type Clarification = { questionKey: string; options: ClarifyOption[] };

export const CLOSE_GAP = 0.15;
export const MIN_OPTION_CONFIDENCE = 0.15;
export const MAX_OPTIONS = 4;

const MONEY = /^(221|222|223|224|226)(-|$)/;
const SETTLEMENT = /^(211|217|221|223|531)(-|$)/;
/** AI-7: the whole amount of a row on 241 (input ƏDV) is never a coding – VM 175, AU-2 */
const INPUT_VAT = /^241(-|$)/;
const TAX_LIABILITY = /^521(-|$)/;

function matchesPrefix(account: string, p: string): boolean {
	return account === p || account.startsWith(p + '-') || (p.length < 3 && account.startsWith(p));
}

/** Can this account be the coding of a row of this kind and direction? Bank row: `out` = money out. Qaimə: its own direction – `in` = purchase, `out` = sale. */
export function plausibleAccount(code: string, kind: 'txn' | 'invoice', direction: 'in' | 'out'): boolean {
	if (!/^\d{3}/.test(code)) return false;
	if (INPUT_VAT.test(code)) return false;
	if (kind === 'invoice') {
		if (SETTLEMENT.test(code) || TAX_LIABILITY.test(code)) return false;
		return direction === 'out' ? /^6/.test(code) : !/^6/.test(code);
	}
	if (MONEY.test(code)) return false;
	return direction === 'out' ? !/^6/.test(code) : !/^(7|1|20)/.test(code);
}

/**
 * AI-förbättringar (24): a question the accountants keep dismissing is noise. Per template (`questionKey`), over the decisions
 * of the last `windowDays`: at least `minDismissed` dismissals and a dismissal share of at least `share` → the template is
 * not asked any more in this company. The window makes it self-healing: when nothing is asked, the old dismissals age out
 * and the template is tried again. `today` and `at` are ISO dates/timestamps.
 */
export const SUPPRESS_MIN_DISMISSED = 4;
export const SUPPRESS_SHARE = 0.75;
export const SUPPRESS_WINDOW_DAYS = 90;
export type QuestionDecision = { questionKey: string; status: 'answered' | 'dismissed' | string; at: string | null };

export function suppressedQuestionKeys(history: QuestionDecision[], today: string, opts: { minDismissed?: number; share?: number; windowDays?: number } = {}): Map<string, { dismissed: number; answered: number }> {
	const minDismissed = opts.minDismissed ?? SUPPRESS_MIN_DISMISSED;
	const share = opts.share ?? SUPPRESS_SHARE;
	const from = new Date(Date.parse(today.slice(0, 10) + 'T00:00:00Z') - (opts.windowDays ?? SUPPRESS_WINDOW_DAYS) * 86_400_000).toISOString().slice(0, 10);
	const counts = new Map<string, { dismissed: number; answered: number }>();
	for (const h of history) {
		if (!h.at || h.at.slice(0, 10) < from) continue;
		if (h.status !== 'answered' && h.status !== 'dismissed') continue;
		const c = counts.get(h.questionKey) ?? { dismissed: 0, answered: 0 };
		c[h.status]++;
		counts.set(h.questionKey, c);
	}
	const out = new Map<string, { dismissed: number; answered: number }>();
	for (const [key, c] of counts) if (c.dismissed >= minDismissed && c.dismissed / (c.dismissed + c.answered) >= share) out.set(key, c);
	return out;
}

export function clarify(cands: ClarifyCandidate[], opts: { threshold: number; kind: 'txn' | 'invoice'; direction: 'in' | 'out'; templates?: QuestionTemplate[] }): Clarification | null {
	if (!cands.length) return null;
	const best = Math.max(...cands.map((c) => c.confidence));
	if (best >= opts.threshold) return null;
	const seen = new Set<string>();
	const plausible = [...cands]
		.sort((a, b) => b.confidence - a.confidence)
		.filter((c) => (seen.has(c.code) ? false : (seen.add(c.code), true)))
		.filter((c) => plausibleAccount(c.code, opts.kind, opts.direction));
	if (plausible.length < 2) return null;
	const [first, second] = plausible;
	if (Math.round((first.confidence - second.confidence) * 1000) / 1000 >= CLOSE_GAP) return null;
	const picked = [first, second, ...plausible.slice(2).filter((c) => c.confidence >= MIN_OPTION_CONFIDENCE)].slice(0, MAX_OPTIONS);
	const tpl = (opts.templates ?? []).find((t) => (t.a.some((p) => matchesPrefix(first.code, p)) && t.b.some((p) => matchesPrefix(second.code, p))) || (t.b.some((p) => matchesPrefix(first.code, p)) && t.a.some((p) => matchesPrefix(second.code, p))));
	const hintOf = (code: string): string | null => {
		if (!tpl) return null;
		if (tpl.a.some((p) => matchesPrefix(code, p))) return tpl.hints.a;
		if (tpl.b.some((p) => matchesPrefix(code, p))) return tpl.hints.b;
		return null;
	};
	return { questionKey: tpl?.key ?? 'generic', options: picked.map((c) => ({ account: c.code, hint: hintOf(c.code), confidence: Math.round(c.confidence * 100) / 100 })) };
}
