/**
 * Aktualitetsrevision §31: one explanation object for every engine that grades, scores or suggests – risk checks, audit
 * tests, coding, anomaly detection and (validated) AI answers. The UI renders it with the shared <Why> component.
 */
export type EvidenceKind = 'entry' | 'txn' | 'invoice' | 'document' | 'page' | 'rule' | 'tool' | 'counterparty' | 'account' | 'knowledge';

export type EvidenceRef = { kind: EvidenceKind; id: number | string; label: string; href?: string; page?: number };

export type Reason = { key: string; text: string; weight?: number; value?: number | string };

export type Explanation = {
	result: string;
	score?: number; // 0–100 (risk) or 0–1 (confidence-like)
	reasons: Reason[];
	evidence: EvidenceRef[];
	calculation?: string;
	confidence: number; // 0–1
	source: 'rule' | 'stat' | 'ml' | 'llm';
};

export function explanation(p: Partial<Explanation> & Pick<Explanation, 'result' | 'source'>): Explanation {
	return { reasons: [], evidence: [], confidence: p.source === 'rule' ? 1 : 0.8, ...p };
}

/**
 * AI-förbättringar (73): the Isolation Forest drivers of an anomaly (`data.drivers`: feature + direction + share) as
 * reasons keyed `aifor.drv.<feature>.<direction>` – <Why> renders them in the reader's language, the weight is the share.
 */
export function driverReasons(drivers: unknown): Reason[] {
	if (!Array.isArray(drivers)) return [];
	return drivers
		.filter((d): d is { feature: string; direction: string; share: number } => !!d && typeof d === 'object' && typeof (d as { feature?: unknown }).feature === 'string' && typeof (d as { direction?: unknown }).direction === 'string')
		.map((d) => ({ key: `aifor.drv.${d.feature}.${d.direction}`, text: `${d.feature}: ${d.direction}`, weight: typeof d.share === 'number' ? d.share : undefined }));
}

/** Risk-radar item → Explanation (score from severity; data → reasons; link → evidence). */
export function riskExplanation(it: { key: string; severity: 'low' | 'medium' | 'high'; explanation: string; amount?: number; data?: Record<string, unknown>; link?: string; /** förbättringar 3 (50): the accountant's explanation («İzah edildi»), current or before the situation got worse */ ack?: { note: string } | null; reopened?: { note: string } | null }, base = ''): Explanation {
	const score = it.severity === 'high' ? 85 : it.severity === 'medium' ? 55 : 25;
	const reasons: Reason[] = [{ key: it.key, text: it.explanation }];
	const note = it.ack?.note ?? it.reopened?.note;
	if (note) reasons.push({ key: 'risk.ack', text: `✎ ${note}` });
	// ISO dates in the data are shown the way people read them (DD.MM.YYYY) – the walkthrough flags raw ISO in text
	const d = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? `${x.slice(8, 10)}.${x.slice(5, 7)}.${x.slice(0, 4)}` : x);
	for (const [k, v] of Object.entries(it.data ?? {})) {
		if (typeof v === 'number' || typeof v === 'string') reasons.push({ key: k, text: `${k}: ${typeof v === 'number' && Math.abs(v) >= 1000 && Number.isInteger(v) ? (v / 100).toFixed(2) : d(v)}`, value: v });
		else if (Array.isArray(v) && v.length && v.length <= 12 && v.every((x) => typeof x === 'string' || typeof x === 'number')) reasons.push({ key: k, text: `${k}: ${v.map(d).join(', ')}`, value: v.length });
	}
	reasons.push(...driverReasons(it.data?.drivers));
	const evidence: EvidenceRef[] = it.link ? [{ kind: 'rule', id: it.key, label: it.link.split('?')[0], href: `${base}/${it.link}` }] : [];
	return explanation({ result: it.severity, score, reasons, evidence, calculation: it.amount != null ? `amount ${(it.amount / 100).toFixed(2)}` : undefined, confidence: 1, source: 'rule' });
}

/** Audit finding → Explanation (statistical tests carry z/median etc. in data). */
export function findingExplanation(f: { testKey: string; severity: 'low' | 'medium' | 'high'; entityType: string; entityId: number; amount?: number | null; explanation: string; data?: Record<string, unknown> | null }, base = ''): Explanation {
	const stat = ['outlier', 'benford', 'anomaly', 'round', 'weekend', 'periodEnd'].includes(f.testKey);
	const reasons: Reason[] = [{ key: f.testKey, text: f.explanation }];
	for (const [k, v] of Object.entries(f.data ?? {})) if (typeof v === 'number' || typeof v === 'string') reasons.push({ key: k, text: `${k}: ${v}`, value: v });
	reasons.push(...driverReasons(f.data?.drivers));
	const evidence: EvidenceRef[] = f.entityType === 'entry' ? [{ kind: 'entry', id: f.entityId, label: `#${f.entityId}`, href: `${base}/ledger?entry=${f.entityId}` }] : f.entityType === 'counterparty' ? [{ kind: 'counterparty', id: f.entityId, label: `#${f.entityId}`, href: `${base}/counterparties/${f.entityId}` }] : f.entityType === 'invoice' ? [{ kind: 'invoice', id: f.entityId, label: `#${f.entityId}`, href: `${base}/invoices/${f.entityId}` }] : f.entityType === 'txn' ? [{ kind: 'txn', id: f.entityId, label: `txn #${f.entityId}`, href: `${base}/close?tab=bank` }] : [];
	return explanation({ result: f.severity, score: f.severity === 'high' ? 85 : f.severity === 'medium' ? 55 : 25, reasons, evidence, calculation: f.amount != null ? `amount ${(f.amount / 100).toFixed(2)}` : undefined, confidence: 1, source: stat ? 'stat' : 'rule' });
}

/** Coding suggestion → Explanation (rule/memory/bayes/llm confidence, alternatives as reasons). */
export function codingExplanation(s: { code: string; confidence: number; source: 'rule' | 'memory' | 'bayes' | 'llm' | 'expected'; why?: string | null; alternatives?: { code: string; confidence: number; source: string }[] }): Explanation {
	const reasons: Reason[] = [];
	if (s.why) reasons.push({ key: s.source, text: s.why });
	for (const a of s.alternatives ?? []) reasons.push({ key: 'alternative', text: `${a.code} (${a.source} ${Math.round(a.confidence * 100)} %)`, value: a.code, weight: a.confidence });
	return explanation({ result: s.code, score: Math.round(s.confidence * 100), reasons, evidence: [], confidence: s.confidence, source: s.source === 'rule' || s.source === 'expected' ? 'rule' : s.source === 'llm' ? 'llm' : s.source === 'bayes' ? 'stat' : 'ml' });
}
