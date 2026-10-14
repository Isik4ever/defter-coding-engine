/**
 * Skattegranskningen 2026-10-02, R3 (G 13.2, 5.5): a customer's payment without a finished performance is not revenue.
 * Until the qaimə (the delivery) comes, the money is an advance received – 543 (alınmış avans) – and the qaimə offsets it
 * (Dr 543 / Cr 211). When ƏDV arises on an advance (VM 166 – at payment or at delivery) is an open question to the tax
 * adviser (FRAGOR A12.5): the app books no ƏDV on the advance and shows an information line on the declaration instead.
 *
 * A "customer advance" is an inflow from a domestic registered party (VÖEN, resident) that is not a bank, the fiskus, an
 * owner, an employee or a supplier, and to which the company has issued no qaimə in the year before the payment – with a
 * qaimə of ours the payment settles 211 (`invoicingParty`). A person without VÖEN (retail) or a foreign client gets no
 * e-qaimə, so nothing tells an advance from a settled sale there – the suggestion is left alone.
 */
export const RECEIVED_ADVANCE_ACCOUNT = '543';
/** sales revenue – the account the router would book the payment to */
export const SALES_REVENUE = /^601(-|$)/;
/** counterparty kinds whose inflow is never a customer's advance */
const NOT_CUSTOMER = new Set(['bank', 'tax', 'owner', 'employee', 'supplier']);

export type AdvanceFacts = {
	amount: number;
	voen: string | null | undefined;
	kind?: string | null;
	residency?: string | null;
	/** the company issued a qaimə to the party in the year before the payment (its payment settles 211) */
	issuesOurInvoices: boolean;
	/** the party issued qaimələr to us (a supplier – an inflow from it is a refund) */
	suppliesUs: boolean;
};

export function customerAdvanceCandidate(f: AdvanceFacts): boolean {
	if (f.amount <= 0) return false;
	if (!f.voen || !/\d{10}/.test(f.voen.replace(/\D/g, ''))) return false;
	if (f.residency && f.residency !== 'resident') return false;
	if (f.kind && NOT_CUSTOMER.has(f.kind)) return false;
	if (f.suppliesUs || f.issuesOurInvoices) return false;
	return true;
}

/**
 * Which suggestion the advance may replace: none at all, or a guess about the words (a bundled default rule, bayes, the
 * model) on sales revenue. The company's own rule and its memory are its practice and stay – the bank automation still
 * refuses to code such a row to 601 on its own (`advanceSuspected`).
 */
export function advanceReplaces(s: { code: string; source: string; defaultRule?: boolean } | null | undefined): boolean {
	if (!s) return true;
	if (!SALES_REVENUE.test(s.code)) return false;
	return !!s.defaultRule || s.source === 'bayes' || s.source === 'llm';
}
