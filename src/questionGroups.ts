/**
 * AI-förbättringar spår N (58) – "12 rader från X – samma fråga". Open coding questions that ask the same thing about the
 * same party are one question: same kind of row and direction of the money, same template, the same set of options and the
 * same party – the counterparty when the row has one, else its VÖEN. Revisorskontroll AI2-22: the bank text alone never
 * names a party – twelve "ÖDƏNİŞ QAİMƏ ÜZRƏ" rows from unknown payers are twelve questions, one answer must not code them
 * all alike. The service answers every row of a group through `applyCoding`, one by one.
 */
export type GroupableQuestion = {
	id: number;
	targetType: 'txn' | 'invoice';
	targetId: number;
	questionKey: string;
	options: { account: string }[];
	direction: 'in' | 'out';
	counterpartyId: number | null;
	voen: string | null;
	text: string | null;
};
export type QuestionGroup<T extends GroupableQuestion> = { key: string; items: T[] };

/** the party of a row: counterparty → VÖEN; null = no party, not groupable (the text is never one – AI2-22) */
export function partyKey(q: Pick<GroupableQuestion, 'counterpartyId' | 'voen' | 'text'>): string | null {
	if (q.counterpartyId != null) return `cp:${q.counterpartyId}`;
	const v = (q.voen ?? '').replace(/\D/g, '');
	if (v.length === 10) return `voen:${v}`;
	return null;
}

export function questionGroupKey(q: GroupableQuestion): string | null {
	const party = partyKey(q);
	if (!party) return null;
	const accounts = [...new Set(q.options.map((o) => o.account))].sort().join(',');
	return `${q.targetType}|${q.direction}|${q.questionKey}|${accounts}|${party}`;
}

/**
 * Groups in the order of their first question; a question without a groupable party is a group of one. The rows of a group
 * keep their own order (newest question first, as the inbox lists them).
 */
export function groupQuestions<T extends GroupableQuestion>(qs: T[]): QuestionGroup<T>[] {
	const out: QuestionGroup<T>[] = [];
	const at = new Map<string, QuestionGroup<T>>();
	for (const q of qs) {
		const k = questionGroupKey(q) ?? `single:${q.id}`;
		const g = at.get(k);
		if (g) g.items.push(q);
		else {
			const n = { key: k, items: [q] };
			at.set(k, n);
			out.push(n);
		}
	}
	return out;
}
