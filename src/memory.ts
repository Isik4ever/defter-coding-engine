import { cosine } from './hashing';
import { normalize } from './normalize';
import type { Embedder, MemoryItem } from './types';

export type MemoryHit = { code: string; score: number; votes: number; text?: string; shared?: boolean; /** AI-förbättringar (23): < 1 when another account replaced this one for the text (see `practiceFactors`) */ recency?: number; /** förbättringar 3 (83): an exact text hit – `votes` of `of` confirmations of the text chose this account */ exact?: boolean; of?: number };

/**
 * Förbättringar 3 (83): the score of an exact text hit is how sure the company's own confirmations make it – one
 * confirmation ≈ 0,88, two ≈ 0,93, three or more ≈ 0,97 – times their agreement (this account's share of the text's
 * confirmations; ≥ `EXACT_AGREEMENT` counts as agreement). One approval is no longer enough for the automation (bank gate
 * 0,95), and a text people code two ways (5:1) falls under every gate while the majority still leads.
 */
export const EXACT_AGREEMENT = 0.9;
export function exactScore(votes: number, share: number): number {
	const base = votes >= 3 ? 0.97 : votes === 2 ? 0.93 : 0.88;
	return base * (share >= EXACT_AGREEMENT - 1e-9 ? 1 : Math.max(0, share));
}

/**
 * AI-förbättringar (23) – tidsviktat minne. When the company changes practice for a text (the same supplier moved from 721-7 to
 * 721-8), the old account keeps its many confirmations and would win on votes for months. An account whose last confirmation
 * is more than `PRACTICE_GRACE_DAYS` older than another account's for the same text – confirmed at least
 * `PRACTICE_MIN_VOTES` times, so one odd coding does not flip the memory – loses weight with a half-life of
 * `PRACTICE_HALF_LIFE_DAYS` (never below `PRACTICE_FLOOR`). Time is relative to the newest confirmation among the
 * candidates, never to today: a text coded one way only never decays, a backlog replayed in one day neither.
 */
export const PRACTICE_GRACE_DAYS = 45;
export const PRACTICE_HALF_LIFE_DAYS = 90;
export const PRACTICE_FLOOR = 0.25;
export const PRACTICE_MIN_VOTES = 2;

const dayNo = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 86_400_000);

export function practiceFactors(codes: { code: string; lastUsed?: string | null; votes: number }[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const c of codes) {
		let f = 1;
		if (c.lastUsed) {
			const mine = dayNo(c.lastUsed);
			let newest = -Infinity;
			for (const d of codes) if (d.code !== c.code && d.lastUsed && d.votes >= PRACTICE_MIN_VOTES) newest = Math.max(newest, dayNo(d.lastUsed));
			const gap = newest - mine;
			if (Number.isFinite(gap) && gap > PRACTICE_GRACE_DAYS) f = Math.max(PRACTICE_FLOOR, Math.pow(0.5, (gap - PRACTICE_GRACE_DAYS) / PRACTICE_HALF_LIFE_DAYS));
		}
		out.set(c.code, round4(f));
	}
	return out;
}

/**
 * AI-förbättringar (27): an example shared by a sibling company counts by industry (`companies.activity`) – the same industry
 * as much as before, an unknown/general one a little less, another industry clearly less (a restaurant's "ərzaq" is
 * materials 201, a shop's the goods 205). Multiplied into the example's weight.
 */
export function sharedIndustryWeight(own: string | null | undefined, theirs: string | null | undefined): number {
	if (!own || !theirs || own === 'general' || theirs === 'general') return own && own === theirs ? 1 : 0.95;
	return own === theirs ? 1 : 0.85;
}

/** kNN over previously coded texts. One item per (textNorm, code). */
export class CodingMemory {
	private items: MemoryItem[] = [];
	constructor(private embedder: Embedder) {}

	get size() {
		return this.items.length;
	}

	load(items: MemoryItem[]) {
		this.items = items.filter((i) => i.vector.length === this.embedder.dim);
	}

	export(): MemoryItem[] {
		return this.items;
	}

	/**
	 * Synthetic corpus 2026-09-17: a supplier's bank payment (→ 531) and the same supplier's incoming invoice (→ 205) taught
	 * each other the wrong account, because memory keyed on the text alone. The direction is stored as a "in|" / "out|"
	 * prefix of textNorm (no schema change); the embedding is of the text only. Items without a prefix (older rows)
	 * match either direction.
	 */
	async add(text: string, code: string, direction?: 'in' | 'out', at?: string | null): Promise<MemoryItem> {
		const textNorm = withDir(normalize(text), direction);
		const existing = this.items.find((i) => i.textNorm === textNorm && i.code === code);
		if (existing) {
			existing.count++;
			if (at && (!existing.lastUsed || at > existing.lastUsed)) existing.lastUsed = at;
			return existing;
		}
		const [vector] = await this.embedder.embed([normalize(text)]);
		const item: MemoryItem = { textNorm, code, vector, count: 1, ...(at ? { lastUsed: at } : {}) };
		this.items.push(item);
		return item;
	}

	/** Top codes by best similarity; `votes` = how many of the k neighbours agree. */
	async query(text: string, k = 5, direction?: 'in' | 'out'): Promise<MemoryHit[]> {
		const pool = direction ? this.items.filter((i) => dirOf(i.textNorm) == null || dirOf(i.textNorm) === direction) : this.items;
		if (!pool.length) return [];
		const textNorm = normalize(text);
		const exact = pool.filter((i) => stripDir(i.textNorm) === textNorm);
		if (exact.length) {
			const byCode = new Map<string, { votes: number; shared: boolean; weight: number; lastUsed: string | null }>();
			for (const e of exact) {
				const prev = byCode.get(e.code);
				byCode.set(e.code, { votes: (prev?.votes ?? 0) + e.count, shared: (prev?.shared ?? true) && !!e.shared, weight: Math.max(prev?.weight ?? 0, e.weight ?? 1), lastUsed: later(prev?.lastUsed ?? null, e.lastUsed ?? null) });
			}
			// (23): an account the company stopped using for this text loses against the one it uses now
			const recency = practiceFactors([...byCode.entries()].map(([code, v]) => ({ code, lastUsed: v.lastUsed, votes: v.votes })));
			// V4 61: the order – shared × weight × recency, then votes – a contradicted or stale example no longer wins outright
			const ranked = [...byCode.entries()]
				.map(([code, v]) => ({ code, v, r: recency.get(code) ?? 1, key: (v.shared ? 0.96 : 1) * v.weight * (recency.get(code) ?? 1) }))
				.sort((a, b) => b.key - a.key || b.v.votes - a.v.votes);
			// förbättringar 3 (83): the score – votes and agreement. The agreement of an account in use is its share among the accounts
			// in use (a replaced practice is history, not disagreement); a replaced account's is its share of all confirmations,
			// and it never scores above the account in use (× its decay), so the order above stays the order of the scores
			// a confirmation counts with its example's weight (V4 61: a corrected example is halved down to 0,1) – a discredited
			// account is weak disagreement
			const eff = (x: (typeof ranked)[number]) => x.v.votes * x.v.weight;
			const votesOfText = ranked.reduce((s, x) => s + x.v.votes, 0);
			const all = ranked.reduce((s, x) => s + eff(x), 0);
			const current = ranked.filter((x) => x.r >= 1).reduce((s, x) => s + eff(x), 0);
			const own = (x: (typeof ranked)[number]) => (x.v.shared ? 0.96 : 1) * x.v.weight;
			const inUse = (x: (typeof ranked)[number]) => exactScore(x.v.votes, current ? eff(x) / current : 1) * own(x);
			const topCurrent = ranked.filter((x) => x.r >= 1).reduce((m, x) => Math.max(m, inUse(x)), 0);
			const hits = ranked.map((x) => {
				const score = x.r >= 1 ? inUse(x) : Math.min(exactScore(x.v.votes, all ? eff(x) / all : 1) * own(x) * x.r, topCurrent * x.r);
				return { code: x.code, score, votes: x.v.votes, of: votesOfText, exact: true as const, text: textNorm, shared: x.v.shared, ...(x.r < 1 ? { recency: x.r } : {}) };
			});
			// never a lower-ranked account above a higher-ranked one
			for (let i = 1; i < hits.length; i++) hits[i].score = Math.min(hits[i].score, hits[i - 1].score);
			return hits.map((h) => ({ ...h, score: round4(h.score) }));
		}
		const [q] = await this.embedder.embed([textNorm]);
		const scored = pool.map((i) => ({ i, s: cosine(q, i.vector) })).sort((a, b) => b.s - a.s).slice(0, k);
		const byCode = new Map<string, MemoryHit>();
		const used = new Map<string, string | null>();
		for (const { i, s } of scored) {
			const h = byCode.get(i.code) ?? { code: i.code, score: 0, votes: 0 };
			const adj = (i.shared ? s * 0.96 : s) * (i.weight ?? 1); // firm-shared examples count slightly less than the company's own
			if (adj > h.score) {
				h.score = adj;
				h.text = stripDir(i.textNorm);
				h.shared = !!i.shared;
			}
			h.votes += 1;
			byCode.set(i.code, h);
			used.set(i.code, later(used.get(i.code) ?? null, i.lastUsed ?? null));
		}
		// (23) the same among the neighbours: votes = neighbours here, so a replaced account needs two newer neighbours of another
		const recency = practiceFactors([...byCode.values()].map((h) => ({ code: h.code, lastUsed: used.get(h.code) ?? null, votes: h.votes })));
		for (const h of byCode.values()) {
			const f = recency.get(h.code) ?? 1;
			if (f < 1) {
				h.score = h.score * f;
				h.recency = f;
			}
		}
		return [...byCode.values()].sort((a, b) => b.score - a.score || b.votes - a.votes);
	}
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
const withDir = (norm: string, d?: 'in' | 'out') => (d ? `${d}|${norm}` : norm);
export const dirOf = (textNorm: string): 'in' | 'out' | null => (textNorm.startsWith('in|') ? 'in' : textNorm.startsWith('out|') ? 'out' : null);
export const stripDir = (textNorm: string) => textNorm.replace(/^(in|out)\|/, '');
