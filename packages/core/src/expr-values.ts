export type Value = number | string | boolean | null | Value[];

export function isBlankValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') {
    return v.trim() === '';
  }
  if (Array.isArray(v)) {
    return v.length === 0;
  }
  if (typeof v === 'object') {
    if (v === null) return true;
    return Object.keys(v).length === 0;
  }
  return false;
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    return Number.isNaN(v) ? null : v;
  }
  if (typeof v === 'boolean') {
    return v ? 1 : 0;
  }
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function toDate(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  // ISO date: YYYY-MM-DD or with time
  if (v.length >= 10 && v[4] === '-' && v[7] === '-') {
    const year = parseInt(v.substring(0, 4), 10);
    const month = parseInt(v.substring(5, 7), 10) - 1;
    const day = parseInt(v.substring(8, 10), 10);
    const date = new Date(Date.UTC(year, month, day));
    if (!isNaN(date.getTime()) && date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
      return date.getTime();
    }
  }
  // DD/MM/YYYY or DD-MM-YYYY
  if ((v[2] === '/' || v[2] === '-') && v.length >= 10) {
    const day = parseInt(v.substring(0, 2), 10);
    const month = parseInt(v.substring(3, 5), 10) - 1;
    const year = parseInt(v.substring(6, 10), 10);
    const date = new Date(Date.UTC(year, month, day));
    if (!isNaN(date.getTime()) && date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
      return date.getTime();
    }
  }
  return null;
}

export function truthy(v: Value): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) {
    return v.length > 0;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return false;
    if (s === 'false' || s === '0') return false;
    return true;
  }
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  return Boolean(v);
}

export function looseEquals(a: unknown, b: unknown): boolean {
  const ab = isBlankValue(a);
  const bb = isBlankValue(b);
  if (ab && bb) return true;
  if (ab || bb) return false;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) {
    return na === nb;
  }
  const da = toDate(a);
  const db = toDate(b);
  if (da !== null && db !== null) {
    return da === db;
  }
  return String(a) === String(b);
}

export function compareValues(a: unknown, b: unknown): number | null {
  const ab = isBlankValue(a);
  const bb = isBlankValue(b);
  if (ab || bb) return null;
  if (Array.isArray(a) || Array.isArray(b)) return null;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) {
    if (na < nb) return -1;
    if (na > nb) return 1;
    return 0;
  }
  const da = toDate(a);
  const db = toDate(b);
  if (da !== null && db !== null) {
    if (da < db) return -1;
    if (da > db) return 1;
    return 0;
  }
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

export function flatten(v: Value): Value[] {
  if (Array.isArray(v)) {
    return v.flatMap(flatten);
  } else {
    return [v];
  }
}

export function numbers(v: Value): number[] {
  const flat = flatten(v);
  const result: number[] = [];
  for (const item of flat) {
    const n = toNumber(item);
    if (n !== null) {
      result.push(n);
    }
  }
  return result;
}

// Convert any value to a number for arithmetic, treating blank and non-numeric as 0
function toArithmeticNumber(v: Value): number {
  if (isBlankValue(v)) return 0;
  const n = toNumber(v);
  if (n === null) return 0;
  return n;
}

export function arithmetic(op: string, l: Value, r: Value): Value {
  const lv = toArithmeticNumber(l);
  const rv = toArithmeticNumber(r);
  switch (op) {
    case '+': return lv + rv;
    case '-': return lv - rv;
    case '*': return lv * rv;
    case '/': return rv === 0 ? null : lv / rv;
    case '%': return rv === 0 ? null : lv % rv;
    default: return null;
  }
}

export function toValue(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    return v.map(toValue);
  }
  if (typeof v === 'object') {
    if (v === null) return null;
    const keys = Object.keys(v);
    if (keys.length === 0) return null;
    return 'object';
  }
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
    return v;
  }
  return String(v);
}

export function monthsBetween(a: number, b: number): number {
  const dateA = new Date(a);
  const dateB = new Date(b);
  let months = (dateB.getUTCFullYear() - dateA.getUTCFullYear()) * 12 + (dateB.getUTCMonth() - dateA.getUTCMonth());
  if (dateB.getUTCDate() < dateA.getUTCDate()) {
    months--;
  }
  return months;
}
