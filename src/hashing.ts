import type { Embedder } from './types';
import { normalize } from './normalize';

/**
 * Deterministic char-3-gram hashing embedder (no model needed).
 * Fallback for when bge-m3 isn't available. Works acceptably for
 * counterparty-name similarity across az/ru/en.
 */
export class HashingEmbedder implements Embedder {
	readonly name = 'hash3';
	constructor(readonly dim = 1024) {}

	private hash(s: string): number {
		let h = 2166136261;
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		return (h >>> 0) % this.dim;
	}

	embedOne(text: string): Float32Array {
		const v = new Float32Array(this.dim);
		const norm = normalize(text);
		const words = norm.split(' ').filter(Boolean);
		for (const w of words) {
			const padded = `#${w}#`;
			for (let i = 0; i + 3 <= padded.length; i++) v[this.hash(padded.slice(i, i + 3))] += 1;
			v[this.hash('W:' + w)] += 2; // whole-word signal
		}
		let n = 0;
		for (let i = 0; i < v.length; i++) n += v[i] * v[i];
		n = Math.sqrt(n) || 1;
		for (let i = 0; i < v.length; i++) v[i] /= n;
		return v;
	}

	async embed(texts: string[]): Promise<Float32Array[]> {
		return texts.map((t) => this.embedOne(t));
	}
}

export function cosine(a: Float32Array, b: Float32Array): number {
	let d = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		d += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	const den = Math.sqrt(na) * Math.sqrt(nb);
	return den ? d / den : 0;
}
