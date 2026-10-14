import { describe, it, expect } from 'vitest';
import { fewShotContext } from './fewshot';
import { CodingRouter } from './router';
import { CodingMemory } from './memory';
import { NaiveBayes } from './bayes';
import { HashingEmbedder } from './hashing';
import type { Llm } from './types';

describe('fewShotContext (V4 62)', () => {
	it('lists top expense accounts and counterparties with their usual account, most used first, within limits', () => {
		const s = fewShotContext(
			{
				counterparties: [{ name: 'Azercell Telekom MMC', code: '721-5', n: 12 }, { name: '  Bravo   Supermarket ', code: '205', n: 30 }, { name: 'Zero', code: '721-1', n: 0 }, { name: 'Third', code: '721-3', n: 1 }],
				accounts: [{ code: '721-5', name: 'Rabitə və internet', n: 42 }, { code: '721-3', name: 'İcarə', n: 42 }, { code: '721-9', name: 'Amortizasiya', n: 3 }]
			},
			{ maxCounterparties: 2, maxAccounts: 2 }
		);
		expect(s).toBe('Bu şirkətdə ən çox istifadə olunan xərc hesabları:\n721-3 İcarə (×42)\n721-5 Rabitə və internet (×42)\n\nTanış kontragentlər və adətən yazıldığı hesab:\nBravo Supermarket → 205 (×30)\nAzercell Telekom MMC → 721-5 (×12)');
		expect(fewShotContext({ counterparties: [], accounts: [] })).toBe('');
		expect(fewShotContext({ counterparties: [{ name: 'X', code: '205', n: 1 }], accounts: [] })).toMatch(/^Tanış kontragentlər/);
	});

	it('the router hands the context to the LLM unchanged', async () => {
		let seen: string | undefined = 'unset';
		const llm: Llm = { name: 'fake', suggest: async (i) => ((seen = i.context), { code: '721-5', confidence: 0.6 }) };
		const ctx = fewShotContext({ counterparties: [{ name: 'Azercell', code: '721-5', n: 3 }], accounts: [] });
		const router = new CodingRouter({ rules: [], memory: new CodingMemory(new HashingEmbedder(32)), bayes: new NaiveBayes(), llm, accounts: [{ code: '721-5', name: 'Rabitə' }], llmContext: ctx });
		const s = await router.suggest({ text: 'Azercell', amount: -100, direction: 'out' });
		expect(s).toMatchObject({ code: '721-5', source: 'llm' });
		expect(seen).toBe(ctx);
		const bare = new CodingRouter({ rules: [], memory: new CodingMemory(new HashingEmbedder(32)), bayes: new NaiveBayes(), llm, accounts: [{ code: '721-5', name: 'Rabitə' }] });
		await bare.suggest({ text: 'Azercell', amount: -100, direction: 'out' });
		expect(seen).toBeUndefined();
	});
});
