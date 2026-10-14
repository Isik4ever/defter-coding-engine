/**
 * AI-förbättringar (28) – kallstart. A new company has no memory and no rules of its own; the bundled default rules cover
 * utilities, taxes and bank fees but nothing of its trade. Two sources know more: the industry pack
 * (`rules/coding-industry-az.json`, per `companies.activity`) and the rules of the firm's other companies in the same
 * industry that share their coding (`companies.share_coding`). Both become *rule proposals* – a person accepts or rejects
 * each on `coding?tab=rules`; nothing is coded by them before that. Pure: the service reads the rows and stores proposals.
 */
import { sameRule } from './corrections';

export type IndustryRule = { field: 'text' | 'voen'; pattern: string; isRegex?: boolean; direction: 'in' | 'out' | 'any'; accountCode: string };
export type IndustryPack = Record<string, IndustryRule[]>;
export type ColdStartCandidate = IndustryRule & { origin: 'industry' | 'firm'; companies: number };

/** salary and deductions per person never come from another company or a pack */
const PAYROLL = /^(533|538)(-|$)/;

/** a company is cold while it has fewer decisions than this (coded bank rows + qaimələr) */
export const COLD_START_MAX_CODED = 50;

export function coldStartCandidates(p: {
	activity: string | null | undefined;
	pack: IndustryPack;
	siblings: { activity: string | null | undefined; rules: (IndustryRule & { demoted?: boolean })[] }[];
	existing: IndustryRule[];
}): ColdStartCandidate[] {
	const activity = p.activity ?? 'general';
	const out: ColdStartCandidate[] = [];
	const add = (r: IndustryRule, origin: ColdStartCandidate['origin']) => {
		if (!r.pattern?.trim() || !r.accountCode?.trim() || PAYROLL.test(r.accountCode)) return;
		const rule = { field: r.field, pattern: r.pattern.trim(), isRegex: !!r.isRegex, direction: r.direction, accountCode: r.accountCode.trim() };
		if (p.existing.some((e) => sameRule(e, rule))) return;
		const same = out.find((c) => sameRule(c, rule));
		if (same) {
			if (origin === 'firm') {
				same.companies++;
				same.origin = 'firm';
			}
			return;
		}
		out.push({ ...rule, origin, companies: origin === 'firm' ? 1 : 0 });
	};
	// the firm's similar companies first (their rules were decided by people who know the client base), one vote per company
	for (const s of p.siblings) {
		if ((s.activity ?? 'general') !== activity) continue;
		const seen: IndustryRule[] = [];
		for (const r of s.rules) {
			if (r.demoted || seen.some((x) => sameRule(x, r))) continue;
			seen.push(r);
			add(r, 'firm');
		}
	}
	for (const r of [...(p.pack[activity] ?? []), ...(activity === 'general' ? [] : p.pack.general ?? [])]) add(r, 'industry');
	return out.sort((a, b) => b.companies - a.companies || (a.origin === b.origin ? 0 : a.origin === 'firm' ? -1 : 1) || a.pattern.localeCompare(b.pattern));
}
