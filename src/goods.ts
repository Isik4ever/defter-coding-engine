import type { Suggestion } from './types';

/**
 * Rollspel F-1.27 (Günəş Market): a trading company's purchase invoices for *goods* go to stock (205; 201 for a
 * producer), not to an expense account. The bundled text rules know nothing about "Makaron 400 q · Pomidor", so the
 * inbox showed 18 grocery invoices with no suggestion at all. The lines themselves tell: a unit of measure (kq, ədəd,
 * L …) or a quantity above one, and no service word. Mixed or service invoices are left to the accountant.
 */
export type GoodsLine = { description: string | null; unit: string | null; qty: number | null /* thousandths */ };

const GOODS_UNITS = new Set(
	['kq', 'kg', 'кг', 'q', 'qr', 'g', 'gr', 'г', 'ədəd', 'eded', 'əd', 'ed', 'pcs', 'pc', 'шт', 'штук', 'l', 'lt', 'litr', 'л', 'ml', 'мл', 'qutu', 'кор', 'коробка', 'paket', 'pak', 'упак', 'dəst', 'dest', 'набор', 'ton', 't', 'т', 'metr', 'm', 'м', 'm2', 'm²', 'm3', 'm³', 'rulon', 'рулон', 'yeşik', 'ящ', 'butulka', 'şüşə', 'бут', 'kisə', 'çuval', 'мешок', 'cüt', 'пар', 'top', 'blok', 'блок'].map((u) => u.toLowerCase())
);
const SERVICE_RE = /xidm[əe]t|услуг|service|icar[əe]|аренд|abun[əe]|подписк|konsaltinq|консалт|t[əe]mir|ремонт|daş[ıi]nma|перевозк|n[əe]qliyyat|logisti|çatd[ıi]r|доставк|komissiya|комисси|faiz|процент|lisenziya|лиценз|t[əe]lim|обучен|reklam|реклам|m[əe]sl[əe]h[əe]t|audit|аудит|sığorta|страхов/iu;

export const isGoodsUnit = (unit: string | null | undefined) => !!unit && GOODS_UNITS.has(unit.trim().toLowerCase().replace(/\.$/, ''));

export function goodsInvoiceSuggestion(lines: GoodsLine[], opts: { trading: boolean; stockAccount?: string }): Suggestion | null {
	if (!opts.trading || !lines.length) return null;
	const goods = lines.filter((l) => !SERVICE_RE.test(l.description ?? '') && (isGoodsUnit(l.unit) || (l.qty ?? 0) >= 2000));
	if (goods.length !== lines.length) return null;
	const units = [...new Set(lines.map((l) => l.unit?.trim()).filter(Boolean))].slice(0, 3).join('/');
	const code = opts.stockAccount ?? '205';
	return { code, confidence: 0.8, source: 'rule', alternatives: [], why: `mal alışı → ${code} (${lines.length} sətir${units ? ', ' + units : ''})`, defaultRule: true };
}
