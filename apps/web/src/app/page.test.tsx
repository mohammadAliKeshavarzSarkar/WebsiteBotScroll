import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

Object.assign(globalThis, { React });

describe("public product page", () => {
  it("guides a visitor from the evidence promise to the protected workspace", () => {
    const html = renderToStaticMarkup(<HomePage />);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    expect(text).toContain("SEO monitoring you can prove.");
    expect(text).toContain("Collect read-only evidence");
    expect(text).toContain("No rankings are manipulated");
    expect(html).toContain('href="/sites"');
    expect(html).toContain("Open your workspace");
  });
});
