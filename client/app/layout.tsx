import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "cider.build — macOS sandboxes for AI agents",
  description:
    "Spin up a remote Mac, build and run iOS apps, and ship without needing hardware on your desk.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} antialiased`}>{children}</body>
    </html>
  );
}
