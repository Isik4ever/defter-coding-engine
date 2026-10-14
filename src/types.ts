export interface Embedder {
	readonly name: string;
	readonly dim: number;
	embed(texts: string[]): Promise<Float32Array[]>;
}

export interface Llm {
	readonly name: string;
	/** `context` (V4 62): optional few-shot block (company's usual counterparties/accounts) placed before the question */
	suggest(input: { text: string; amount: number; direction: 'in' | 'out'; accounts: { code: string; name: string }[]; context?: string }): Promise<{ code: string; confidence: number } | null>;
}

/** automationsvåg 2 (3): `expected` = a payment the books already expect (salary, tax, instalment, recurring qaimə, due 531) */
export type CodingSource = 'rule' | 'memory' | 'bayes' | 'llm' | 'expected';

export type Suggestion = {
	code: string;
	confidence: number; // 0..1
	source: CodingSource;
	alternatives: { code: string; confidence: number; source: CodingSource }[];
	/** item 17: short human explanation ("Qayda: azercell → 721-5", "Yaddaş: 'azercell abunə' 4×") */
	why?: string;
	/** aktualitetsrevision §31: the same, as the shared Explanation object */
	explanation?: import('./explain').Explanation;
	/** rule hit came from a shipped default rule (no id) – the router lets confirmed company memory override it */
	defaultRule?: boolean;
	/** automationsvåg 2 (1): the company rule behind the hit was demoted by corrections – it still suggests, confirmed memory overrides it and the automation refuses it */
	demoted?: boolean;
};

export type CodingInput = {
	text: string;
	amount: number; // signed qəpik
	direction: 'in' | 'out';
	/** rollspel F-2.7: an invoice never lands on its own settlement account – memory learnt from the *payments* (→ 531/211) must not override the rule for the qaimə */
	kind?: 'txn' | 'invoice';
	voen?: string | null;
	reference?: string | null;
	date?: string | null;
};

export type Rule = {
	id?: number;
	field: 'text' | 'voen' | 'reference';
	pattern: string;
	isRegex: boolean;
	direction: 'in' | 'out' | 'any';
	accountCode: string;
	priority: number; // lower wins
	/** item 12: optional conditions – absolute amount range (qəpik) and date window */
	minAmount?: number | null;
	maxAmount?: number | null;
	dateFrom?: string | null;
	dateTo?: string | null;
	/** automationsvåg 2 (1): corrected twice within 90 days – still suggests, but after every live company rule and never automated */
	demoted?: boolean;
};

/** `weight` (V4 61): 1 = trusted; pruning lowers contradicted (0.5 / 0.1) and stale (0.7) examples – scores are multiplied by it. */
/** `lastUsed` (AI-förbättringar 23): the newest confirmation (ISO date or timestamp) – an account the company stopped using for a text loses weight against the one it uses now (`practiceFactors`). */
export type MemoryItem = { textNorm: string; code: string; vector: Float32Array; count: number; shared?: boolean; weight?: number; lastUsed?: string | null };
