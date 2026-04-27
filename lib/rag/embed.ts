import { getOpenAI } from "./openai";

const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small";
const EMBED_DIM = 1536;
const BATCH_SIZE = 64;
const MAX_RETRIES = 4;

export function embedDimension(): number {
  return EMBED_DIM;
}

export function embedModel(): string {
  return EMBED_MODEL;
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const openai = getOpenAI();
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < MAX_RETRIES) {
    try {
      const res = await openai.embeddings.create({
        model: EMBED_MODEL,
        input: inputs,
      });
      return res.data.map((d) => d.embedding as number[]);
    } catch (err) {
      lastErr = err;
      const delay = 400 * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
  throw new Error(
    `Embedding failed after ${MAX_RETRIES} retries: ${(lastErr as Error)?.message ?? "unknown"}`,
  );
}

export async function embedMany(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE);
    const vecs = await embedBatch(slice);
    out.push(...vecs);
    onProgress?.(out.length, texts.length);
  }
  return out;
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}
