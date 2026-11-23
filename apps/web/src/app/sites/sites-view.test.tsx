import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SitesView } from "./sites-view";

Object.assign(globalThis, { React });
const render = (props: Parameters<typeof SitesView>[0]) => renderToStaticMarkup(<SitesView {...props} />);

describe("owner sites workspace", () => {
  it("shows an accessible add-site form and useful empty state", () => {
    const html = render({ sites: [] });
    expect(html).toContain("Add your first website");
    expect(html).toContain('action="/api/sites"');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="origin"');
    expect(html).toContain("Authorization and crawl controls come next");
  });

  it("lists registered tenant sites without fabricating audit results", () => {
    const html = render({ sites: [{ id: "site-1", name: "Main shop", origin: "https://example.com" }] });
    expect(html).toContain("Main shop");
    expect(html).toContain("https://example.com");
    expect(html).toContain("Ready for authorization");
    expect(html).not.toContain("SEO score");
  });

  it("preserves submitted values and exposes validation feedback", () => {
    const html = render({ sites: [], feedback: { error: "Enter an absolute HTTP(S) URL", name: "Docs", origin: "docs.example.com" } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Enter an absolute HTTP(S) URL");
    expect(html).toContain('value="Docs"');
    expect(html).toContain('value="docs.example.com"');
  });

  it("confirms a newly registered website", () => {
    const html = render({ sites: [], feedback: { created: true } });
    expect(html).toContain('role="status"');
    expect(html).toContain("Website registered");
  });
});
