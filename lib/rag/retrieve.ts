import { embedOne } from "./embed";
import { searchDense } from "./qdrant";
import { getBm25 } from "./ingest";
import { getOpenAI } from "./openai";
import { reciprocalRankFusion } from "./rrf";
import type { Chunk, ChunkId, ScoredChunk } from "./types";

const RERANK_MODEL = process.env.OPENAI_RERANK_MODEL ?? "gpt-4o-mini";

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
  /** docIds referenced by this assistant turn's citations (empty for user turns). */
  citedDocIds?: string[];
  /** chunkIds of the retrieved passages that were shown for this assistant turn. */
  citedChunkIds?: string[];
}

export interface AvailableDoc {
  id: string;
  name: string;
}

export interface RetrieveOptions {
  topK?: number;
  dense?: boolean;
  sparse?: boolean;
  rerank?: boolean;
  expandQuery?: boolean;
  docIds?: string[];
  history?: HistoryTurn[];
  availableDocs?: AvailableDoc[];
}

const DEFAULTS: Required<
  Omit<RetrieveOptions, "docIds" | "history" | "availableDocs">
> = {
  topK: 6,
  dense: true,
  sparse: true,
  rerank: true,
  expandQuery: true,
};

/**
 * Condense the conversation into a standalone search query AND decide which
 * documents should be searched. Without this step, follow-ups like "tell me
 * more" retrieve unrelated content because "tell me more" on its own is
 * semantically empty. The rewriter is also given the doc list so it can pin
 * scope to the paper(s) previously being discussed.
 */
interface ConversationalRewrite {
  query: string;
  preferredDocIds?: string[];
  isFollowUp: boolean;
  /**
   * "rephrase" — user wants the same content in a different style (ELI5,
   *   shorter, table, etc.) → skip re-retrieval, reuse prior chunks.
   * "deepen"  — user wants more detail on the same topic → retrieve fresh,
   *   scoped to the same doc(s).
   * "new"     — a new topic or paper → full unconstrained retrieval.
   */
  intent: "rephrase" | "deepen" | "new";
}

async function conversationalRewrite(
  question: string,
  history: HistoryTurn[],
  availableDocs: AvailableDoc[],
): Promise<ConversationalRewrite> {
  const openai = getOpenAI();
  const historyTrimmed = history.slice(-6);
  const transcript = historyTrimmed
    .map((t) => {
      const cited =
        t.role === "assistant" && t.citedDocIds && t.citedDocIds.length > 0
          ? ` [cited docs: ${t.citedDocIds.join(", ")}]`
          : "";
      return `${t.role.toUpperCase()}: ${t.content.slice(0, 800)}${cited}`;
    })
    .join("\n");

  const docList = availableDocs
    .map((d) => `- ${d.id}  ${d.name}`)
    .join("\n");

  const res = await openai.chat.completions.create({
    model: RERANK_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You reformulate chat turns for retrieval over a PDF corpus.

Return JSON:
{
  "query": string,                // a self-contained search query for the user's latest turn
  "isFollowUp": boolean,          // true if the latest turn depends on prior context
  "preferredDocIds": string[],    // docIds to scope retrieval to; empty if unsure
  "intent": "rephrase" | "deepen" | "new"
}

Intent rules:
- "rephrase": the user wants the exact same content presented differently — simpler language (ELI5, "explain like I'm 5"), shorter, as a table, in bullet points, translated, etc. No new facts needed. Reuse prior passages.
- "deepen": the user wants more detail, examples, or follow-up facts on the same topic ("tell me more", "expand on X", "give an example"). Retrieve fresh, scoped to the same doc(s).
- "new": the user introduces a new topic, compares papers, or names a different entity. Full unconstrained retrieval.

Other rules:
- If isFollowUp, set preferredDocIds to the docs cited by the most recent assistant turn.
- Only use docIds that appear in the provided docs list. Never invent an id.
- Keep the query short (<= 30 words) and optimized for hybrid dense + BM25 search (include key technical terms).`,
      },
      {
        role: "user",
        content: `Available docs:\n${docList || "(none)"}\n\nConversation:\n${transcript || "(empty)"}\n\nLatest user turn: ${question}`,
      },
    ],
  });

  try {
    const raw = res.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(raw) as {
      query?: string;
      isFollowUp?: boolean;
      preferredDocIds?: string[];
      intent?: string;
    };
    const validIds = new Set(availableDocs.map((d) => d.id));
    const preferredDocIds = (parsed.preferredDocIds ?? []).filter((id) =>
      validIds.has(id),
    );
    const query =
      typeof parsed.query === "string" && parsed.query.trim().length > 0
        ? parsed.query.trim()
        : question;
    const intent: ConversationalRewrite["intent"] =
      parsed.intent === "rephrase" || parsed.intent === "deepen"
        ? parsed.intent
        : "new";
    return {
      query,
      isFollowUp: !!parsed.isFollowUp,
      preferredDocIds: preferredDocIds.length > 0 ? preferredDocIds : undefined,
      intent,
    };
  } catch {
    return { query: question, isFollowUp: false, intent: "new" };
  }
}

/**
 * Query expansion: rewrite the user's question as 3 short search queries that
 * paraphrase each other, to defeat vocabulary mismatch between the question
 * and the paper's terminology.
 */
async function expandQuery(question: string): Promise<string[]> {
  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: RERANK_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'Rewrite the user\'s question into 3 short search queries suitable for retrieval over a technical PDF. Return JSON {"queries": string[]} with 3 items; the first is the literal standalone rewrite, the other two are paraphrases using different terminology.',
      },
      { role: "user", content: question },
    ],
  });
  try {
    const content = res.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(content) as { queries?: string[] };
    const qs = (parsed.queries ?? []).filter(
      (q): q is string => typeof q === "string" && q.trim().length > 0,
    );
    if (qs.length === 0) return [question];
    return qs.slice(0, 3);
  } catch {
    return [question];
  }
}

/**
 * LLM re-rank: score each candidate 0-3 for relevance, return highest. Single
 * call, JSON output. Cheap compared to hosting a cross-encoder.
 */
async function llmRerank(
  question: string,
  candidates: ScoredChunk[],
  topK: number,
): Promise<ScoredChunk[]> {
  if (candidates.length <= topK) return candidates;
  const openai = getOpenAI();
  const numbered = candidates
    .map((c, i) => `[${i}] (p${c.chunk.page}) ${c.chunk.text.slice(0, 500)}`)
    .join("\n\n");
  const res = await openai.chat.completions.create({
    model: RERANK_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'Score each passage 0 (off-topic) to 3 (directly answers). Return JSON {"scores": [{"i": number, "s": number}]}. Be strict — reserve 3 for passages that contain the specific answer.',
      },
      {
        role: "user",
        content: `Question: ${question}\n\nPassages:\n${numbered}`,
      },
    ],
  });
  try {
    const content = res.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(content) as { scores?: { i: number; s: number }[] };
    const scored = new Map<number, number>();
    for (const { i, s } of parsed.scores ?? []) scored.set(i, s);
    return [...candidates]
      .map((c, i) => ({ c, s: scored.get(i) ?? 0 }))
      .sort((a, b) => b.s - a.s || b.c.score - a.c.score)
      .slice(0, topK)
      .map(({ c, s }) => ({ ...c, score: s, source: "hybrid" as const }));
  } catch {
    return candidates.slice(0, topK);
  }
}

export interface RetrieveOutcome {
  chunks: ScoredChunk[];
  /** The standalone, context-resolved query that was actually used for retrieval. */
  resolvedQuery: string;
  /** docIds the retrieval was scoped to (empty = all docs). */
  scopedTo: string[];
}

/** Drop passages whose doc no longer exists in the registry (avoids PDF 404s). */
function filterToAvailableDocs(
  chunks: ScoredChunk[],
  availableDocs: AvailableDoc[] | undefined,
): ScoredChunk[] {
  if (availableDocs === undefined) return chunks;
  const valid = new Set(availableDocs.map((d) => d.id));
  return chunks.filter((c) => valid.has(c.chunk.docId));
}

/**
 * Full pipeline: conversational rewrite → query expansion → hybrid (dense +
 * BM25) → RRF fusion → optional LLM rerank. Returns the re-ranked passages
 * along with the resolved query and doc scope so callers (and the UI) can
 * explain what was actually searched.
 */
export async function retrieveWithDetails(
  question: string,
  opts: RetrieveOptions = {},
): Promise<RetrieveOutcome> {
  const cfg = {
    topK: opts.topK ?? DEFAULTS.topK,
    dense: opts.dense ?? DEFAULTS.dense,
    sparse: opts.sparse ?? DEFAULTS.sparse,
    rerank: opts.rerank ?? DEFAULTS.rerank,
    expandQuery: opts.expandQuery ?? DEFAULTS.expandQuery,
  };

  let resolvedQuery = question;
  let scopedDocIds: string[] | undefined = opts.docIds;

  if (opts.history && opts.history.length > 0) {
    const rewrite = await conversationalRewrite(
      question,
      opts.history,
      opts.availableDocs ?? [],
    );
    resolvedQuery = rewrite.query;

    // For purely stylistic follow-ups (ELI5, "make it shorter", etc.) reuse
    // the previous turn's retrieved chunks rather than running a fresh
    // retrieval — the facts haven't changed, only the presentation.
    if (rewrite.intent === "rephrase") {
      const lastAssistant = [...opts.history].reverse().find(
        (t) => t.role === "assistant" && t.citedChunkIds && t.citedChunkIds.length > 0,
      );
      if (lastAssistant?.citedChunkIds) {
        const bm25 = await getBm25();
        const priorChunks: ScoredChunk[] = lastAssistant.citedChunkIds
          .map((id) => bm25.getChunk(id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined)
          .map((chunk) => ({ chunk, score: 1, source: "hybrid" as const }));
        const validPrior = filterToAvailableDocs(priorChunks, opts.availableDocs);
        if (validPrior.length > 0) {
          return {
            chunks: validPrior,
            resolvedQuery,
            scopedTo: scopedDocIds ?? [],
          };
        }
        // Stale chunk ids or deleted docs — run a fresh retrieval below.
      }
    }

    // Only apply follow-up scoping if the caller didn't already pin a scope.
    if (!scopedDocIds && rewrite.preferredDocIds && rewrite.isFollowUp) {
      scopedDocIds = rewrite.preferredDocIds;
    }
  }

  const queries = cfg.expandQuery ? await expandQuery(resolvedQuery) : [resolvedQuery];

  const denseHits = cfg.dense
    ? await Promise.all(
        queries.map(async (q) => {
          const v = await embedOne(q);
          return (await searchDense(v, 20, scopedDocIds)).map((h, rank) => ({
            id: h.chunkId,
            rank,
            score: h.score,
            chunk: h.chunk,
          }));
        }),
      )
    : [];

  let sparseHits: {
    id: ChunkId;
    rank: number;
    score: number;
    chunk: Chunk;
  }[][] = [];
  if (cfg.sparse) {
    const bm25 = await getBm25();
    sparseHits = queries.map((q) => {
      const hits = bm25.search(q, 20);
      return hits
        .map((h, rank) => {
          const chunk = bm25.getChunk(h.chunkId);
          if (!chunk) return null;
          if (scopedDocIds && !scopedDocIds.includes(chunk.docId)) return null;
          return { id: h.chunkId, rank, score: h.score, chunk };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    });
  }

  const chunkById = new Map<ChunkId, Chunk>();
  for (const list of [...denseHits, ...sparseHits]) {
    for (const h of list) chunkById.set(h.id, h.chunk);
  }

  const fused = reciprocalRankFusion(
    [...denseHits, ...sparseHits].map((list) =>
      list.map(({ id, rank }) => ({ id, rank })),
    ),
  );

  const baseTopK = cfg.rerank ? Math.max(cfg.topK * 3, 10) : cfg.topK;
  const candidates: ScoredChunk[] = fused.slice(0, baseTopK).map((f) => ({
    chunk: chunkById.get(f.id)!,
    score: f.score,
    source: "hybrid",
  }));

  const ranked = cfg.rerank
    ? await llmRerank(resolvedQuery, candidates, cfg.topK)
    : candidates.slice(0, cfg.topK);

  return {
    chunks: filterToAvailableDocs(ranked, opts.availableDocs),
    resolvedQuery,
    scopedTo: scopedDocIds ?? [],
  };
}

/** Backwards-compatible thin wrapper that returns only the chunks. */
export async function retrieve(
  question: string,
  opts: RetrieveOptions = {},
): Promise<ScoredChunk[]> {
  const out = await retrieveWithDetails(question, opts);
  return out.chunks;
}
