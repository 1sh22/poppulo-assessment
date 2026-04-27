import { getJson, putJson, deleteKey } from "./storage";
import type { DocumentMeta, DocumentId } from "./types";

const REGISTRY_KEY = "registry/documents.json";

export async function listDocuments(): Promise<DocumentMeta[]> {
  const docs = (await getJson<DocumentMeta[]>(REGISTRY_KEY)) ?? [];
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
  const docs = await listDocuments();
  const idx = docs.findIndex((d) => d.id === doc.id);
  if (idx >= 0) docs[idx] = doc;
  else docs.push(doc);
  await putJson(REGISTRY_KEY, docs);
}

export async function removeDocument(id: DocumentId): Promise<void> {
  const docs = await listDocuments();
  await putJson(REGISTRY_KEY, docs.filter((d) => d.id !== id));
  await deleteKey(`pdfs/${id}.pdf`);
}
