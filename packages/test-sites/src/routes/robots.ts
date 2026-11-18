export const robotsFixtures = {
  restrictive: "User-agent: WebsiteBotScroll\nDisallow: /private\nAllow: /private/public\nSitemap: /sitemap-index.xml\n",
  permissive: "User-agent: *\nDisallow:\n",
  oversized: `User-agent: *\nDisallow: /\n${"x".repeat(600_000)}`,
} as const;
