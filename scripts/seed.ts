#!/usr/bin/env tsx
/* eslint-disable no-console */
import { config as loadEnv } from "dotenv";
// Match Next.js precedence: .env.local overrides .env.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { ingestPdf } from "../lib/rag/ingest";
import { DEFAULT_DOCUMENTS } from "../lib/rag/default-docs";

async function main() {
  for (const sample of DEFAULT_DOCUMENTS) {
    console.log(`\nFetching ${sample.url}…`);
    const res = await fetch(sample.url);
    if (!res.ok) {
      console.error(`  Failed: ${res.status}`);
      continue;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    console.log(`  Downloaded ${(buf.byteLength / 1024).toFixed(1)} KB`);

    const { doc, chunks } = await ingestPdf(sample.name, buf, {
      id: sample.id,
      builtIn: true,
      sourceKey: sample.sourceKey,
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
