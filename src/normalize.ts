const STOP = new Set([
	'mmc', 'asc', 'qsc', 'ооо', 'ltd', 'llc', 'fs', 'fərdi', 'sahibkar', 'ip', 'ип',
	'üçün', 'üzrə', 'və', 'ilə', 'the', 'and', 'for', 'и', 'для', 'по', 'от', 'за',
	'ödəniş', 'ödənişi', 'ödəmə', 'payment', 'оплата', 'платеж', 'платёж',
	'qaimə', 'faktura', 'invoice', 'счет', 'счёт', 'hesab', 'no', '№', 'ref', 'tarixli', 'saylı'
]);

/** Lowercase, strip numbers/dates/punctuation, drop legal-form and payment noise words. */
export function normalize(text: string): string {
	return tokens(text).join(' ');
}

export function tokens(text: string): string[] {
	// İ must be folded *before* toLowerCase – "QAİMƏ".toLowerCase() is "qai̇mə" (i + combining dot) and the dot then splits the
	// token into "qai mə" (rollspel F-1.32)
	return text
		.replace(/İ/g, 'i')
		.toLowerCase()
		.replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g, ' ')
		.replace(/[0-9]+/g, ' ')
		.replace(/[^\p{L}\s]/gu, ' ')
		.split(/\s+/)
		.filter((t) => t.length >= 2 && !STOP.has(t));
}
