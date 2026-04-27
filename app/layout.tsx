import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
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
