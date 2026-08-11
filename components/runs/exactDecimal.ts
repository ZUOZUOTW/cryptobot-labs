interface ExactDecimal {
  units: bigint;
  scale: number;
}

const DECIMAL = /^([+-]?)(\d{1,24})(?:\.(\d{1,18}))?$/;
const powerOfTen = (exponent: number): bigint => 10n ** BigInt(exponent);

const parseExactDecimal = (value: string): ExactDecimal | null => {
  const match = DECIMAL.exec(value);
  if (!match) return null;
  const fraction = match[3] ?? "";
  const digits = `${match[2]}${fraction}`;
  const magnitude = BigInt(digits);
  return { units: match[1] === "-" ? -magnitude : magnitude, scale: fraction.length };
};

const exactDecimalString = ({ units, scale }: ExactDecimal): string => {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const integer = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  const sign = negative && units !== 0n ? "-" : "";
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
};

export const sumExactDecimals = (values: readonly string[]): string | null => {
  let total: ExactDecimal = { units: 0n, scale: 0 };
  for (const value of values) {
    const parsed = parseExactDecimal(value);
    if (!parsed) return null;
    if (parsed.scale > total.scale) {
      total = { units: total.units * powerOfTen(parsed.scale - total.scale), scale: parsed.scale };
    }
    total.units += parsed.units * powerOfTen(total.scale - parsed.scale);
  }
  return exactDecimalString(total);
};

export const exactDecimalSign = (value: string | null): -1 | 0 | 1 | null => {
  if (value === null) return null;
  const parsed = parseExactDecimal(value);
  if (!parsed) return null;
  return parsed.units < 0n ? -1 : parsed.units > 0n ? 1 : 0;
};

export const exactPercent = (numerator: string, denominator: string): number | null => {
  const left = parseExactDecimal(numerator);
  const right = parseExactDecimal(denominator);
  if (!left || !right || left.units < 0n || right.units <= 0n) return null;
  const scaledLeft = left.units * powerOfTen(right.scale);
  const scaledRight = right.units * powerOfTen(left.scale);
  if (scaledLeft >= scaledRight) return 100;
  const precision = 1_000_000n;
  return Number(scaledLeft * 100n * precision / scaledRight) / Number(precision);
};

export const formatExactDecimal = (
  value: string,
  locale: string,
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number; signed?: boolean } = {},
): string | null => {
  const parsed = parseExactDecimal(value);
  if (!parsed) return null;
  const minimumFractionDigits = options.minimumFractionDigits ?? 2;
  const maximumFractionDigits = options.maximumFractionDigits ?? 4;
  if (minimumFractionDigits < 0 || maximumFractionDigits < minimumFractionDigits) return null;

  let units = parsed.units;
  let scale = parsed.scale;
  if (scale > maximumFractionDigits) {
    const divisor = powerOfTen(scale - maximumFractionDigits);
    const negative = units < 0n;
    const magnitude = negative ? -units : units;
    let rounded = magnitude / divisor;
    if (magnitude % divisor * 2n >= divisor) rounded += 1n;
    units = negative ? -rounded : rounded;
    scale = maximumFractionDigits;
  }
  while (scale > minimumFractionDigits && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  if (scale < minimumFractionDigits) {
    units *= powerOfTen(minimumFractionDigits - scale);
    scale = minimumFractionDigits;
  }

  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const digits = magnitude.toString().padStart(scale + 1, "0");
  const integerDigits = scale ? digits.slice(0, -scale) : digits;
  const fractionDigits = scale ? digits.slice(-scale) : "";
  const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: true })
    .format(BigInt(integerDigits));
  const localizedDigits = Array.from({ length: 10 }, (_, digit) =>
    new Intl.NumberFormat(locale, { useGrouping: false }).format(digit));
  const localizedFraction = fractionDigits.replace(/\d/g, (digit) => localizedDigits[Number(digit)]!);
  const decimalSeparator = new Intl.NumberFormat(locale).formatToParts(1.1)
    .find(({ type }) => type === "decimal")?.value ?? ".";
  const sign = negative ? "-" : options.signed ? "+" : "";
  return `${sign}${integer}${localizedFraction ? `${decimalSeparator}${localizedFraction}` : ""}`;
};
