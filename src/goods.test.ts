import { describe, expect, it } from 'vitest';
import { goodsInvoiceSuggestion, isGoodsUnit } from './goods';

describe('goodsInvoiceSuggestion (rollspel F-1.27)', () => {
	const grocery = [
		{ description: 'Makaron 400 q', unit: 'ədəd', qty: 120000 },
		{ description: 'Pomidor', unit: 'kq', qty: 45000 }
	];
	it('a trading company’s goods invoice → 205 with the lines as the reason', () => {
		const s = goodsInvoiceSuggestion(grocery, { trading: true });
		expect(s).toMatchObject({ code: '205', source: 'rule', defaultRule: true });
		expect(s?.why).toContain('2 sətir');
		expect(goodsInvoiceSuggestion(grocery, { trading: true, stockAccount: '201' })?.code).toBe('201');
	});
	it('no suggestion for a non-trading company, a service invoice, or a mixed one', () => {
		expect(goodsInvoiceSuggestion(grocery, { trading: false })).toBeNull();
		expect(goodsInvoiceSuggestion([{ description: 'Təmizlik xidməti 01/2025', unit: 'xidmət', qty: 1000 }], { trading: true })).toBeNull();
		expect(goodsInvoiceSuggestion([...grocery, { description: 'Çatdırılma', unit: null, qty: 1000 }], { trading: true })).toBeNull();
		expect(goodsInvoiceSuggestion([], { trading: true })).toBeNull();
	});
	it('quantity above one counts as goods even without a unit; units fold case and Cyrillic', () => {
		expect(goodsInvoiceSuggestion([{ description: 'Un', unit: null, qty: 50000 }], { trading: true })?.code).toBe('205');
		expect(goodsInvoiceSuggestion([{ description: 'Un', unit: null, qty: 1000 }], { trading: true })).toBeNull();
		expect(isGoodsUnit('KQ')).toBe(true);
		expect(isGoodsUnit('шт.')).toBe(true);
		expect(isGoodsUnit('xidmət')).toBe(false);
	});
});
