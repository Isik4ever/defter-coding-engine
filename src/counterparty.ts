import { tokens } from './normalize';

/**
 * Item 15: suggest an existing counterparty (and thereby its VÖEN) for a bank text that carries no VÖEN.
 * Token overlap on normalized names; legal-form words (MMC, ASC, LLC…) and short tokens do not count.
 */
export type CpCandidate = { id: number; name: string; voen?: string | null };
export type CpMatch = { id: number; name: string; voen: string | null; score: number };

const LEGAL = new Set(['mmc', 'asc', 'qsc', 'fs', 'ib', 'llc', 'ltd', 'ooo', 'ооо', 'ип', 'qht', 'holding', 'şirkət', 'sirket', 'company', 'co', 'inc', 'gmbh', 'ag', 'sa', 'spa', 'srl', 'bank', 'mağaza', 'magaza', 'market']);

function meaningful(name: string): string[] {
	return tokens(name).filter((t) => t.length >= 3 && !LEGAL.has(t) && !/^\d+$/.test(t));
}

export function matchCounterpartyName(text: string, candidates: CpCandidate[], opts: { minScore?: number } = {}): CpMatch | null {
	const minScore = opts.minScore ?? 0.6;
	const words = new Set(meaningful(text));
	if (!words.size) return null;
	let best: CpMatch | null = null;
	for (const c of candidates) {
		const nt = meaningful(c.name);
		if (!nt.length) continue;
		const hit = nt.filter((t) => words.has(t) || [...words].some((w) => w.length >= 5 && t.length >= 5 && (w.startsWith(t) || t.startsWith(w))));
		if (!hit.length) continue;
		// coverage of the counterparty's name plus a small bonus for long distinctive tokens
		const score = hit.length / nt.length + Math.min(0.2, hit.reduce((s, t) => s + t.length, 0) / 100);
		if (score >= minScore && (!best || score > best.score)) best = { id: c.id, name: c.name, voen: c.voen ?? null, score: Math.round(score * 100) / 100 };
	}
	return best;
}
