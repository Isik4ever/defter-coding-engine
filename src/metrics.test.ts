import { describe, it, expect } from 'vitest';
import { aggregateMetrics, isoWeek, type MetricRow } from './metrics';

const row = (source: MetricRow['source'], outcome: MetricRow['outcome'], finalCode: string, at: string): MetricRow => ({ source, outcome, finalCode, at });

describe('isoWeek', () => {
	it('returns ISO 8601 week with the week-based year', () => {
		expect(isoWeek('2026-09-16')).toBe('2026-W38');
		expect(isoWeek('2026-01-01')).toBe('2026-W01'); // Thursday
		expect(isoWeek('2027-01-01')).toBe('2026-W53'); // Friday, belongs to 2026's last week
		expect(isoWeek('2024-12-30')).toBe('2025-W01'); // Monday of the first week of 2025
		expect(isoWeek('2021-01-03')).toBe('2020-W53');
		expect(isoWeek('2025-12-29')).toBe('2026-W01');
	});
	it('accepts full timestamps', () => {
		expect(isoWeek('2026-09-16T10:12:13.123Z')).toBe('2026-W38');
	});
});

describe('aggregateMetrics', () => {
	const rows: MetricRow[] = [
		row('rule', 'accepted', '721-6', '2026-09-01T09:00:00.000Z'),
		row('rule', 'accepted', '721-6', '2026-09-02T09:00:00.000Z'),
		row('rule', 'corrected', '721-5', '2026-09-02T10:00:00.000Z'),
		row('memory', 'accepted', '721-5', '2026-09-08T09:00:00.000Z'),
		row('bayes', 'corrected', '601', '2026-09-09T09:00:00.000Z'),
		row('none', 'manual', '601', '2026-09-15T09:00:00.000Z'),
		row('llm', 'accepted', '601', '2026-09-16T09:00:00.000Z')
	];

	it('returns zeros and empty lists for no rows', () => {
		const m = aggregateMetrics([]);
		expect(m.total).toBe(0);
		expect(m.bronn).toBe(0);
		expect(m.byAccount).toEqual([]);
		expect(m.byWeek).toEqual([]);
		expect(m.bySource.rule).toEqual({ n: 0, accepted: 0, corrected: 0, manual: 0, rate: 0 });
		expect(Object.keys(m.bySource).sort()).toEqual(['bayes', 'expected', 'llm', 'memory', 'none', 'rule']);
	});

	it('computes the Bronn number and per-source rates', () => {
		const m = aggregateMetrics(rows);
		expect(m.total).toBe(7);
		expect(m.bronn).toBe(0.571); // 4 / 7
		expect(m.bySource.rule).toEqual({ n: 3, accepted: 2, corrected: 1, manual: 0, rate: 0.667 });
		expect(m.bySource.memory).toEqual({ n: 1, accepted: 1, corrected: 0, manual: 0, rate: 1 });
		expect(m.bySource.bayes).toEqual({ n: 1, accepted: 0, corrected: 1, manual: 0, rate: 0 });
		expect(m.bySource.none).toEqual({ n: 1, accepted: 0, corrected: 0, manual: 1, rate: 0 });
		expect(m.bySource.llm).toEqual({ n: 1, accepted: 1, corrected: 0, manual: 0, rate: 1 });
	});

	it('groups by final account sorted by n desc (code asc on ties)', () => {
		const m = aggregateMetrics(rows);
		expect(m.byAccount).toEqual([
			{ code: '601', n: 3, accepted: 1, rate: 0.333 },
			{ code: '721-5', n: 2, accepted: 1, rate: 0.5 },
			{ code: '721-6', n: 2, accepted: 2, rate: 1 }
		]);
	});

	it('groups by ISO week ascending', () => {
		const m = aggregateMetrics(rows);
		expect(m.byWeek).toEqual([
			{ week: '2026-W36', n: 3, accepted: 2, rate: 0.667 },
			{ week: '2026-W37', n: 2, accepted: 1, rate: 0.5 },
			{ week: '2026-W38', n: 2, accepted: 1, rate: 0.5 }
		]);
	});

	it('filters rows by date range inclusive', () => {
		const m = aggregateMetrics(rows, { from: '2026-09-02', to: '2026-09-15' });
		expect(m.total).toBe(5);
		expect(m.bronn).toBe(0.4);
		expect(aggregateMetrics(rows, { from: '2026-09-16' }).total).toBe(1);
		expect(aggregateMetrics(rows, { to: '2026-09-01' }).total).toBe(1);
		expect(aggregateMetrics(rows, { from: '2026-10-01' }).bronn).toBe(0);
	});
});
