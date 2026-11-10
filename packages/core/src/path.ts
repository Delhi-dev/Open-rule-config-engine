export type Segment = { key: string } | { index: number | '*' };
export type Bindings = Record<string, number>;
export interface PathMatch {
  path: string;
  value: unknown;
  exists: boolean;
  bindings: Bindings;
}

export function parsePath(path: string): Segment[] {
  const trimmed = path.trim();
  const segments: Segment[] = [];
  const regex = /([^.\[\]]+)|\[(\*|\d+)\]/g;
  let m;
  while ((m = regex.exec(trimmed)) !== null) {
    if (m[1] !== undefined) {
      segments.push({ key: m[1] });
    } else if (m[2] !== undefined) {
      const idx = m[2] === '*' ? '*' : parseInt(m[2], 10);
      segments.push({ index: idx });
    }
  }
  return segments;
}

export function formatPath(segments: Segment[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    if ('key' in seg) {
      parts.push(seg.key);
    } else {
      const idx = seg.index === '*' ? '*' : String(seg.index);
      const idxStr = `[${idx}]`;
      if (parts.length > 0 && !parts[parts.length - 1].startsWith('[')) {
        const last = parts.pop()!;
        parts.push(`${last}${idxStr}`);
      } else {
        parts.push(idxStr);
      }
    }
  }
  return parts.join('.');
}

export function normalizePath(path: string): string {
  return formatPath(parsePath(path));
}

export function resolvePath(data: unknown, path: string, bindings: Bindings = {}): PathMatch[] {
  const segments = parsePath(path);
  let matches: { value: unknown, path: string, bindings: Bindings }[] = [{ value: data, path: '', bindings: {} }];
  for (const seg of segments) {
    const nextMatches: { value: unknown, path: string, bindings: Bindings }[] = [];
    for (const match of matches) {
      if ('key' in seg) {
        const key = seg.key;
        if (typeof match.value === 'object' && match.value !== null) {
          const obj = match.value as Record<string, unknown>;
          if (key in obj) {
            const val = obj[key];
            const newPath = match.path ? `${match.path}.${key}` : key;
            nextMatches.push({
              value: val,
              path: newPath,
              bindings: { ...match.bindings }
            });
          } else {
            const newPath = match.path ? `${match.path}.${key}` : key;
            nextMatches.push({
              value: undefined,
              path: newPath,
              bindings: { ...match.bindings }
            });
          }
        } else {
          const newPath = match.path ? `${match.path}.${seg.key}` : seg.key;
          nextMatches.push({
            value: undefined,
            path: newPath,
            bindings: { ...match.bindings }
          });
        }
      } else if ('index' in seg) {
        let arr: unknown[];
        if (Array.isArray(match.value)) {
          arr = match.value;
        } else if (match.value === null || match.value === undefined) {
          arr = [];
        } else {
          arr = [match.value];
        }
        if (seg.index === '*') {
          if (arr.length === 0) {
            continue;
          }
          const arrayPath = match.path || '';
          const boundIndex = bindings[arrayPath];
          if (boundIndex !== undefined) {
            if (boundIndex < arr.length) {
              const val = arr[boundIndex];
              const newPath = match.path ? `${match.path}[${boundIndex}]`.replace(/^\./, '') : `[${boundIndex}]`;
              const newBindings = { ...match.bindings, [arrayPath]: boundIndex };
              nextMatches.push({
                value: val,
                path: newPath,
                bindings: newBindings
              });
            } else {
              const newPath = match.path ? `${match.path}[${boundIndex}]`.replace(/^\./, '') : `[${boundIndex}]`;
              const newBindings = { ...match.bindings, [arrayPath]: boundIndex };
              nextMatches.push({
                value: undefined,
                path: newPath,
                bindings: newBindings
              });
            }
          } else {
            for (let i = 0; i < arr.length; i++) {
              const val = arr[i];
              const newPath = match.path ? `${match.path}[${i}]`.replace(/^\./, '') : `[${i}]`;
              const newBindings = { ...match.bindings, [arrayPath]: i };
              nextMatches.push({
                value: val,
                path: newPath,
                bindings: newBindings
              });
            }
          }
        } else {
          const idx = seg.index as number;
          if (idx < arr.length) {
            const val = arr[idx];
            const newPath = match.path ? `${match.path}[${idx}]`.replace(/^\./, '') : `[${idx}]`;
            nextMatches.push({
              value: val,
              path: newPath,
              bindings: { ...match.bindings }
            });
          } else {
            const newPath = match.path ? `${match.path}[${idx}]`.replace(/^\./, '') : `[${idx}]`;
            nextMatches.push({
              value: undefined,
              path: newPath,
              bindings: { ...match.bindings }
            });
          }
        }
      }
    }
    matches = nextMatches;
    if (matches.length === 0) break;
  }
  return matches.map(m => ({
    path: m.path,
    value: m.value,
    exists: m.value !== undefined && m.value !== null || (typeof m.value === 'object' && m.value !== null) ? true : false,
    bindings: m.bindings
  }));
}

export function getAtPath(data: unknown, path: string): unknown {
  const matches = resolvePath(data, path);
  if (matches.length === 0) return undefined;
  return matches[0].value;
}

function _setAtPath(current: unknown, segments: Segment[], value: unknown): unknown {
  if (segments.length === 0) {
    return value;
  }
  const seg = segments[0];
  const rest = segments.slice(1);
  if ('key' in seg) {
    const key = seg.key;
    const currentObj = typeof current === 'object' && current !== null ? current as Record<string, unknown> : {};
    const newObj = { ...currentObj };
    if (rest.length === 0) {
      newObj[key] = value;
    } else {
      const existing = currentObj[key];
      const newSub = _setAtPath(existing, rest, value);
      newObj[key] = newSub;
    }
    return newObj;
  } else if ('index' in seg) {
    let idx: number;
    if (seg.index === '*') {
      idx = 0;
    } else {
      idx = seg.index as number;
    }
    const currentArr = Array.isArray(current) ? current : [];
    const arr = [...currentArr];
    while (arr.length <= idx) {
      arr.push(undefined);
    }
    if (rest.length === 0) {
      arr[idx] = value;
    } else {
      const existing = arr[idx];
      arr[idx] = _setAtPath(existing, rest, value);
    }
    return arr;
  }
  return current;
}

export function setAtPath(data: unknown, path: string, value: unknown): unknown {
  const segments = parsePath(path);
  return _setAtPath(data, segments, value);
}

function _deleteAtPath(current: unknown, segments: Segment[]): unknown {
  if (segments.length === 0) {
    return undefined;
  }
  const seg = segments[0];
  const rest = segments.slice(1);
  if ('key' in seg) {
    const key = seg.key;
    if (typeof current === 'object' && current !== null && key in (current as Record<string, unknown>)) {
      const currentObj = current as Record<string, unknown>;
      const value = currentObj[key];
      const newSub = _deleteAtPath(value, rest);
      const newObj = { ...currentObj };
      if (newSub === undefined) {
        delete newObj[key];
      } else {
        newObj[key] = newSub;
      }
      return newObj;
    } else {
      return current;
    }
  } else if ('index' in seg) {
    let idx: number;
    if (seg.index === '*') {
      return current;
    } else {
      idx = seg.index as number;
    }
    if (Array.isArray(current)) {
      if (rest.length === 0) {
        if (idx < current.length) {
          const arr = [...current];
          arr.splice(idx, 1);
          return arr;
        } else {
          return current;
        }
      } else {
        const arr = [...current];
        for (let i = 0; i < arr.length; i++) {
          const newSub = _deleteAtPath(arr[i], rest);
          if (newSub === undefined) {
            arr.splice(i, 1);
            i--;
          } else {
            arr[i] = newSub;
          }
        }
        return arr;
      }
    } else {
      return current;
    }
  }
  return current;
}

export function deleteAtPath(data: unknown, path: string): unknown {
  const segments = parsePath(path);
  return _deleteAtPath(data, segments);
}

export function toTemplatePath(path: string): string {
  const segments = parsePath(path);
  const templateSegments: Segment[] = segments.map(seg => {
    if ('index' in seg) {
      return { index: '*' as const };
    } else {
      return seg;
    }
  });
  return formatPath(templateSegments);
}
