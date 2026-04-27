import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF RAG",
  description: "Ask questions of your PDFs, with source-cited answers.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-screen bg-background text-foreground font-sans">
        {children}
        <p className="pointer-events-none fixed bottom-3 right-4 z-10 text-xs text-muted-foreground">
          Built by Ishaan Choubey
        </p>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
