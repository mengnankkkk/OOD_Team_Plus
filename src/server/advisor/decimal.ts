const decimalPattern = /^-?[0-9]+(?:\.[0-9]+)?$/;

export function assertDecimal(value: string) {
  if (!decimalPattern.test(value)) throw new Error(`Invalid decimal: ${value}`);
  return value;
}

export function toScaled(value: string, scale: number) {
  assertDecimal(value);
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const padded = `${fraction}${"0".repeat(scale)}`.slice(0, scale);
  const scaled = BigInt(`${whole}${padded}` || "0");
  return negative ? -scaled : scaled;
}

export function fromScaled(value: bigint, scale: number) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const digits = absolute.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale) || "0";
  const fraction = scale > 0 ? `.${digits.slice(-scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

export function moneyToMinor(value: string) {
  return Number(toScaled(value, 2));
}

export function minorToMoney(value: number) {
  return fromScaled(BigInt(value), 2);
}

export function multiplyToMinor(price: string, quantity: string) {
  const priceScaled = toScaled(price, 4);
  const quantityScaled = toScaled(quantity, 4);
  return Number((priceScaled * quantityScaled) / BigInt(1_000_000));
}

export function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function roundDecimal(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}
