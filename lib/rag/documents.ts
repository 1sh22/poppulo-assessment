import { getJson, putJson, deleteKey } from "./storage";
import type { DocumentMeta, DocumentId } from "./types";

const LEGACY_REGISTRY_KEY = "registry/documents.json";
const REGISTRY_PREFIX = "registry/documents/";

export async function listDocuments(): Promise<DocumentMeta[]> {
  const docs = await loadAllDocuments();
  return docs.sort((a, b) => {
    if (!!a.builtIn !== !!b.builtIn) return a.builtIn ? -1 : 1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export async function getDocument(id: DocumentId): Promise<DocumentMeta | null> {
  const docs = await listDocuments();
  return docs.find((d) => d.id === id) ?? null;
}

export async function upsertDocument(doc: DocumentMeta): Promise<void> {
  await putJson(documentKey(doc.id), doc);
}

export async function removeDocument(id: DocumentId): Promise<void> {
  const legacyDocs = (await getJson<DocumentMeta[]>(LEGACY_REGISTRY_KEY)) ?? [];
  const nextLegacyDocs = legacyDocs.filter((d) => d.id !== id);
  if (legacyDocs.length !== nextLegacyDocs.length) {
    await putJson(LEGACY_REGISTRY_KEY, nextLegacyDocs);
  }
  await deleteKey(documentKey(id));
  await deleteKey(`pdfs/${id}.pdf`);
}

async function loadAllDocuments(): Promise<DocumentMeta[]> {
  const [legacyDocs, storedDocs] = await Promise.all([
    getJson<DocumentMeta[]>(LEGACY_REGISTRY_KEY),
    loadDocumentFiles(),
  ]);

  const byId = new Map<string, DocumentMeta>();
  for (const doc of legacyDocs ?? []) {
    byId.set(doc.id, doc);
  }
  for (const doc of storedDocs) {
    byId.set(doc.id, doc);
  }
  return Array.from(byId.values());
}

async function loadDocumentFiles(): Promise<DocumentMeta[]> {
  const { listKeys } = await import("./storage");
  const keys = await listKeys(REGISTRY_PREFIX);
  const docs = await Promise.all(keys.map((key) => getJson<DocumentMeta>(key)));
  return docs.filter((doc): doc is DocumentMeta => !!doc);
}

function documentKey(id: DocumentId): string {
  return `${REGISTRY_PREFIX}${encodeURIComponent(id)}.json`;
}
