export function currentDateIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function compactDate(date = currentDateIso()) {
  return date.replaceAll("-", "");
}

export function dateDaysAgo(days: number, now = new Date()) {
  const result = new Date(now);
  result.setUTCDate(result.getUTCDate() - days);
  return currentDateIso(result);
}

export function currentDateStartIso(now = new Date()) {
  return `${currentDateIso(now)}T00:00:00.000Z`;
}

export function dateYearsFromNow(years: number, now = new Date()) {
  const result = new Date(now);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return currentDateIso(result);
}

export function quarterKey(date = new Date()) {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}q${quarter}`;
}

export function quartersAgo(count: number, now = new Date()) {
  const result = new Date(now);
  result.setUTCMonth(result.getUTCMonth() - count * 3);
  return quarterKey(result);
}
