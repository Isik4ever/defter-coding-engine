import { describe, it, expect } from 'vitest';
import { HashingEmbedder } from './hashing';
import { CodingMemory, exactScore } from './memory';
import { NaiveBayes } from './bayes';
import { CodingRouter } from './router';
import type { CodingInput } from './types';

const out = (text: string, date = '2025-06-05'): CodingInput => ({ text, amount: -10000, direction: 'out', date });

async function memoryWith(votes: [string, number][]) {
	const mem = new CodingMemory(new HashingEmbedder(256));
	for (const [code, n] of votes) for (let i = 0; i < n; i++) await mem.add('Ofis Servis MMC', code, 'out', '2025-06-01');
	return mem;
}

describe('förbättringar 3 (83) – an exact hit is as sure as its confirmations and their agreement', () => {
	it('the score grows with the votes and falls with a split', () => {
		expect(exactScore(1, 1)).toBeCloseTo(0.88, 5);
		expect(exactScore(2, 1)).toBeCloseTo(0.93, 5);
		expect(exactScore(3, 1)).toBeCloseTo(0.97, 5);
		expect(exactScore(9, 0.9)).toBeCloseTo(0.97, 5); // ≥ 90 % agreement counts as agreement
		expect(exactScore(5, 5 / 6)).toBeLessThan(0.9);
	});

	it('one confirmation stays under the automation (< 0.9)', async () => {
		const hits = await (await memoryWith([['721-7', 1]])).query('Ofis Servis MMC', 5, 'out');
		expect(hits[0]).toMatchObject({ code: '721-7', votes: 1, of: 1, exact: true });
		expect(hits[0].score).toBeLessThan(0.9);
	});

	it('a 5:1 split keeps the majority on top, but under the gates (< 0.9)', async () => {
		const hits = await (await memoryWith([['721-7', 5], ['721-8', 1]])).query('Ofis Servis MMC', 5, 'out');
		expect(hits.map((h) => h.code)).toEqual(['721-7', '721-8']);
		expect(hits[0].score).toBeLessThan(0.9);
		expect(hits[0]).toMatchObject({ votes: 5, of: 6 });
	});

	it('six agreeing confirmations reach the bank gate (≥ 0.95)', async () => {
		const hits = await (await memoryWith([['721-7', 6]])).query('Ofis Servis MMC', 5, 'out');
		expect(hits[0].score).toBeGreaterThanOrEqual(0.95);
	});

	it('the router: 1 vote < 0.9, 5:1 split < 0.9, 6:0 ≥ 0.95, and the Why says "×5/6"', async () => {
		const route = async (votes: [string, number][]) => new CodingRouter({ rules: [], memory: await memoryWith(votes), bayes: new NaiveBayes() }).suggest(out('Ofis Servis MMC'));
		expect((await route([['721-7', 1]]))!.confidence).toBeLessThan(0.9);
		const split = (await route([['721-7', 5], ['721-8', 1]]))!;
		expect(split.code).toBe('721-7');
		expect(split.confidence).toBeLessThan(0.9);
		expect(split.why).toContain('×5/6');
		const sure = (await route([['721-7', 6]]))!;
		expect(sure.confidence).toBeGreaterThanOrEqual(0.95);
		expect(sure.why).toContain('×6/6');
	});

	it('a replaced practice is history, not disagreement: the new account keeps its own agreement', async () => {
		const mem = new CodingMemory(new HashingEmbedder(256));
		for (const d of ['2025-01-10', '2025-02-10', '2025-03-10', '2025-04-10', '2025-05-10']) await mem.add('Ofis Servis MMC', '721-7', 'out', d);
		for (const d of ['2025-08-10', '2025-09-10', '2025-10-10']) await mem.add('Ofis Servis MMC', '721-8', 'out', d);
		const hits = await mem.query('Ofis Servis MMC', 5, 'out');
		expect(hits[0].code).toBe('721-8');
		expect(hits[0].score).toBeCloseTo(0.97, 5);
		// the old account never ranks above the new one, even when its own count would say so
		expect(hits[1].score).toBeLessThan(hits[0].score);
	});
});
