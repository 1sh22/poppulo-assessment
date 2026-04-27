import { describe, expect, it } from "vitest";
import { __internal } from "../lib/rag/remote-pdf";

describe("remote pdf guards", () => {
  it("detects private and loopback IPs", () => {
    expect(__internal.isPrivateIp("127.0.0.1")).toBe(true);
    expect(__internal.isPrivateIp("10.0.0.4")).toBe(true);
    expect(__internal.isPrivateIp("172.16.1.9")).toBe(true);
    expect(__internal.isPrivateIp("192.168.1.20")).toBe(true);
    expect(__internal.isPrivateIp("169.254.10.1")).toBe(true);
    expect(__internal.isPrivateIp("::1")).toBe(true);
    expect(__internal.isPrivateIp("fe80::1")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(__internal.isPrivateIp("8.8.8.8")).toBe(false);
    expect(__internal.isPrivateIp("1.1.1.1")).toBe(false);
    expect(__internal.isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });

  it("sniffs PDF headers", () => {
    expect(__internal.looksLikePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(__internal.looksLikePdf(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBe(false);
  });

  it("accepts only http and https URLs", () => {
    expect(__internal.normalizeUrl("https://example.com/file.pdf")).toBe(
      "https://example.com/file.pdf",
    );
    expect(() => __internal.normalizeUrl("file:///tmp/test.pdf")).toThrow(
      "Only http:// and https:// URLs are allowed.",
    );
  });
});
