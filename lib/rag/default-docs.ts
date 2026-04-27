import { ingestPdf } from "./ingest";
import { listDocuments } from "./documents";
import { fetchRemotePdf } from "./remote-pdf";

export const DEFAULT_DOCUMENTS = [
  {
    id: "builtin-attention-is-all-you-need",
    sourceKey: "attention-is-all-you-need",
    name: "Attention Is All You Need",
    url: "https://arxiv.org/pdf/1706.03762",
    matchers: [/attention is all you need/i],
  },
  {
    id: "builtin-deepseek-r1",
    sourceKey: "deepseek-r1",
    name: "DeepSeek-R1",
    url: "https://arxiv.org/pdf/2501.12948",
    matchers: [/deepseek-r1/i, /deepseek r1/i, /deepseek/i],
  },
] as const;

let ensurePromise: Promise<void> | null = null;

export async function ensureDefaultDocuments(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = doEnsureDefaultDocuments().finally(() => {
      ensurePromise = null;
    });
  }
  return ensurePromise;
}

export function isProtectedDefaultDocument(doc: {
  id: string;
  builtIn?: boolean;
  sourceKey?: string;
  name?: string;
}): boolean {
  if (doc.builtIn) return true;
  const docName = doc.name;
  return DEFAULT_DOCUMENTS.some((sample) => {
    if (doc.id === sample.id) return true;
    if (doc.sourceKey === sample.sourceKey) return true;
    return typeof docName === "string" && sample.matchers.some((re) => re.test(docName));
  });
}

async function doEnsureDefaultDocuments() {
  const docs = await listDocuments();

  for (const sample of DEFAULT_DOCUMENTS) {
    const alreadyPresent = docs.some(
      (doc) =>
        doc.id === sample.id ||
        doc.sourceKey === sample.sourceKey ||
        sample.matchers.some((re) => re.test(doc.name)),
    );
    if (alreadyPresent) continue;

    const fetched = await fetchRemotePdf(sample.url);
    await ingestPdf(sample.name, fetched.buffer, {
      id: sample.id,
      builtIn: true,
      sourceKey: sample.sourceKey,
    });
  }
}
