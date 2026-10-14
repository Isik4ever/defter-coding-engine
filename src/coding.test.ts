import { describe, it, expect } from 'vitest';
import { normalize, tokens } from './normalize';
import { applyRules } from './rules';
import { HashingEmbedder, cosine } from './hashing';
import { CodingMemory } from './memory';
import { NaiveBayes } from './bayes';
import { CodingRouter } from './router';
import type { CodingInput, Llm, Rule } from './types';

const txn = (text: string, amount = -10000, direction: 'in' | 'out' = 'out', voen?: string): CodingInput => ({ text, amount, direction, voen });

describe('normalize', () => {
	it('drops numbers, dates, legal forms and payment noise', () => {
		expect(normalize('Bravo Supermarket MMC – Qaimə №123 tarixli 05.01.2025 ödəniş')).toBe('bravo supermarket');
		expect(tokens('ООО Азерсель, оплата за интернет')).toEqual(['азерсель', 'интернет']);
	});
});

describe('rules', () => {
	const rules: Rule[] = [
		{ field: 'text', pattern: 'bank xidmət', isRegex: false, direction: 'out', accountCode: '721-6', priority: 10 },
		{ field: 'voen', pattern: '^1700001234$', isRegex: true, direction: 'any', accountCode: '531', priority: 5 },
		{ field: 'text', pattern: 'azercell|bakcell|nar', isRegex: true, direction: 'out', accountCode: '721-5', priority: 20 }
	];
	it('matches by text, voen (regex) and direction; lower priority wins', () => {
		expect(applyRules(rules, txn('Bank xidmət haqqı'))?.code).toBe('721-6');
		expect(applyRules(rules, txn('Azercell Telekom'))?.code).toBe('721-5');
		expect(applyRules(rules, txn('Azercell Telekom', 5000, 'in'))).toBeNull();
		expect(applyRules(rules, txn('Bank xidmət haqqı', -1, 'out', '1700001234'))?.code).toBe('531');
	});
});

describe('hashing embedder + memory', () => {
	const emb = new HashingEmbedder(512);
	it('identical texts have cosine 1, unrelated texts low', async () => {
		const [a, b, c] = await emb.embed(['Bravo Supermarket MMC', 'BRAVO supermarket', 'Azercell Telekom']);
		expect(cosine(a, b)).toBeCloseTo(1, 5);
		expect(cosine(a, c)).toBeLessThan(0.3);
	});
	it('kNN memory returns exact hits (scored by votes – förbättringar 3 (83)) and fuzzy hits otherwise', async () => {
		const mem = new CodingMemory(emb);
		await mem.add('Bravo Supermarket MMC – mal', '205');
		await mem.add('Bravo Supermarket MMC – mal', '205');
		await mem.add('Azercell Telekom MMC internet', '721-5');
		const exact = await mem.query('Bravo Supermarket MMC – mal №55');
		// two agreeing confirmations ≈ 0,93 – one approval more before the bank gate (0,95) trusts the text
		expect(exact[0]).toMatchObject({ code: '205', score: 0.93, votes: 2, of: 2, exact: true });
		const fuzzy = await mem.query('Bravo Supermarkt');
		expect(fuzzy[0].code).toBe('205');
		expect(fuzzy[0].score).toBeGreaterThan(0.5);
		expect(mem.size).toBe(2);
	});
	it('V4 61: weight scales the score, so a contradicted example loses to the trusted one', async () => {
		const mem = new CodingMemory(emb);
		const [v] = await emb.embed(['bravo supermarket mal']);
		mem.load([
			{ textNorm: 'bravo supermarket mal', code: '721-7', vector: v, count: 5, weight: 0.1 },
			{ textNorm: 'bravo supermarket mal', code: '205', vector: v, count: 2, weight: 1 }
		]);
		const exact = await mem.query('Bravo Supermarket – mal');
		// förbättringar 3 (83): 2 trusted votes against 5 discredited ones (weight 0,1 → 0,5) – 205 leads with 80 % agreement
		expect(exact.map((h) => h.code)).toEqual(['205', '721-7']);
		expect(exact[0].score).toBeCloseTo(0.93 * 0.8, 3);
		expect(exact[1].score).toBeLessThan(0.05);
		const fuzzy = await mem.query('Bravo Supermarkt');
		expect(fuzzy[0].code).toBe('205');
		expect(fuzzy[1].score).toBeCloseTo(fuzzy[0].score * 0.1, 3);
	});
});

describe('naive bayes', () => {
	it('is not ready before minDocs and predicts after training', () => {
		const nb = new NaiveBayes(4);
		nb.train('azercell internet', '721-5');
		expect(nb.ready).toBe(false);
		nb.train('bakcell mobil', '721-5');
		nb.train('bravo market mal', '205');
		nb.train('araz market mal', '205');
		expect(nb.ready).toBe(true);
		expect(nb.predict('nar mobil internet')[0].code).toBe('721-5');
		expect(nb.predict('market mal')[0].code).toBe('205');
		const nb2 = NaiveBayes.from(nb.export(), 4);
		expect(nb2.predict('market mal')[0].code).toBe('205');
		expect(nb2.ready).toBe(true);
	});
});

describe('router', () => {
	const rules: Rule[] = [{ field: 'text', pattern: 'bank xidmət', isRegex: false, direction: 'out', accountCode: '721-6', priority: 10 }];
	function make(llm?: Llm) {
		const memory = new CodingMemory(new HashingEmbedder(512));
		const bayes = new NaiveBayes(3);
		return { router: new CodingRouter({ rules, memory, bayes, llm, accounts: [{ code: '721-5', name: 'Rabitə' }, { code: '205', name: 'Mallar' }] }), memory, bayes };
	}
	it('rules win, then memory, then bayes; learn improves next suggestion', async () => {
		const { router } = make();
		expect((await router.suggest(txn('Bank xidmət haqqı')))?.source).toBe('rule');
		expect(await router.suggest(txn('Bravo Supermarket'))).toBeNull();
		await router.learn(txn('Bravo Supermarket'), '205');
		const s = await router.suggest(txn('Bravo Supermarket – mal'));
		expect(s).toMatchObject({ code: '205', source: 'memory' });
		expect(s!.confidence).toBeGreaterThanOrEqual(0.85);
		await router.learn(txn('Azercell internet'), '721-5');
		await router.learn(txn('Bakcell mobil'), '721-5');
		const b = await router.suggest(txn('Nar mobil'));
		expect(b?.source).toBe('bayes');
		expect(b?.code).toBe('721-5');
	});
	it('bench 2026-09-18: a shipped default rule yields to the company\'s repeated corrections; a company rule (with id) does not', async () => {
		const shipped: Rule = { field: 'text', pattern: 'pos terminal', isRegex: true, direction: 'in', accountCode: '217', priority: 50 };
		const own: Rule = { id: 7, field: 'text', pattern: 'pos terminal', isRegex: true, direction: 'in', accountCode: '217', priority: 50 };
		for (const [rule, expected] of [[shipped, '601'], [own, '217']] as const) {
			const memory = new CodingMemory(new HashingEmbedder(512));
			const router = new CodingRouter({ rules: [rule], memory, bayes: new NaiveBayes(3) });
			const pos = (d: string) => txn(`POS terminal ekvayrinq – ${d}`, 100000, 'in');
			expect((await router.suggest(pos('01.01.2025')))?.code).toBe('217');
			await router.learn(pos('01.01.2025'), '601');
			// one correction is not enough – a single slip must not silence a rule
			expect((await router.suggest(pos('02.01.2025')))?.code).toBe('217');
			await router.learn(pos('02.01.2025'), '601');
			const s = await router.suggest(pos('03.01.2025'));
			expect(s?.code).toBe(expected);
			if (expected === '601') expect(s?.alternatives.map((a) => a.code)).toContain('217');
		}
	});
	it('falls back to llm when nothing else is confident', async () => {
		const llm: Llm = { name: 'fake', suggest: async () => ({ code: '721-5', confidence: 0.9 }) };
		const { router } = make(llm);
		const s = await router.suggest(txn('Something unknown'));
		expect(s).toMatchObject({ code: '721-5', source: 'llm', confidence: 0.75 });
	});
	it('ignores llm answers outside the chart', async () => {
		const llm: Llm = { name: 'fake', suggest: async () => ({ code: '999', confidence: 0.9 }) };
		const { router } = make(llm);
		expect(await router.suggest(txn('Something unknown'))).toBeNull();
	});
});

describe('synthetic corpus 2026-09-17 – memory is direction-aware', () => {
	it("a supplier's bank payment (531) does not answer for the same supplier's incoming invoice (205)", async () => {
		const memory = new CodingMemory(new HashingEmbedder(512));
		const router = new CodingRouter({ rules: [], memory, bayes: new NaiveBayes(3) });
		await router.learn(txn('Qaradağ Sement ASC – Qaimə AA30012 üzrə ödəniş'), '531');
		await router.learn({ text: 'Qaradağ Sement ASC qaimə 30013', amount: -500000, direction: 'in' }, '205');
		expect((await router.suggest(txn('Qaradağ Sement ASC – Qaimə AA30014 üzrə ödəniş')))?.code).toBe('531');
		expect((await router.suggest({ text: 'Qaradağ Sement ASC qaimə 30015', amount: -400000, direction: 'in' }))?.code).toBe('205');
	});
});
