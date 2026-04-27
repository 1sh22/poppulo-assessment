/**
 * Reciprocal Rank Fusion.
 * Cormack, Clarke & Buettcher (2009) — combines ranked lists without needing
 * score calibration, which is perfect for fusing dense (cosine) and sparse
 * (BM25) retrievers whose scores live in different ranges.
 */
export function reciprocalRankFusion<T extends string>(
  rankings: { id: T; rank: number }[][],
  k = 60,
): { id: T; score: number }[] {
  const scores = new Map<T, number>();
  for (const ranking of rankings) {
    for (const { id, rank } of ranking) {
      const add = 1 / (k + rank);
      scores.set(id, (scores.get(id) || 0) + add);
    }
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}
