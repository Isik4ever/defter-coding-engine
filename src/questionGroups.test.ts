import { describe, expect, it } from 'vitest';
import { groupQuestions, partyKey, questionGroupKey, type GroupableQuestion } from './questionGroups';

let id = 0;
const q = (over: Partial<GroupableQuestion> = {}): GroupableQuestion => ({ id: ++id, targetType: 'txn', targetId: id, questionKey: 'rentOrUtilities', options: [{ account: '721-3' }, { account: '721-4' }], direction: 'out', counterpartyId: 7, voen: null, text: 'AZERISIQ ODENIS 2026/08 ref 44127', ...over });

describe('(58) question cards grouped per party and question', () => {
	it('the party: counterparty → VÖEN; the bank text alone never names a party (AI2-22)', () => {
		expect(partyKey({ counterpartyId: 7, voen: '1234567890', text: 'x' })).toBe('cp:7');
		expect(partyKey({ counterpartyId: null, voen: '1234567890', text: 'x' })).toBe('voen:1234567890');
		expect(partyKey({ counterpartyId: null, voen: '12 345', text: 'AZƏRİŞIQ ÖDƏNİŞ 2026/08 ref 44127' })).toBeNull();
		expect(partyKey({ counterpartyId: null, voen: null, text: 'AZERSU ODENIS' })).toBeNull();
		expect(partyKey({ counterpartyId: null, voen: null, text: '12 / 34' })).toBeNull();
	});

	it('same party + same question + same options + same direction = one card; anything different stays apart', () => {
		const rows = [
			q({ text: 'AZERISIQ ODENIS 2026/06 ref 1' }),
			q({ text: 'AZERISIQ ODENIS 2026/07 ref 2', options: [{ account: '721-4' }, { account: '721-3' }] }),
			q({ text: 'AZERISIQ ODENIS 2026/08 ref 3' }),
			q({ text: 'AZERISIQ ODENIS 2026/08 ref 4', direction: 'in' }),
			q({ text: 'AZERISIQ ODENIS 2026/08 ref 5', questionKey: 'generic' }),
			q({ text: 'AZERISIQ ODENIS 2026/08 ref 6', options: [{ account: '721-3' }, { account: '721-11' }] }),
			q({ text: 'BRAVO MARKET 0145', counterpartyId: 9 }),
			q({ text: '—', counterpartyId: null })
		];
		const g = groupQuestions(rows);
		expect(g.map((x) => x.items.map((i) => i.id))).toEqual([[rows[0].id, rows[1].id, rows[2].id], [rows[3].id], [rows[4].id], [rows[5].id], [rows[6].id], [rows[7].id]]);
		expect(questionGroupKey(rows[7])).toBeNull();
		// an invoice and a bank row are never one question
		expect(questionGroupKey(q({ counterpartyId: 3 }))).not.toBe(questionGroupKey(q({ counterpartyId: 3, targetType: 'invoice' })));
	});

	it('AI2-22: rows without a counterparty or VÖEN are never grouped on their bank text – twelve unknown payers are twelve cards', () => {
		const generic = ['ÖDƏNİŞ QAİMƏ ÜZRƏ', 'ODENIS QAIME UZRE', 'Оплата по счету', 'Payment invoice'].map((text) => q({ counterpartyId: null, voen: null, text }));
		expect(groupQuestions(generic).map((x) => x.items.length)).toEqual([1, 1, 1, 1]);
		// even an identical, specific text is not a party
		const same = [q({ counterpartyId: null, voen: null, text: 'AZERSU ODENIS' }), q({ counterpartyId: null, voen: null, text: 'AZERSU ODENIS' })];
		expect(groupQuestions(same).map((x) => x.items.length)).toEqual([1, 1]);
		// the same VÖEN is a party
		const voen = [q({ counterpartyId: null, voen: '1400123456', text: 'ÖDƏNİŞ QAİMƏ ÜZRƏ' }), q({ counterpartyId: null, voen: '1400123456', text: 'ÖDƏNİŞ QAİMƏ ÜZRƏ 2' })];
		expect(groupQuestions(voen).map((x) => x.items.length)).toEqual([2]);
	});
});
