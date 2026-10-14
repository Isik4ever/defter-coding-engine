import { describe, expect, it } from 'vitest';
import { applyRules, CodingRouter, HashingEmbedder, CodingMemory, NaiveBayes, type Rule } from '.';
import { correctionEvents, loweredWeight, patternNamesPerson, proposalKeyOf, proposalPattern, ruleIdOf, sameRule, shouldDemote, DEMOTE_AFTER, DEMOTE_WINDOW_DAYS, PROPOSE_AFTER, PROPOSAL_PRIORITY, WEIGHT_FLOOR } from './corrections';

describe('revisorskontroll W2-10 / W2-2 – pure parts', () => {
	it('patternNamesPerson: the surname or first name in the pattern (ə/e, ə/a, İ/ı folded) or the pattern inside a name', () => {
		const staff = ['Rəşad Əliyev', 'Leyla Məmmədova'];
		expect(patternNamesPerson('ƏLİYEV RƏŞAD', staff)).toBe(true);
		expect(patternNamesPerson('aliyev', staff)).toBe(true); // the bank prints Ə as A
		expect(patternNamesPerson('eliyev', staff)).toBe(true);
		expect(patternNamesPerson('RASAD', staff)).toBe(true);
		expect(patternNamesPerson('memmedova', staff)).toBe(true);
		expect(patternNamesPerson('leyla market', staff)).toBe(true); // a first name ≥ 4 letters in the pattern – better no proposal
		expect(patternNamesPerson('araz supermarket', staff)).toBe(false);
		expect(patternNamesPerson('azərişıq', staff)).toBe(false);
		expect(patternNamesPerson('ab', staff)).toBe(false);
		expect(patternNamesPerson('Rəşad', [])).toBe(false);
	});

	it('sameRule: field, folded pattern, account and an overlapping direction; a VÖEN compares by digits', () => {
		const r = { field: 'text', pattern: 'İcarə', direction: 'out', accountCode: '721-3' };
		expect(sameRule(r, { ...r, pattern: ' icare ' })).toBe(true);
		expect(sameRule(r, { ...r, direction: 'any' })).toBe(true);
		expect(sameRule(r, { ...r, direction: 'in' })).toBe(false);
		expect(sameRule(r, { ...r, accountCode: '721-4' })).toBe(false);
		expect(sameRule(r, { ...r, field: 'reference' })).toBe(false);
		expect(sameRule({ field: 'voen', pattern: '1394177695', direction: 'any', accountCode: '721-4' }, { field: 'voen', pattern: '1394 177 695', direction: 'out', accountCode: '721-4' })).toBe(true);
	});
});

describe('automationsvåg 2 (1) – learning from corrections: pure parts', () => {
	it('constants: two corrections within 90 days demote, three identical corrections propose, proposals get priority 20', () => {
		expect(DEMOTE_AFTER).toBe(2);
		expect(DEMOTE_WINDOW_DAYS).toBe(90);
		expect(PROPOSE_AFTER).toBe(3);
		expect(PROPOSAL_PRIORITY).toBe(20);
	});

	it('ruleIdOf: only a company rule (why "#<id> …" from a rule source) names a rule', () => {
		expect(ruleIdOf('rule', '#12 text: "icarə" (out) → 721-3')).toBe(12);
		expect(ruleIdOf('rule', 'standart qayda · text: "icarə" → 721-3')).toBeNull();
		expect(ruleIdOf('rule', 'text: "icarə" → 721-3')).toBeNull();
		expect(ruleIdOf('rule', 'qaimə AA1 üzrə ödəniş → 531')).toBeNull();
		expect(ruleIdOf('memory', '#12 text')).toBeNull();
		expect(ruleIdOf('rule', null)).toBeNull();
	});

	it('correctionEvents: a changed suggestion and a changed pending (stornoed auto coding) count once per source of error', () => {
		expect(correctionEvents({ finalCode: '721-3', suggestion: { code: '721-3', source: 'rule', why: '#4 x' } })).toEqual([]);
		expect(correctionEvents({ finalCode: '721-7', suggestion: null })).toEqual([]);
		expect(correctionEvents({ finalCode: '721-7', suggestion: { code: '721-3', source: 'rule', why: '#4 text: "x" → 721-3' } })).toEqual([{ from: '721-3', source: 'rule', ruleId: 4, auto: false }]);
		// storno of an auto draft, then the inbox re-suggested the same rule → one event, marked auto
		expect(correctionEvents({ finalCode: '721-7', suggestion: { code: '721-3', source: 'rule', why: '#4 text: "x" → 721-3' }, pending: { code: '721-3', source: 'rule', ruleId: 4, auto: true } })).toEqual([{ from: '721-3', source: 'rule', ruleId: 4, auto: true }]);
		// the new suggestion already says the right thing – the pending auto coding was still corrected
		expect(correctionEvents({ finalCode: '721-7', suggestion: { code: '721-7', source: 'memory' }, pending: { code: '721-3', source: 'rule', ruleId: 4, auto: true } })).toEqual([{ from: '721-3', source: 'rule', ruleId: 4, auto: true }]);
		// two different wrong accounts → two events (both memory rows lose weight)
		expect(correctionEvents({ finalCode: '721-7', suggestion: { code: '721-5', source: 'memory' }, pending: { code: '721-3', source: 'rule', ruleId: 4, auto: true } })).toHaveLength(2);
	});

	it('shouldDemote: two corrections inside the 90-day window (and after a reactivation) demote', () => {
		const today = '2026-09-25';
		expect(shouldDemote(['2026-09-20'], today)).toBe(false);
		expect(shouldDemote(['2026-09-20', '2026-09-24'], today)).toBe(true);
		expect(shouldDemote(['2026-06-01', '2026-09-24'], today)).toBe(false); // the first is older than 90 days
		expect(shouldDemote(['2026-06-28T10:00:00.000Z', '2026-09-24T08:00:00.000Z'], today)).toBe(true); // timestamps, exactly 89 days back
		// reactivated on 2026-09-22 – only corrections after it count
		expect(shouldDemote(['2026-09-20', '2026-09-24'], today, { since: '2026-09-22T12:00:00.000Z' })).toBe(false);
		expect(shouldDemote(['2026-09-23T00:00:00.000Z', '2026-09-24'], today, { since: '2026-09-22T12:00:00.000Z' })).toBe(true);
	});

	it('loweredWeight: every correction halves the weight, never below the floor', () => {
		expect(loweredWeight(1)).toBe(0.5);
		expect(loweredWeight(0.5)).toBe(0.25);
		expect(loweredWeight(0.12)).toBe(WEIGHT_FLOOR);
		expect(loweredWeight(WEIGHT_FLOOR)).toBe(WEIGHT_FLOOR);
	});

	it('proposalKeyOf: the VÖEN when the row has one, else the normalised text (numbers and dates stripped)', () => {
		expect(proposalKeyOf({ text: 'AZƏRSUN HOLDING MMC 12.03.2025', voen: '1700038881' })).toEqual({ field: 'voen', key: '1700038881' });
		expect(proposalKeyOf({ text: 'POS AZERSUN MARKET 55501', voen: null })).toEqual({ field: 'text', key: 'pos azersun market' });
		expect(proposalKeyOf({ text: 'POS AZERSUN MARKET 77702', voen: '' })).toEqual({ field: 'text', key: 'pos azersun market' });
		expect(proposalKeyOf({ text: '12345 ', voen: null })).toBeNull();
		// a VÖEN that is not ten digits is not a VÖEN
		expect(proposalKeyOf({ text: 'Bravo', voen: '123' })).toEqual({ field: 'text', key: 'bravo' });
	});

	it('proposalPattern: the most specific token(s) common to every example, literally present in each text', () => {
		const texts = ['POS AZERSUN MARKET BAKI 55501', 'POS AZERSUN MARKET BAKI 77702', 'AZERSUN MARKET POS 88803'];
		// "pos", "baki" and "market" are generic – "azersun" alone survives
		expect(proposalPattern(texts)).toBe('azersun');
		// two adjacent specific tokens become a phrase when every text carries it verbatim
		expect(proposalPattern(['Yasamal Plaza icarə 03/2025', 'YASAMAL PLAZA İCARƏ 04/2025', 'yasamal plaza icarə 05'])).toBe('yasamal plaza');
		// document frequency decides which token is the specific one – and which neighbour extends it
		const df = (t: string) => (t === 'yasamal' ? 40 : 1);
		expect(proposalPattern(['Yasamal Plaza icarə', 'Yasamal Plaza icarə', 'Yasamal Plaza icarə'], df)).toBe('plaza icarə');
		expect(proposalPattern(['Yasamal Plaza', 'Yasamal Towers'], df)).toBe('yasamal');
		expect(proposalPattern(['Azərişıq ödəniş', 'AZƏRİŞIQ'])).toBe('azərişıq');
		expect(proposalPattern(['POS 123', 'POS 456'])).toBeNull();
		expect(proposalPattern([])).toBeNull();
		// the pattern works as a company rule on every example
		const pattern = proposalPattern(texts)!;
		const rule: Rule = { id: 1, field: 'text', pattern, isRegex: false, direction: 'out', accountCode: '721-7', priority: PROPOSAL_PRIORITY };
		for (const text of texts) expect(applyRules([rule], { text, amount: -100, direction: 'out' })?.code).toBe('721-7');
	});
});

describe('automationsvåg 2 (1) – a demoted rule still suggests but yields', () => {
	const embedder = new HashingEmbedder(64);
	const router = (rules: Rule[], memory = new CodingMemory(embedder)) => new CodingRouter({ rules, memory, bayes: new NaiveBayes() });

	it('applyRules: a demoted company rule loses to any live rule that matches, and says it is demoted', () => {
		const demoted: Rule = { id: 1, field: 'text', pattern: 'icarə', isRegex: false, direction: 'out', accountCode: '721-3', priority: 10, demoted: true };
		const proposal: Rule = { id: 2, field: 'text', pattern: 'plaza', isRegex: false, direction: 'out', accountCode: '721-7', priority: 20 };
		expect(applyRules([demoted, proposal], { text: 'Yasamal Plaza icarə', amount: -1, direction: 'out' })).toMatchObject({ code: '721-7', demoted: false });
		const alone = applyRules([demoted], { text: 'Yasamal Plaza icarə', amount: -1, direction: 'out' });
		expect(alone).toMatchObject({ code: '721-3', source: 'rule', demoted: true, defaultRule: false });
		expect(alone!.why).toMatch(/^#1 /);
	});

	it('the router: confirmed memory overrides a demoted company rule (like a bundled default); a live company rule always wins', async () => {
		const memory = new CodingMemory(embedder);
		await memory.add('Yasamal Plaza icarə', '721-7', 'out');
		await memory.add('Yasamal Plaza icarə', '721-7', 'out');
		const live: Rule = { id: 1, field: 'text', pattern: 'icarə', isRegex: false, direction: 'out', accountCode: '721-3', priority: 10 };
		expect((await router([live], memory).suggest({ text: 'Yasamal Plaza icarə', amount: -1, direction: 'out' }))?.code).toBe('721-3');
		const s = await router([{ ...live, demoted: true }], memory).suggest({ text: 'Yasamal Plaza icarə', amount: -1, direction: 'out' });
		expect(s).toMatchObject({ code: '721-7', source: 'memory' });
		expect(s!.alternatives[0]).toMatchObject({ code: '721-3', source: 'rule' });
		// without memory the demoted rule still suggests – with its #id, so the automation can refuse it
		const only = await router([{ ...live, demoted: true }]).suggest({ text: 'Yasamal Plaza icarə', amount: -1, direction: 'out' });
		expect(only).toMatchObject({ code: '721-3', source: 'rule', demoted: true });
	});
});
