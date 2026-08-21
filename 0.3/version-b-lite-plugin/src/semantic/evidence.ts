const CHINESE_DIGITS: Readonly<Record<string, number>> = Object.freeze({
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
});

const UNIT_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ml: Object.freeze(["ml", "mL", "毫升"]),
  l: Object.freeze(["l", "L", "升"]),
  g: Object.freeze(["g", "克"]),
  kg: Object.freeze(["kg", "KG", "公斤", "千克"]),
  kcal: Object.freeze(["kcal", "千卡", "大卡"]),
  个: Object.freeze(["个", "只", "枚"]),
  碗: Object.freeze(["碗"]),
  杯: Object.freeze(["杯"]),
  盒: Object.freeze(["盒"]),
  瓶: Object.freeze(["瓶"]),
  袋: Object.freeze(["袋"]),
  箱: Object.freeze(["箱"]),
  岁: Object.freeze(["岁"]),
  cm: Object.freeze(["cm", "厘米", "公分"]),
});

function decimalTokens(text: string): readonly number[] {
  return Object.freeze(Array.from(text.matchAll(/(?:^|[^0-9.])([0-9]+(?:\.[0-9]+)?)/gu))
    .map((match) => Number(match[1]))
    .filter(Number.isFinite));
}

function chineseNumber(token: string): number | null {
  if (token.length === 1) return CHINESE_DIGITS[token] ?? null;
  if (token === "十") return 10;
  if (token.startsWith("十")) {
    const ones = CHINESE_DIGITS[token.slice(1)] ?? null;
    return ones === null ? null : 10 + ones;
  }
  if (token.endsWith("十")) {
    const tens = CHINESE_DIGITS[token.slice(0, -1)] ?? null;
    return tens === null ? null : tens * 10;
  }
  const [tensToken, onesToken, extra] = token.split("十");
  if (extra !== undefined || tensToken === undefined || onesToken === undefined) return null;
  const tens = CHINESE_DIGITS[tensToken] ?? null;
  const ones = CHINESE_DIGITS[onesToken] ?? null;
  return tens === null || ones === null ? null : tens * 10 + ones;
}

export function parseEvidenceNumberToken(token: string): number | null {
  if (/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(token)) {
    const value = Number(token);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const value = chineseNumber(token);
  return value !== null && value > 0 ? value : null;
}

function chineseTokens(text: string): readonly number[] {
  return Object.freeze(Array.from(text.matchAll(/[零〇一二两俩三四五六七八九十]+/gu))
    .map((match) => chineseNumber(match[0]))
    .filter((value): value is number => value !== null));
}

export function evidenceContainsNumber(evidenceSpan: string, value: number): boolean {
  return [...decimalTokens(evidenceSpan), ...chineseTokens(evidenceSpan)]
    .some((candidate) => candidate === value);
}

export function evidenceContainsUnit(evidenceSpan: string, unit: string): boolean {
  const aliases = UNIT_ALIASES[unit] ?? Object.freeze([unit]);
  return aliases.some((alias) => evidenceSpan.includes(alias));
}

export function exactAmountEvidenceAgrees(
  evidenceSpan: string,
  value: number,
  unit: string,
): boolean {
  return evidenceContainsNumber(evidenceSpan, value) && evidenceContainsUnit(evidenceSpan, unit);
}

export function normalizedLiquidMillilitres(value: number, unit: string): number | null {
  if (unit === "ml" || unit === "毫升") return value;
  if (unit === "l" || unit === "L" || unit === "升") return value * 1_000;
  return null;
}

export function isAuthorityShapedReference(value: string): boolean {
  return /(?:event|record|batch|product|snapshot|correction|envelope|operation|message|conversation)[_-]?id\s*[:=]/iu
    .test(value) ||
    /\b[0-9A-HJKMNP-TV-Z]{26}\b/u.test(value) ||
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(value);
}
