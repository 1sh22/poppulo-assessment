import { getOpenAI } from "./openai";
import type { Citation, ScoredChunk } from "./types";
import type { HistoryTurn } from "./retrieve";

const ANSWER_MODEL = process.env.OPENAI_ANSWER_MODEL ?? "gpt-4o-mini";

export interface GenerateOptions {
  model?: string;
  history?: HistoryTurn[];
}

const SYSTEM = `You are a careful research assistant answering questions from the supplied PDF passages.

Answer style:
- Use plain, simple language — write like you're explaining to a smart friend, not writing a paper. If you must use a technical term, briefly explain it in parentheses.
- Format the answer as a Markdown bullet list. Each bullet should be one clear idea, one or two sentences max.
- Aim for 3–6 bullets for most questions. For a "what is X" or single-fact question, 1–2 bullets is fine. For a summary or multi-part question, expand as needed — but keep each bullet focused.
- Don't restate the question. Don't add a closing paragraph. Let the bullets be the answer.
- If the conversation history makes it clear which paper the user is asking about, stay on that paper. Don't pull in citations from other papers unless the user explicitly asks to compare.

Grounding and citations:
- EVERY bullet must end with at least one citation marker like [1] or [2,3] pointing to the passage indices supplied to you.
- Ground every factual claim in the provided passages. If the passages don't contain enough information, say so in a single bullet and stop — don't guess.
- For each citation, include a short (<=25 word) quote taken verbatim from the passage.
- Never cite a passage you didn't use. Never invent passages.

Return JSON:
{
  "answer": string,                                 // Markdown bullet list, every bullet ends with [n] citation(s)
  "citations": [ { "index": number, "quote": string } ]
}

"index" is 1-based into the passage list you were given. "quote" must be an exact substring of that passage.`;

// Plain-text streaming system prompt — no JSON wrapper, cites inline, mentions page numbers.
const SYSTEM_STREAM = `You are a careful research assistant answering questions from the supplied PDF passages.

Answer style:
- Use plain, simple language. If you must use a technical term, briefly explain it in parentheses.
- Format the answer as a Markdown bullet list. Every line of the answer MUST start with "- " (a hyphen and a space). Each bullet is one clear idea, 1–2 sentences max.
- Aim for 3–6 bullets. For single-fact questions, 1–2 bullets is fine.
- Do NOT restate the question. Do NOT add a closing paragraph or any text outside the bullet list.
- When citing a passage, naturally include the page number in the bullet text, e.g. "On page 4, the authors explain…" or "…as described on page 7."
- If the conversation history makes it clear which paper the user is asking about, stay on that paper unless asked to compare.

Citations (required):
- EVERY bullet MUST end with a citation marker that is a real number in square brackets, like [1] or [2,3].
- The number is the 1-based index of the passage in the list provided to you below. NEVER write the literal placeholder "[n]" — always substitute an actual digit such as [1], [2], [3].
- Place the citation at the very end of the bullet, immediately before the line break.
- Never cite a passage you didn't use. Never invent passages.
- Output Markdown text only — no JSON, no headings, no preamble.

Example of the exact format expected:
- The Transformer encoder uses self-attention layers, which let each token attend to every other token in the sequence (page 3) [1].
- It also stacks position-wise feed-forward networks on top of attention, applied identically at each position [2].
- Residual connections and layer normalization wrap each sub-layer, which helps training deeper stacks (page 4) [1,3].`;

export interface GenerateResult {
  answer: string;
  citations: Citation[];
  model: string;
}

function historyToChatMessages(
  history: HistoryTurn[],
): { role: "user" | "assistant"; content: string }[] {
  // Keep only the last 3 turns (6 messages) to cap token cost. Strip citation
  // markers from prior assistant turns so the model doesn't get confused
  // about citation indices from previous passages.
  return history.slice(-6).map((t) => ({
    role: t.role,
    content:
      t.role === "assistant"
        ? t.content.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "").slice(0, 1500)
        : t.content.slice(0, 1000),
  }));
}

export async function generateAnswer(
  question: string,
  passages: ScoredChunk[],
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const model = opts.model ?? ANSWER_MODEL;
  if (passages.length === 0) {
    return {
      answer:
        "I couldn't find anything relevant in the uploaded documents. Try rephrasing, or upload a PDF that covers this topic.",
      citations: [],
      model,
    };
  }

  const passageText = passages
    .map(
      (p, i) =>
        `[${i + 1}] (${p.chunk.docName}, p.${p.chunk.page}) ${p.chunk.text}`,
    )
    .join("\n\n");

  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      ...historyToChatMessages(opts.history ?? []),
      {
        role: "user",
        content: `Question: ${question}\n\nPassages:\n${passageText}`,
      },
    ],
  });

  const raw = res.choices[0].message.content ?? "{}";
  let parsed: { answer?: string; citations?: { index: number; quote: string }[] } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      answer:
        "The model returned a malformed response. Please retry — if this persists, check the logs.",
      citations: [],
      model,
    };
  }

  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  const rawCitations = Array.isArray(parsed.citations) ? parsed.citations : [];
  const citations: Citation[] = [];

  for (const c of rawCitations) {
    if (typeof c.index !== "number" || typeof c.quote !== "string") continue;
    const idx = c.index - 1;
    if (idx < 0 || idx >= passages.length) continue;
    const passage = passages[idx];
    const quote = c.quote.trim();
    if (!quote) continue;
    if (!looseContains(passage.chunk.text, quote)) continue;
    citations.push({
      chunkId: passage.chunk.id,
      docId: passage.chunk.docId,
      docName: passage.chunk.docName,
      page: passage.chunk.page,
      paragraphIdx: passage.chunk.paragraphIdx,
      quote,
      citationNumber: c.index,
    });
  }

  return {
    answer:
      answer ||
      "The model did not produce an answer. Try rephrasing the question.",
    citations,
    model,
  };
}

/**
 * Derives citations from the accumulated streaming answer text by parsing [n]
 * markers and mapping them to the passage list. Uses the first meaningful
 * sentence of each passage as the highlight quote.
 */
export function deriveCitationsFromText(
  text: string,
  passages: ScoredChunk[],
): Citation[] {
  const seen = new Map<number, Citation>();
  const regex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    for (const numStr of m[1].split(",")) {
      const n = parseInt(numStr.trim(), 10);
      if (seen.has(n)) continue;
      const idx = n - 1;
      if (idx < 0 || idx >= passages.length) continue;
      const passage = passages[idx];
      // Use the first sentence with enough content as the highlight quote.
      const quote =
        passage.chunk.text
          .split(/(?<=[.!?])\s+/)
          .find((s) => s.trim().length > 20)
          ?.trim() ?? passage.chunk.text.slice(0, 120).trim();
      seen.set(n, {
        chunkId: passage.chunk.id,
        docId: passage.chunk.docId,
        docName: passage.chunk.docName,
        page: passage.chunk.page,
        paragraphIdx: passage.chunk.paragraphIdx,
        quote,
        citationNumber: n,
      });
    }
  }
  return Array.from(seen.values());
}

/**
 * Streams the answer as plain Markdown text deltas. Returns the text stream
 * and a promise that resolves with derived citations once streaming completes.
 */
export function generateAnswerStreaming(
  question: string,
  passages: ScoredChunk[],
  opts: GenerateOptions = {},
): {
  textStream: AsyncGenerator<string>;
  citationsPromise: Promise<Citation[]>;
  model: string;
} {
  const model = opts.model ?? ANSWER_MODEL;

  if (passages.length === 0) {
    const msg =
      "I couldn't find anything relevant in the uploaded documents. Try rephrasing, or upload a PDF that covers this topic.";
    async function* emptyStream() {
      yield msg;
    }
    return {
      textStream: emptyStream(),
      citationsPromise: Promise.resolve([]),
      model,
    };
  }

  const passageText = passages
    .map(
      (p, i) =>
        `[${i + 1}] (${p.chunk.docName}, p.${p.chunk.page}) ${p.chunk.text}`,
    )
    .join("\n\n");

  const openai = getOpenAI();
  const historyMessages = historyToChatMessages(opts.history ?? []);

  let resolveCitations!: (c: Citation[]) => void;
  const citationsPromise = new Promise<Citation[]>((r) => {
    resolveCitations = r;
  });

  const textStream = (async function* () {
    const stream = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_STREAM },
        ...historyMessages,
        {
          role: "user",
          content: `Question: ${question}\n\nPassages:\n${passageText}`,
        },
      ],
    });

    let accText = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        accText += delta;
        yield delta;
      }
    }
    resolveCitations(deriveCitationsFromText(accText, passages));
  })();

  return { textStream, citationsPromise, model };
}

/**
 * Tolerant substring check: normalizes whitespace and punctuation so
 * model-produced quotes survive light reformatting without being rejected as
 * hallucinations, while still catching genuinely fabricated ones.
 */
export function looseContains(haystack: string, needle: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s-]/g, "").trim();
  const h = norm(haystack);
  const n = norm(needle);
  if (n.length < 4) return false;
  if (h.includes(n)) return true;
  const ngrams = new Set<string>();
  for (let i = 0; i <= h.length - 6; i++) ngrams.add(h.slice(i, i + 6));
  let hits = 0;
  for (let i = 0; i <= n.length - 6; i++) {
    if (ngrams.has(n.slice(i, i + 6))) hits++;
  }
  return hits / Math.max(1, n.length - 5) > 0.6;
}
