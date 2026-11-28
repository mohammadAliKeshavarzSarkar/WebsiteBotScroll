import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "WebsiteBotScroll — Evidence-first SEO monitoring",
  description: "Collect, preserve, and review trustworthy technical SEO evidence without changing the website you monitor.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="app-html">
      <body>{children}</body>
    </html>
  );
}
