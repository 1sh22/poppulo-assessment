#!/usr/bin/env tsx
/* eslint-disable no-console */
import { config as loadEnv } from "dotenv";
// Match Next.js precedence: .env.local overrides .env.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { ingestPdf } from "../lib/rag/ingest";

const SAMPLES = [
  {
    url: "https://arxiv.org/pdf/1706.03762",
    name: "Attention Is All You Need (arXiv 1706.03762).pdf",
  },
  {
    url: "https://arxiv.org/pdf/2501.12948",
    name: "DeepSeek-R1 (arXiv 2501.12948).pdf",
  },
];

async function main() {
  for (const sample of SAMPLES) {
    console.log(`\nFetching ${sample.url}…`);
    const res = await fetch(sample.url);
    if (!res.ok) {
      console.error(`  Failed: ${res.status}`);
      continue;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    console.log(`  Downloaded ${(buf.byteLength / 1024).toFixed(1)} KB`);

    const { doc, chunks } = await ingestPdf(sample.name, buf, {
      onProgress: (stage, done, total) => {
        if (stage === "embed" && done % 64 !== 0 && done !== total) return;
        process.stdout.write(`\r  ${stage}: ${done}/${total}   `);
      },
    });
    console.log();
    console.log(
      `  ✓ ${doc.name} — ${doc.pageCount} pages, ${chunks.length} chunks`,
    );
  }
  console.log("\nSeed complete.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
