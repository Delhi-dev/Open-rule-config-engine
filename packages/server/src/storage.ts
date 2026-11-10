import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface Collection<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(record: T): Promise<T>;
  remove(id: string): Promise<boolean>;
}

export function fileCollection<T extends { id: string }>(dir: string): Collection<T> {
  const ensureDir = async () => {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // ignore
    }
  };

  return {
    async list() {
      await ensureDir();
      const files = await fs.readdir(dir);
      const records: T[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const id = file.slice(0, -5);
        if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
        try {
          const data = await fs.readFile(join(dir, file), 'utf8');
          const record = JSON.parse(data) as T;
          if (record.id !== id) throw new Error('id mismatch');
          records.push(record);
        } catch {
          // skip unreadable or invalid
        }
      }
      return records;
    },
    async get(id: string) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
      await ensureDir();
      const path = join(dir, `${id}.json`);
      try {
        const data = await fs.readFile(path, 'utf8');
        const record = JSON.parse(data) as T;
        if (record.id !== id) return undefined;
        return record;
      } catch {
        return undefined;
      }
    },
    async put(record: T) {
      const { id } = record;
      if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new Error('Invalid id');
      }
      await ensureDir();
      const path = join(dir, `${id}.json`);
      const tmpPath = `${path}.tmp`;
      const data = JSON.stringify(record, null, 0);
      await fs.writeFile(tmpPath, data, 'utf8');
      await fs.rename(tmpPath, path);
      return record;
    },
    async remove(id: string) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return false;
      await ensureDir();
      const path = join(dir, `${id}.json`);
      try {
        await fs.unlink(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}
