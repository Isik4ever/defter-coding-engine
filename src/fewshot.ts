/**
 * V4 62: few-shot context per company for the local LLM. The model sees the company's most frequent counterparties
 * with the account they usually land on and the most used expense accounts (names in az) before the question.
 * Pure text builder – the service collects the examples, `pnpm coding:eval --fewshot on|off` measures the effect.
 */
export type FewShotExamples = {
	counterparties: { name: string; code: string; n: number }[];
	accounts: { code: string; name: string; n: number }[];
};

export const FEWSHOT_LIMITS = { counterparties: 20, accounts: 15 } as const;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 60);

export function fewShotContext(ex: FewShotExamples, opts: { maxCounterparties?: number; maxAccounts?: number } = {}): string {
	const accounts = [...ex.accounts].filter((a) => a.n > 0).sort((a, b) => b.n - a.n || a.code.localeCompare(b.code, undefined, { numeric: true })).slice(0, opts.maxAccounts ?? FEWSHOT_LIMITS.accounts);
	const cps = [...ex.counterparties].filter((c) => c.n > 0 && c.name.trim()).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, opts.maxCounterparties ?? FEWSHOT_LIMITS.counterparties);
	const parts: string[] = [];
	if (accounts.length) parts.push('Bu şirkətdə ən çox istifadə olunan xərc hesabları:\n' + accounts.map((a) => `${a.code} ${clean(a.name)} (×${a.n})`).join('\n'));
	if (cps.length) parts.push('Tanış kontragentlər və adətən yazıldığı hesab:\n' + cps.map((c) => `${clean(c.name)} → ${c.code} (×${c.n})`).join('\n'));
	return parts.join('\n\n');
}
