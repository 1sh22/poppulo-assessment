import { promises as fs } from "node:fs";
import path from "node:path";
import { put, del, list, head } from "@vercel/blob";

/**
 * Two-mode JSON key-value store.
 *
 * Production (VERCEL_BLOB_READ_WRITE_TOKEN set): Vercel Blob, public reads
 * with private random tokens — fine for our "documents.json" and BM25 indexes
 * since they contain only our own parsed text.
 *
 * Local dev: `./.data/` on disk. Same API.
 */

const LOCAL_DIR = path.join(process.cwd(), ".data");

function useBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export async function putJson<T>(key: string, value: T): Promise<string> {
  const body = JSON.stringify(value);
  if (useBlob()) {
    const res = await put(key, body, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return res.url;
  }
  const file = path.join(LOCAL_DIR, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
  return `file://${file}`;
}

export async function getJson<T>(key: string): Promise<T | null> {
  if (useBlob()) {
    try {
      const info = await head(key);
      const res = await fetch(info.url);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
  const file = path.join(LOCAL_DIR, key);
  try {
    const body = await fs.readFile(file, "utf8");
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

export async function deleteKey(key: string): Promise<void> {
  if (useBlob()) {
    try {
      await del(key);
    } catch {
      // ignore
    }
    return;
  }
  const file = path.join(LOCAL_DIR, key);
  try {
    await fs.unlink(file);
  } catch {
    // ignore
  }
}

export async function listKeys(prefix: string): Promise<string[]> {
  if (useBlob()) {
    const res = await list({ prefix });
    return res.blobs.map((b) => b.pathname);
  }
  const dir = path.join(LOCAL_DIR, prefix);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => `${prefix}${e.name}`);
  } catch {
    return [];
  }
}

export async function putBuffer(
  key: string,
  buffer: Uint8Array,
  contentType: string,
): Promise<string> {
  if (useBlob()) {
    const res = await put(key, Buffer.from(buffer), {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return res.url;
  }
  const file = path.join(LOCAL_DIR, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
  return `/api/blob/${key}`;
}

export async function getBuffer(key: string): Promise<Uint8Array | null> {
  if (useBlob()) {
    try {
      const info = await head(key);
      const res = await fetch(info.url);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  const file = path.join(LOCAL_DIR, key);
  try {
    const buf = await fs.readFile(file);
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}
