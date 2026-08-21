const DECIMAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

interface DecimalRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function invalid(reason: string): never {
  throw new TypeError(`DECIMAL_INVALID:${reason}`);
}

function parseDecimal(value: string, reason: string): DecimalRational {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return invalid(reason);
  const match = DECIMAL.exec(value);
  if (match === null) return invalid(reason);
  const fraction = match[3] ?? "";
  const denominator = 10n ** BigInt(fraction.length);
  const unsigned = BigInt(`${match[2]}${fraction}`);
  return Object.freeze({
    numerator: match[1] === "-" ? -unsigned : unsigned,
    denominator,
  });
}

export function roundHalfAwayFromZeroRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return invalid("denominator");
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  if (remainder * 2n >= denominator) quotient += 1n;
  const signed = negative ? -quotient : quotient;
  const result = Number(signed);
  if (!Number.isSafeInteger(result)) return invalid("result");
  return result;
}

export function roundDecimalRatio(
  current: string,
  target: string,
  multiplier: bigint,
): number {
  const left = parseDecimal(current, "current");
  const right = parseDecimal(target, "target");
  if (left.numerator < 0n) return invalid("current");
  if (right.numerator <= 0n) return invalid("target");
  if (multiplier <= 0n) return invalid("multiplier");
  return roundHalfAwayFromZeroRatio(
    left.numerator * right.denominator * multiplier,
    left.denominator * right.numerator,
  );
}

export function isPositiveCanonicalDecimal(value: string): boolean {
  const parsed = parseDecimal(value, "value");
  return parsed.numerator > 0n;
}

export function isDecimalRatioBelow(
  current: string,
  target: string,
  multiplier: bigint,
): boolean {
  const left = parseDecimal(current, "current");
  const right = parseDecimal(target, "target");
  if (left.numerator < 0n) return invalid("current");
  if (right.numerator <= 0n) return invalid("target");
  if (multiplier <= 0n) return invalid("multiplier");
  return left.numerator * right.denominator * multiplier <
    right.numerator * left.denominator;
}

export function canonicalDecimalFromScaledInteger(value: number, scale: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return invalid("scaled_integer");
  if (!Number.isSafeInteger(scale) || scale <= 0) return invalid("scale");
  const numerator = BigInt(value);
  const denominator = BigInt(scale);
  const integer = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return integer.toString();
  const width = scale.toString().length - 1;
  if (10 ** width !== scale) return invalid("scale");
  const fraction = remainder.toString().padStart(width, "0").replace(/0+$/u, "");
  return `${integer}.${fraction}`;
}

export function canonicalDecimalFromNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) return invalid("number");
  const text = String(value);
  if (DECIMAL.test(text)) return text;
  const exponent = /^(\d)(?:\.([0-9]+))?[eE]([+-]?\d+)$/u.exec(text);
  if (exponent === null) return invalid("number");
  const digits = `${exponent[1]}${exponent[2] ?? ""}`;
  const decimalPosition = 1 + Number(exponent[3]);
  if (!Number.isSafeInteger(decimalPosition)) return invalid("number");
  const expanded = decimalPosition <= 0
    ? `0.${"0".repeat(-decimalPosition)}${digits}`
    : decimalPosition >= digits.length
      ? `${digits}${"0".repeat(decimalPosition - digits.length)}`
      : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  if (!DECIMAL.test(expanded) || expanded.length > 512) return invalid("number");
  return expanded;
}
