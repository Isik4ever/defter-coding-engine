import { describe, expect, it } from 'vitest';
import { clarify, plausibleAccount, type QuestionTemplate } from './clarify';
import rules from '../rules/coding-questions.json';

const templates = (rules as { templates: QuestionTemplate[] }).templates;
const opts = { threshold: 0.95, kind: 'txn' as const, direction: 'out' as const, templates };

describe('clarify', () => {
	it('two close candidates below the threshold → a question with the template of the pair', () => {
		const q = clarify([{ code: '111', confidence: 0.55 }, { code: '721-7', confidence: 0.48 }], opts);
		expect(q).toEqual({ questionKey: 'assetOrRepair', options: [{ account: '111', hint: 'asset', confidence: 0.55 }, { account: '721-7', hint: 'repair', confidence: 0.48 }] });
		// the pair in the other order finds the same template
		expect(clarify([{ code: '721-7', confidence: 0.6 }, { code: '113', confidence: 0.5 }], opts)?.questionKey).toBe('assetOrRepair');
	});
	it('no question when the best is sure enough, or when the gap is ≥ 0.15', () => {
		expect(clarify([{ code: '111', confidence: 0.96 }, { code: '721-7', confidence: 0.9 }], opts)).toBeNull();
		expect(clarify([{ code: '111', confidence: 0.7 }, { code: '721-7', confidence: 0.55 }], opts)).toBeNull();
		expect(clarify([{ code: '111', confidence: 0.7 }], opts)).toBeNull();
	});
	it('implausible accounts for the direction are left out – income for a payment, expense for a receipt', () => {
		expect(clarify([{ code: '601', confidence: 0.6 }, { code: '721-7', confidence: 0.55 }], opts)).toBeNull();
		const inn = clarify([{ code: '601', confidence: 0.6 }, { code: '211', confidence: 0.55 }, { code: '721-7', confidence: 0.5 }], { ...opts, direction: 'in' });
		expect(inn).toMatchObject({ questionKey: 'customerOrRevenue', options: [{ account: '601' }, { account: '211' }] });
		expect(plausibleAccount('223', 'txn', 'out')).toBe(false);
		expect(plausibleAccount('531', 'invoice', 'in')).toBe(false);
	});
	it('up to four options, weak ones dropped; generic without a template; duplicates once', () => {
		const q = clarify(
			[
				{ code: '721-5', confidence: 0.5 },
				{ code: '721-11', confidence: 0.45 },
				{ code: '721-5', confidence: 0.4 },
				{ code: '731', confidence: 0.3 },
				{ code: '721-8', confidence: 0.2 },
				{ code: '721-10', confidence: 0.18 },
				{ code: '721-3', confidence: 0.1 }
			],
			opts
		);
		expect(q?.questionKey).toBe('generic');
		expect(q?.options.map((o) => o.account)).toEqual(['721-5', '721-11', '731', '721-8']);
		expect(q?.options.every((o) => o.hint === null)).toBe(true);
	});
	it('every template names known hint sides', () => {
		for (const t of templates) {
			expect(t.a.length && t.b.length).toBeTruthy();
			expect(t.hints.a && t.hints.b).toBeTruthy();
		}
	});
	it('AI-7: never 241 for a whole qaimə or bank row (VM 175), never 521 for a qaimə; no ƏDV-or-cost template', () => {
		const inv = clarify([{ code: '241', confidence: 0.5 }, { code: '721-11', confidence: 0.45 }, { code: '721-7', confidence: 0.4 }], { ...opts, kind: 'invoice', direction: 'in' });
		expect(JSON.stringify(inv)).not.toContain('"241"');
		expect(clarify([{ code: '241', confidence: 0.5 }, { code: '721-11', confidence: 0.45 }], { ...opts, kind: 'invoice', direction: 'in' })).toBeNull();
		expect(clarify([{ code: '241', confidence: 0.5 }, { code: '721-11', confidence: 0.45 }], { ...opts, kind: 'txn', direction: 'out' })).toBeNull();
		expect(plausibleAccount('241', 'invoice', 'in')).toBe(false);
		expect(plausibleAccount('241-1', 'txn', 'out')).toBe(false);
		expect(plausibleAccount('521-1', 'invoice', 'in')).toBe(false);
		// a tax payment from the bank is 521 – that stays a possible answer
		expect(plausibleAccount('521-2', 'txn', 'out')).toBe(true);
		expect(templates.some((t) => t.a.includes('241') || t.b.includes('241'))).toBe(false);
	});
});
