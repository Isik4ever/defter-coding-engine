/**
 * V3 1.4: coding metrics – how often the suggester's proposal survives the accountant's review.
 * Pure aggregation over outcome rows; the "Bronn number" is accepted / (accepted + corrected + manual).
 */

/** automationsvåg 2 (3): `expected` – the payment the books expected (engine/ledger/expected.ts) */
export type MetricSource = 'rule' | 'memory' | 'bayes' | 'llm' | 'expected' | 'none';
export type MetricOutcome = 'accepted' | 'corrected' | 'manual';

export type MetricRow = { source: MetricSource; outcome: MetricOutcome; finalCode: string; at: string };

export const METRIC_SOURCES: MetricSource[] = ['rule', 'memory', 'expected', 'bayes', 'llm', 'none'];

export type SourceStat = { n: number; accepted: number; corrected: number; manual: number; rate: number };
export type AccountStat = { code: string; n: number; accepted: number; rate: number };
export type WeekStat = { week: string; n: number; accepted: number; rate: number };

export type MetricsSummary = {
	total: number;
	bySource: Record<MetricSource, SourceStat>;
	byAccount: AccountStat[];
	byWeek: WeekStat[];
	bronn: number;
};

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const rate = (accepted: number, n: number) => (n ? round3(accepted / n) : 0);

/** 'YYYY-MM-DD' (or a full ISO timestamp) → ISO 8601 week 'YYYY-Www' with the week-based year. */
export function isoWeek(date: string): string {
	const [y, m, d] = date.slice(0, 10).split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	// ISO weeks start on Monday; the week's year is the year of its Thursday
	const dow = t.getUTCDay() || 7;
	t.setUTCDate(t.getUTCDate() + 4 - dow);
	const year = t.getUTCFullYear();
	const jan1 = Date.UTC(year, 0, 1);
	const week = Math.floor((t.getTime() - jan1) / 86_400_000 / 7) + 1;
	return `${year}-W${String(week).padStart(2, '0')}`;
}

export function aggregateMetrics(rows: MetricRow[], opts: { from?: string; to?: string } = {}): MetricsSummary {
	const inRange = rows.filter((r) => {
		const day = r.at.slice(0, 10);
		return (!opts.from || day >= opts.from) && (!opts.to || day <= opts.to);
	});
	const bySource = Object.fromEntries(METRIC_SOURCES.map((s) => [s, { n: 0, accepted: 0, corrected: 0, manual: 0, rate: 0 }])) as Record<MetricSource, SourceStat>;
	const accounts = new Map<string, { n: number; accepted: number }>();
	const weeks = new Map<string, { n: number; accepted: number }>();
	let accepted = 0;
	for (const r of inRange) {
		const s = bySource[r.source] ?? bySource.none;
		s.n++;
		s[r.outcome]++;
		const ok = r.outcome === 'accepted' ? 1 : 0;
		accepted += ok;
		const a = accounts.get(r.finalCode) ?? { n: 0, accepted: 0 };
		a.n++;
		a.accepted += ok;
		accounts.set(r.finalCode, a);
		const wk = isoWeek(r.at);
		const w = weeks.get(wk) ?? { n: 0, accepted: 0 };
		w.n++;
		w.accepted += ok;
		weeks.set(wk, w);
	}
	for (const s of METRIC_SOURCES) bySource[s].rate = rate(bySource[s].accepted, bySource[s].n);
	const byAccount = [...accounts.entries()]
		.map(([code, a]) => ({ code, n: a.n, accepted: a.accepted, rate: rate(a.accepted, a.n) }))
		.sort((x, y) => y.n - x.n || x.code.localeCompare(y.code, undefined, { numeric: true }));
	const byWeek = [...weeks.entries()]
		.map(([week, w]) => ({ week, n: w.n, accepted: w.accepted, rate: rate(w.accepted, w.n) }))
		.sort((x, y) => x.week.localeCompare(y.week));
	return { total: inRange.length, bySource, byAccount, byWeek, bronn: rate(accepted, inRange.length) };
}
