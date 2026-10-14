/**
 * AI-förbättringar (21): the Why of a *stored* coding suggestion – what sits on a bank row or qaimə (`suggested_code`,
 * `_confidence` 0–100, `_source`, `_why`) and on every row the automation coded. The inbox, the list of automatic codings,
 * the ledger's auto mark and the question cards all render it with <Why>, so a person sees the same reasons everywhere:
 * the why text split into its parts (" · "), the bundled default rule marked as such, the company rule behind the hit
 * linked to the rules tab, and – for an automatic coding – that the app did it (draft or posted). Pure.
 */
import { codingExplanation, type Explanation, type Reason } from './explain';

/** `services/coding.ts` DEFAULT_RULE_WHY – duplicated here, the engine does not import the server */
const DEFAULT_RULE_MARK = 'standart qayda · ';
const SOURCES = new Set(['rule', 'memory', 'bayes', 'llm', 'expected']);

export type StoredSuggestion = { code: string | null; confidence: number | null; source: string | null; why: string | null; auto?: 'draft' | 'post' | null };

export function storedExplanation(s: StoredSuggestion, base = ''): Explanation | null {
	if (!s.code) return null;
	const source = (SOURCES.has(s.source ?? '') ? s.source : 'rule') as 'rule' | 'memory' | 'bayes' | 'llm' | 'expected';
	let why = (s.why ?? '').trim();
	const defaultRule = why.startsWith(DEFAULT_RULE_MARK);
	if (defaultRule) why = why.slice(DEFAULT_RULE_MARK.length);
	const x = codingExplanation({ code: s.code, confidence: Math.max(0, Math.min(1, (s.confidence ?? 0) / 100)), source });
	const reasons: Reason[] = [];
	if (s.auto) reasons.push({ key: 'auto', text: s.auto === 'post' ? 'avtomatik yazılış' : 'avtomatik qaralama' });
	if (defaultRule) reasons.push({ key: 'defaultRule', text: 'standart qayda (şirkətin qərarı deyil)' });
	for (const part of why.split(' · ').map((p) => p.trim()).filter(Boolean)) reasons.push({ key: source, text: part });
	if (!why && !defaultRule) reasons.push({ key: source, text: source });
	const rule = /^#(\d+) /.exec(why);
	if (rule) x.evidence.push({ kind: 'rule', id: Number(rule[1]), label: `#${rule[1]}`, href: `${base}/coding?tab=rules` });
	x.reasons = [...reasons, ...x.reasons];
	return x;
}
