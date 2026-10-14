import { describe, expect, it } from 'vitest';
import { RECEIVED_ADVANCE_ACCOUNT, advanceReplaces, customerAdvanceCandidate } from './advance';

const base = { amount: 50000, voen: '1700000099', kind: null, residency: 'resident', issuesOurInvoices: false, suppliesUs: false };

describe('customer advance (R3, G 13.2): a payment without a qaimə of ours is 543, not 601', () => {
	it('the account is 543 (alınmış avans)', () => expect(RECEIVED_ADVANCE_ACCOUNT).toBe('543'));

	it('an inflow from a registered resident party with no qaimə of ours', () => {
		expect(customerAdvanceCandidate(base)).toBe(true);
		expect(customerAdvanceCandidate({ ...base, amount: -50000 })).toBe(false); // a payment out
		expect(customerAdvanceCandidate({ ...base, issuesOurInvoices: true })).toBe(false); // the payment settles 211
		expect(customerAdvanceCandidate({ ...base, voen: null })).toBe(false); // a person or a foreign client – no e-qaimə to look for
		expect(customerAdvanceCandidate({ ...base, residency: 'nonResident' })).toBe(false);
		expect(customerAdvanceCandidate({ ...base, suppliesUs: true })).toBe(false); // a supplier's refund
		for (const kind of ['bank', 'tax', 'owner', 'employee', 'supplier']) expect(customerAdvanceCandidate({ ...base, kind })).toBe(false);
		expect(customerAdvanceCandidate({ ...base, kind: 'customer' })).toBe(true);
	});

	it('replaces no suggestion, a bundled rule, bayes or the model on 601 – never the company’s rule or memory', () => {
		expect(advanceReplaces(null)).toBe(true);
		expect(advanceReplaces({ code: '601', source: 'bayes' })).toBe(true);
		expect(advanceReplaces({ code: '601-1', source: 'llm' })).toBe(true);
		expect(advanceReplaces({ code: '601', source: 'rule', defaultRule: true })).toBe(true);
		expect(advanceReplaces({ code: '601', source: 'memory' })).toBe(false);
		expect(advanceReplaces({ code: '601', source: 'rule' })).toBe(false);
		expect(advanceReplaces({ code: '211', source: 'bayes' })).toBe(false);
		expect(advanceReplaces({ code: '631', source: 'bayes' })).toBe(false);
	});
});
