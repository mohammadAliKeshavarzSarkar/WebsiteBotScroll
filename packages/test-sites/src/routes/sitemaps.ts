export const sitemapFixtures = {
  urlset: "<urlset><url><loc>https://example.test/a</loc></url></urlset>",
  index: "<sitemapindex><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>",
  entityBomb: "<!DOCTYPE x [<!ENTITY a 'xxxxxxxx'>]><urlset><url><loc>&a;</loc></url></urlset>",
  deepIndex(next: number): string {
    return `<sitemapindex><sitemap><loc>https://example.test/sitemap-${next}.xml</loc></sitemap></sitemapindex>`;
  },
} as const;
