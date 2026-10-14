import { describe, it, expect } from 'vitest';
import { rankForReview, learningCurve, correctionImpact } from './activeLearning';
import type { MetricRow } from './metrics';

describe('rankForReview (V4 59)', () => {
	it('uncertain band first, then big amounts, then novel texts, then routine', () => {
		const r = rankForReview([
			{ id: 1, confidence: 0.95, source: 'rule', amount: -5000, text: 'Azercell' },
			{ id: 2, confidence: 0.65, source: 'bayes', amount: -3000, text: 'Yeni firma MMC' },
			{ id: 3, confidence: 0.92, source: 'memory', amount: -900000, text: 'Böyük ödəniş', memoryHit: true },
			{ id: 4, confidence: 0.4, source: 'bayes', amount: -2000, text: 'Naməlum' },
			{ id: 5, confidence: null, source: null, amount: -1500, text: 'Heç nə' },
			{ id: 6, confidence: 0.78, source: 'llm', amount: -100, text: 'Kiçik' }
		]);
		expect(r.map((x) => x.id)).toEqual([2, 6, 3, 5, 4, 1]);
		expect(r[0]).toMatchObject({ reason: 'uncertain', rank: 1 });
		expect(r[0].score).toBeGreaterThan(r[1].score);
		expect(r[1].reason).toBe('uncertain');
		expect(r[2]).toMatchObject({ id: 3, reason: 'bigAmount' });
		expect(r[3]).toMatchObject({ id: 5, reason: 'noSuggestion' });
		expect(r[4]).toMatchObject({ id: 4, reason: 'novel' });
		expect(r[5]).toMatchObject({ id: 1, reason: 'routine' });
		expect(r[5].score).toBeLessThan(1);
	});
	it('empty input and memory hits', () => {
		expect(rankForReview([])).toEqual([]);
		const [only] = rankForReview([{ id: 9, confidence: null, source: null, amount: -100, text: 'x', memoryHit: true }]);
		expect(only.reason).toBe('routine');
	});
});

const row = (i: number, outcome: MetricRow['outcome'], code = '721-5'): MetricRow => ({ source: 'bayes', outcome, finalCode: code, at: `2026-01-${String(1 + Math.floor(i / 10)).padStart(2, '0')}T${String(i % 10).padStart(2, '0')}:00:00.000Z` });

describe('learningCurve', () => {
	it('cumulative Bronn per bucket with delta', () => {
		const rows: MetricRow[] = [];
		for (let i = 0; i < 25; i++) rows.push(row(i, i % 2 === 0 ? 'accepted' : 'corrected'));
		for (let i = 25; i < 50; i++) rows.push(row(i, i % 5 === 0 ? 'corrected' : 'accepted'));
		for (let i = 50; i < 60; i++) rows.push(row(i, 'accepted'));
		const c = learningCurve([...rows].reverse(), 25);
		expect(c.map((p) => p.n)).toEqual([25, 50, 60]);
		expect(c[0]).toMatchObject({ accepted: 13, corrected: 12, manual: 0, bronn: 0.52, windowBronn: 0.52, delta: 0.52 });
		expect(c[1]).toMatchObject({ accepted: 20, corrected: 5, windowBronn: 0.8, bronn: 0.66, delta: 0.14 });
		expect(c[2]).toMatchObject({ n: 60, accepted: 10, bronn: 0.717 });
		expect(c[2].delta).toBeCloseTo(0.057, 3);
		expect(c[0].from <= c[0].to).toBe(true);
		expect(learningCurve([])).toEqual([]);
	});
	it('correctionImpact compares the same account before and after', () => {
		const rows: MetricRow[] = [row(0, 'corrected'), row(1, 'corrected'), row(2, 'corrected'), row(3, 'accepted'), row(4, 'accepted'), row(5, 'accepted', '601')];
		const imp = correctionImpact(rows, 10);
		expect(imp).toHaveLength(3);
		expect(imp[0]).toMatchObject({ finalCode: '721-5', before: null, after: 0.5, moved: null });
		expect(imp[2]).toMatchObject({ before: 0, after: 1, moved: 1 });
	});
});
