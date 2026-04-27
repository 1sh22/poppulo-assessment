import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Blob uploads are not configured in this environment." },
      { status: 501 },
    );
  }

  try {
    const body = (await req.json()) as HandleUploadBody;
    if (body.type === "blob.generate-client-token") {
      assertAllowedUploadOrigin(req);
    }

    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("pdfs/") || !pathname.toLowerCase().endsWith(".pdf")) {
          throw new Error("Only PDF uploads are allowed.");
        }

        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload token generation failed.";
    console.error("Blob upload setup failed", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function assertAllowedUploadOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");

  if (!origin || !host) {
    throw new Error("Missing origin headers for upload request.");
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new Error("Invalid request origin.");
  }

  if (originUrl.host !== host) {
    throw new Error("Cross-origin upload requests are not allowed.");
  }
}
