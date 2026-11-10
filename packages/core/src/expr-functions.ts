import type { Value } from './expr-values.js';
import {
  isBlankValue,
  toNumber,
  toDate,
  truthy,
  looseEquals,
  flatten,
  numbers,
  monthsBetween,
} from './expr-values.js';

export function aggregate(fn: string, values: Value[]): Value {
  const nonBlank = values.filter(v => !isBlankValue(v));
  switch (fn) {
    case 'sum': {
      const nums = numbers(nonBlank);
      let total = 0;
      for (const n of nums) total += n;
      return total as unknown as Value;
    }
    case 'count': {
      return nonBlank.length as unknown as Value;
    }
    case 'min': {
      const nums = numbers(nonBlank);
      if (nums.length === 0) return null;
      let min = nums[0];
      for (const n of nums) {
        if (n < min) min = n;
      }
      return min as unknown as Value;
    }
    case 'max': {
      const nums = numbers(nonBlank);
      if (nums.length === 0) return null;
      let max = nums[0];
      for (const n of nums) {
        if (n > max) max = n;
      }
      return max as unknown as Value;
    }
    case 'avg': {
      const nums = numbers(nonBlank);
      if (nums.length === 0) return null;
      let sum = 0;
      for (const n of nums) sum += n;
      return sum / nums.length as unknown as Value;
    }
    case 'unique': {
      const distinct: Value[] = [];
      for (const v of nonBlank) {
        if (!distinct.some(d => looseEquals(d, v))) {
          distinct.push(v);
        }
      }
      return distinct.length as unknown as Value;
    }
    case 'first': {
      for (const v of nonBlank) {
        if (!isBlankValue(v)) return v;
      }
      return null;
    }
    default:
      throw new Error(`Unknown aggregate ${fn}`);
  }
}

export function callScalar(fn: string, args: Value[], now?: Date): Value {
  const a = (i: number): Value => args[i] ?? null;

  switch (fn) {
    case 'abs': {
      const n = toNumber(a(0));
      return n === null ? null : Math.abs(n);
    }
    case 'floor': {
      const n = toNumber(a(0));
      return n === null ? null : Math.floor(n);
    }
    case 'ceil': {
      const n = toNumber(a(0));
      return n === null ? null : Math.ceil(n);
    }
    case 'round': {
      const n = toNumber(a(0));
      const dArg = a(1);
      const d = dArg !== undefined && dArg !== null ? toNumber(dArg) : 0;
      if (n === null || d === null) return null;
      const multiplier = Math.pow(10, d);
      return Math.round(n * multiplier) / multiplier;
    }
    case 'if': {
      const c = a(0);
      if (truthy(c)) return a(1);
      return a(2);
    }
    case 'nvl':
    case 'coalesce': {
      for (const arg of args) {
        if (!isBlankValue(arg)) return arg;
      }
      return null;
    }
    case 'isblank': {
      return isBlankValue(a(0)) ? true : false;
    }
    case 'num': {
      const n = toNumber(a(0));
      return n;
    }
    case 'len': {
      const v = a(0);
      if (v === null || v === undefined) {
        return 0;
      }
      if (Array.isArray(v)) {
        return v.length;
      }
      if (typeof v === 'string') {
        return v.length;
      }
      return String(v).length;
    }
    case 'lower': {
      const v = a(0);
      if (v === null) return '';
      const s = String(v);
      return s.toLowerCase();
    }
    case 'upper': {
      const v = a(0);
      if (v === null) return '';
      const s = String(v);
      return s.toUpperCase();
    }
    case 'trim': {
      const v = a(0);
      if (v === null) return '';
      const s = String(v);
      return s.trim();
    }
    case 'str': {
      const v = a(0);
      return String(v);
    }
    case 'left': {
      const s = a(0);
      const k = a(1);
      const str = s === null ? '' : String(s);
      const numK = toNumber(k);
      if (numK === null) return null;
      if (typeof str !== 'string') return null;
      if (numK < 0) return '';
      return str.substring(0, numK);
    }
    case 'right': {
      const s = a(0);
      const k = a(1);
      const str = s === null ? '' : String(s);
      const numK = toNumber(k);
      if (numK === null) return null;
      if (typeof str !== 'string') return null;
      if (numK <= 0) return '';
      const start = str.length - numK;
      if (start < 0) return str;
      return str.substring(start);
    }
    case 'contains': {
      const s = a(0);
      const t = a(1);
      const strS = s === null ? '' : String(s);
      const strT = t === null ? '' : String(t);
      return strS.includes(strT);
    }
    case 'startswith': {
      const s = a(0);
      const t = a(1);
      const strS = s === null ? '' : String(s);
      const strT = t === null ? '' : String(t);
      return strS.startsWith(strT);
    }
    case 'endswith': {
      const s = a(0);
      const t = a(1);
      const strS = s === null ? '' : String(s);
      const strT = t === null ? '' : String(t);
      return strS.endsWith(strT);
    }
    case 'matches': {
      const s = a(0);
      const re = a(1);
      const flags = a(2);
      const strS = s === null ? '' : String(s);
      const strRe = re === null ? '' : String(re);
      const strFlags = flags === null ? '' : String(flags);
      let regex: RegExp;
      try {
        regex = new RegExp(strRe, strFlags);
      } catch {
        return false;
      }
      return regex.test(strS);
    }
    case 'in': {
      const v = a(0);
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (Array.isArray(arg)) {
          for (const elem of arg) {
            if (looseEquals(v, elem)) return true;
          }
        } else {
          if (looseEquals(v, arg)) return true;
        }
      }
      return false;
    }
    case 'date': {
      const d = toDate(a(0));
      if (d === null) return null;
      const date = new Date(d);
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    case 'today': {
      const date = now ? new Date(now) : new Date();
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    case 'year': {
      const d = toDate(a(0));
      if (d === null) return null;
      return new Date(d).getUTCFullYear();
    }
    case 'month': {
      const d = toDate(a(0));
      if (d === null) return null;
      return new Date(d).getUTCMonth() + 1;
    }
    case 'day': {
      const d = toDate(a(0));
      if (d === null) return null;
      return new Date(d).getUTCDate();
    }
    case 'days_between': {
      const da = toDate(a(0));
      const db = toDate(a(1));
      if (da === null || db === null) return null;
      return Math.round((db - da) / 86400000);
    }
    case 'months_between': {
      const da = toDate(a(0));
      const db = toDate(a(1));
      if (da === null || db === null) return null;
      return monthsBetween(da, db);
    }
    case 'years_between': {
      const da = toDate(a(0));
      const db = toDate(a(1));
      if (da === null || db === null) return null;
      return Math.trunc(monthsBetween(da, db) / 12);
    }
    default:
      throw new Error(`Unknown function ${fn}`);
  }
}
