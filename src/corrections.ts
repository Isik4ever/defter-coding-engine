/**
 * Automationsvåg 2 (1) – "lär av rättelser" (`docs/superpowers/plans/2026-09-25-automation-wave-2.md`, spår W1).
 *
 * The pure half: which corrections a human coding decision contains, when a company rule has been corrected often enough
 * to lose its automation (two corrections within 90 days → `demoted_at`; it still suggests), how much a corrected memory
 * example loses, how corrections are grouped (VÖEN, else the normalised text) and which pattern a rule proposal gets.
 * The service (`services/codingCorrections.ts`) reads and writes the database around it.
 */
import { tokens, normalize } from './normalize';
import { foldDots, ruleMatches } from './rules';
import type { CodingInput, Rule } from './types';

/**
 * AI-förbättringar (25): what a proposed rule would have done – over the company's coded rows of the last `IMPACT_DAYS`, how
 * many it matches (`hits`) and how many of those the accountant coded to another account (`wrong`, with the accounts they
 * went to). A proposal that would have hit 40 rows and got 6 wrong is a different decision from one that hits its 3 examples.
 */
export const IMPACT_DAYS = 90;
export type RuleImpact = { hits: number; wrong: number; right: number; wrongTo: { code: string; n: number }[] };

export function ruleImpact(rule: Pick<Rule, 'field' | 'pattern' | 'isRegex' | 'direction' | 'accountCode'> & Partial<Rule>, rows: { input: CodingInput; finalCode: string }[]): RuleImpact {
	const r: Rule = { priority: 0, ...rule };
	let hits = 0;
	let right = 0;
	const wrongTo = new Map<string, number>();
	for (const row of rows) {
		if (!ruleMatches(r, row.input)) continue;
		hits++;
		if (row.finalCode === r.accountCode) right++;
		else wrongTo.set(row.finalCode, (wrongTo.get(row.finalCode) ?? 0) + 1);
	}
	return { hits, right, wrong: hits - right, wrongTo: [...wrongTo.entries()].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n || a.code.localeCompare(b.code)).slice(0, 3) };
}

/** corrections of the same company rule inside `DEMOTE_WINDOW_DAYS` that demote it */
export const DEMOTE_AFTER = 2;
export const DEMOTE_WINDOW_DAYS = 90;
/** identical corrections (same VÖEN/text → same account) that make a rule proposal */
export const PROPOSE_AFTER = 3;
/** an accepted proposal becomes a company rule with this priority (hand-made rules default to 10, bundled defaults 30–70) */
export const PROPOSAL_PRIORITY = 20;
/** a corrected memory example never drops below this weight – it still explains itself, it just stops winning */
export const WEIGHT_FLOOR = 0.1;

/** What stood on the row before the person decided: the stored suggestion, or the coding a storno took back. */
export type CorrectionSuggestion = { code: string; source: string; why?: string | null; confidence?: number | null; ruleId?: number | null; auto?: boolean };
/** One way the app was wrong: the account it proposed/booked (`from`), from which source, and the company rule behind it. */
export type CorrectionEvent = { from: string; source: string; ruleId: number | null; auto: boolean };

/** The company rule a stored suggestion came from – `explainRule` writes "#<id> …" for a rule with an id (bundled defaults have none). */
export function ruleIdOf(source: string | null | undefined, why: string | null | undefined): number | null {
	if (source !== 'rule' || !why) return null;
	const m = /^#(\d+) /.exec(why);
	return m ? Number(m[1]) : null;
}

/**
 * The corrections in one decision: the stored suggestion when the person chose another account, and the pending coding a
 * storno took back (an auto-coded row, or one a company rule coded) when the new account differs from it. One event per
 * wrong account; the rule of either side is kept and the pending side marks the event as an automated one.
 */
export function correctionEvents(p: { finalCode: string; suggestion: CorrectionSuggestion | null; pending?: CorrectionSuggestion | null }): CorrectionEvent[] {
	const out: CorrectionEvent[] = [];
	const add = (s: CorrectionSuggestion | null | undefined, auto: boolean) => {
		if (!s?.code || s.code === p.finalCode) return;
		const ruleId = s.ruleId ?? ruleIdOf(s.source, s.why);
		const same = out.find((e) => e.from === s.code);
		if (same) {
			same.ruleId ??= ruleId;
			same.auto ||= auto;
			return;
		}
		out.push({ from: s.code, source: s.source, ruleId, auto });
	};
	add(p.pending ?? null, !!p.pending?.auto);
	add(p.suggestion, false);
	return out;
}

const DAY = 86_400_000;
const dayOf = (iso: string) => Date.parse(iso.slice(0, 10) + 'T00:00:00Z');

/** Two corrections (dates or timestamps) inside the window ending `today` – counting only those after `since` (a reactivation). */
export function shouldDemote(corrections: string[], today: string, opts: { since?: string | null } = {}): boolean {
	const from = dayOf(today) - DEMOTE_WINDOW_DAYS * DAY;
	// no upper bound: the log stamps UTC, `today` is the local day – a correction is never in the future
	const n = corrections.filter((c) => dayOf(c) >= from && (!opts.since || c > opts.since)).length;
	return n >= DEMOTE_AFTER;
}

/** A correction halves the weight of the memory example that proposed the wrong account (floor `WEIGHT_FLOOR`). */
export function loweredWeight(weight: number): number {
	return Math.max(WEIGHT_FLOOR, Math.round((weight / 2) * 10_000) / 10_000);
}

export type ProposalKey = { field: 'voen' | 'text'; key: string };

/** How corrections are grouped for a proposal: the VÖEN (ten digits) when the row has one, else the normalised text. */
export function proposalKeyOf(input: { text: string; voen?: string | null }): ProposalKey | null {
	const voen = (input.voen ?? '').replace(/\D/g, '');
	if (voen.length === 10) return { field: 'voen', key: voen };
	const key = normalize(input.text);
	return key ? { field: 'text', key } : null;
}

/** words that name a channel, a place or a legal form, never a party – they make no rule */
const GENERIC = new Set([
	'pos', 'atm', 'market', 'magaza', 'maqaza', 'baki', 'baku', 'filial', 'terminal', 'kart', 'card', 'visa', 'mastercard', 'transfer', 'kocurme',
	'hesab', 'bank', 'aze', 'azn', 'usd', 'eur', 'purchase', 'alis', 'satis', 'xidmet', 'medaxil', 'mexaric', 'odenis', 'debet', 'kredit',
	'payment', 'online', 'www', 'com', 'olan', 'uzre', 'ucun', 'tarixli', 'sayli', 'mmc', 'asc', 'qsc', 'ltd', 'llc'
]);
const low = (x: string) => foldDots(x).toLowerCase();

/** folded spellings of a name: ə → e (`foldDots`) and ə → a (a bank prints Əliyev as ALIYEV) */
const nameVariants = (x: string) => [...new Set([low(x), low(x.replace(/[əƏ]/g, 'a'))])];
const words = (x: string) => x.split(/[^\p{L}]+/u).filter(Boolean);

/**
 * Revisorskontroll W2-10: does a text pattern name one of these people? – the rule would hit bank texts naming the person
 * (the folded pattern, ≥ 3 letters, inside the name) or the pattern carries a first name/surname of ≥ 4 letters. Salary
 * and advances per person never become a company rule; a false alarm only costs a proposal.
 */
export function patternNamesPerson(pattern: string, names: string[]): boolean {
	const pv = nameVariants(pattern.trim()).filter((p) => p.length >= 3);
	if (!pv.length) return false;
	const pWords = new Set(pv.flatMap(words));
	for (const n of names) {
		for (const nv of nameVariants(n)) {
			if (pv.some((p) => nv.includes(p))) return true;
			if (words(nv).some((w) => w.length >= 4 && pWords.has(w))) return true;
		}
	}
	return false;
}

/** Revisorskontroll W2-2: two rules are "the same" rule (field, pattern, account, overlapping direction) – a re-created rule inherits. */
export function sameRule(a: { field: string; pattern: string; direction: string; accountCode: string }, b: { field: string; pattern: string; direction: string; accountCode: string }): boolean {
	const key = (r: { field: string; pattern: string }) => (r.field === 'voen' ? r.pattern.replace(/\D/g, '') : low(r.pattern.trim()));
	const dirs = a.direction === 'any' || b.direction === 'any' || a.direction === b.direction;
	return a.field === b.field && a.accountCode.trim() === b.accountCode.trim() && dirs && key(a) === key(b) && key(a) !== '';
}

/**
 * The pattern of a text proposal: the most specific word the examples share (lowest `df` – how many of the company's
 * texts carry it – then the longest), extended to a two-word phrase with its neighbour when every example carries that
 * phrase verbatim. Generic channel/place words never qualify; `null` when nothing specific is shared. The result is a
 * plain (non-regex) pattern: `ruleMatches` finds it in every example.
 */
export function proposalPattern(texts: string[], df: (token: string) => number = () => 0): string | null {
	if (!texts.length) return null;
	// tokens compare folded (ı/i, ə/e …) – a bank writes AZƏRİŞIQ, a receipt Azərişıq
	const folded = texts.map((t) => tokens(t).map(low));
	const lowered = texts.map(low);
	const first = tokens(texts[0]);
	const ok = (t: string | undefined): t is string => !!t && t.length >= 3 && !GENERIC.has(low(t)) && folded.every((s) => s.includes(low(t))) && lowered.every((l) => l.includes(low(t)));
	const common = first.filter((t, i) => first.indexOf(t) === i && ok(t));
	if (!common.length) return null;
	const best = [...common].sort((a, b) => df(a) - df(b) || b.length - a.length || first.indexOf(a) - first.indexOf(b))[0];
	const i = first.indexOf(best);
	// the more specific neighbour first (lower df), the following word on a tie
	const pairs = ([[best, first[i + 1]], [first[i - 1], best]] as [string | undefined, string | undefined][]).sort((x, y) => df((x[1] === best ? x[0] : x[1]) ?? '') - df((y[1] === best ? y[0] : y[1]) ?? ''));
	for (const [a, b] of pairs) {
		if (!ok(a) || !ok(b) || a === b) continue;
		const phrase = `${a} ${b}`;
		if (lowered.every((l) => l.includes(low(phrase)))) return phrase;
	}
	return best;
}
