import type { CodingInput, Rule, Suggestion } from './types';

export const RULE_CONFIDENCE = 0.98;

/**
 * Turkic dots: İ→i, ı→i, so "AZƏRIŞIQ", "Azərişıq" and "azərişıq" all compare equal. Rollspel F-4.6 (Nigar): a receipt printer or
 * a bank writes "OFIS LEVAZIMATI" for "ofis ləvazimatı" – ə/ö/ü/ş/ç/ğ are folded to their plain letters on both sides too.
 * Regex metacharacters and Cyrillic are untouched.
 */
export const foldDots = (x: string) => x.replace(/İ/g, 'i').replace(/ı/g, 'i').replace(/[əƏ]/g, 'e').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u').replace(/[şŞ]/g, 's').replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g');
const low = (x: string) => foldDots(x).toLowerCase();

export function ruleMatches(rule: Rule, input: CodingInput): boolean {
	if (rule.direction !== 'any' && rule.direction !== input.direction) return false;
	const abs = Math.abs(input.amount);
	if (rule.minAmount != null && abs < rule.minAmount) return false;
	if (rule.maxAmount != null && abs > rule.maxAmount) return false;
	if (rule.dateFrom && (!input.date || input.date < rule.dateFrom)) return false;
	if (rule.dateTo && (!input.date || input.date > rule.dateTo)) return false;
	const value = rule.field === 'text' ? input.text : rule.field === 'voen' ? (input.voen ?? '') : (input.reference ?? '');
	if (!value) return false;
	if (rule.isRegex) {
		try {
			// İ (U+0130) has no simple case folding – /icarə/iu never matches "İCARƏSİ"; and a bank writes AZƏRIŞIQ with a
			// dotless capital that lowercases to "i" while the rule says "ı" (rollspel F-1.29) – fold both sides to i
			return new RegExp(foldDots(rule.pattern), 'iu').test(foldDots(value));
		} catch {
			return false;
		}
	}
	return low(value).includes(low(rule.pattern));
}

/**
 * First matching rule by ascending priority. Automationsvåg 2 (1): a company rule demoted by corrections yields to every live
 * company rule that matches (an accepted proposal, priority 20, beats the suspended rule it replaces); against the bundled
 * defaults it keeps its priority – the company's knowledge, even suspended, is not replaced by a generic word list.
 */
export function applyRules(rules: Rule[], input: CodingInput): Suggestion | null {
	const sorted = [...rules].sort((a, b) => a.priority - b.priority);
	let hits = sorted.filter((r) => ruleMatches(r, input));
	if (!hits.length) return null;
	if (hits[0].demoted) {
		const live = hits.find((h) => h.id != null && !h.demoted);
		if (live) hits = [live, ...hits.filter((h) => h !== live)];
	}
	return {
		code: hits[0].accountCode,
		confidence: RULE_CONFIDENCE,
		source: 'rule',
		alternatives: hits.slice(1, 4).map((h) => ({ code: h.accountCode, confidence: RULE_CONFIDENCE - 0.05, source: 'rule' as const })),
		why: explainRule(hits[0]),
		defaultRule: hits[0].id == null,
		demoted: !!hits[0].demoted
	};
}

export function explainRule(r: Rule): string {
	const cond = [r.minAmount != null ? `≥ ${(r.minAmount / 100).toFixed(2)}` : '', r.maxAmount != null ? `≤ ${(r.maxAmount / 100).toFixed(2)}` : '', r.dateFrom ? `${r.dateFrom}…` : '', r.dateTo ? `…${r.dateTo}` : ''].filter(Boolean).join(' ');
	return `${r.id ? `#${r.id} ` : ''}${r.field}: "${r.pattern}"${r.isRegex ? ' /i' : ''}${r.direction !== 'any' ? ` (${r.direction})` : ''}${cond ? ` ${cond}` : ''} → ${r.accountCode}`;
}
