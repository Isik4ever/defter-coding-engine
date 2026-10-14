import { describe, expect, it } from 'vitest';
import { evalMix, evalSample, evaluateCoder, type LabeledExample } from './evaluate';
import type { CodingInput } from './types';

const day = (i: number) => {
	const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000);
	return d.toISOString().slice(0, 10);
};

describe('förbättringar 3 (88) – the coding replay samples by date and teaches as production does', () => {
	it('500 bank rows and 450 qaimələr read bank-first: the newest 400 by date hold both kinds, in date order', () => {
		// as `evaluateCoding` reads them: every bank row, then every qaimə – both spread over the same year
		const bank: LabeledExample[] = Array.from({ length: 500 }, (_, i) => ({ input: { text: `bank ${i}`, amount: -100, direction: 'out', date: day(Math.floor((i * 364) / 500)) }, code: '721-7' }));
		const invoices: LabeledExample[] = Array.from({ length: 450 }, (_, i) => ({ input: { text: `qaimə ${i}`, amount: -100, direction: 'out', kind: 'invoice', date: day(Math.floor((i * 364) / 450)) }, code: '205' }));
		const all = [...bank, ...invoices];
		// the old slice(-limit) took the last 400 of the list – only qaimələr, from every month
		expect(evalMix(all.slice(-400))).toEqual({ bank: 0, invoices: 400 });
		const s = evalSample(all, 400);
		expect(s).toHaveLength(400);
		const mix = evalMix(s);
		expect(mix.bank).toBeGreaterThan(150);
		expect(mix.invoices).toBeGreaterThan(150);
		const dates = s.map((e) => e.input.date!);
		expect(dates).toEqual([...dates].sort());
		// the newest rows: nothing in the sample is older than anything left out
		const left = all.filter((e) => !s.includes(e)).map((e) => e.input.date!);
		expect(left.every((d) => d <= dates[0])).toBe(true);
		// no limit = everything, still in date order
		expect(evalSample(all)).toHaveLength(950);
	});

	it('an automated coding teaches nothing and a qaimə is taught with the text production learns', async () => {
		const taught: string[] = [];
		const coder = { learn: (i: CodingInput) => void taught.push(i.text), suggest: () => ({ code: '721-5', confidence: 0.5, source: 'bayes' as const, alternatives: [] }) };
		const ex: LabeledExample[] = [
			{ input: { text: 'Azercell abunə', amount: -10, direction: 'out', date: '2025-01-01' }, code: '721-5' },
			{ input: { text: 'Bravo qaimə 1 Şəkər 5 kq', amount: -10, direction: 'out', kind: 'invoice', date: '2025-01-02' }, learnInput: { text: 'Bravo qaimə 1', amount: -10, direction: 'out', kind: 'invoice', date: '2025-01-02' }, code: '205' },
			{ input: { text: 'Kontor auto', amount: -10, direction: 'out', date: '2025-01-03' }, code: '721-7', learn: false },
			{ input: { text: 'Azercell abunə', amount: -10, direction: 'out', date: '2025-02-01' }, code: '721-5' },
			{ input: { text: 'Kontor auto', amount: -10, direction: 'out', date: '2025-02-02' }, code: '721-7', learn: false }
		];
		const r = await evaluateCoder(ex, coder, { trainShare: 0.6 });
		expect(r.train).toBe(3);
		expect(r.test).toBe(2);
		// train: Azercell + the qaimə without its lines; test (online): Azercell again; the automated rows never
		expect(taught).toEqual(['Azercell abunə', 'Bravo qaimə 1', 'Azercell abunə']);
	});
});
