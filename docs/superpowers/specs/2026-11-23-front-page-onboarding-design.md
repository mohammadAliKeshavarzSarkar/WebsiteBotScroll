# WebsiteBotScroll Front Page and Onboarding Design

## Intent

Replace the placeholder with an understandable product experience. A new visitor should learn what WebsiteBotScroll does and why its evidence-first approach is trustworthy; an owner should be able to sign in, register a website, and understand what happens next.

## Goals

- Present WebsiteBotScroll as a read-only, evidence-based SEO monitoring product.
- Make the primary path obvious: understand the product, sign in, add a website, then prepare the first authorized crawl.
- Provide a protected `/sites` workspace backed by the existing tenant-scoped site repository.
- Validate and normalize user-entered origins before persistence.
- Work well on phone, tablet, and desktop with keyboard-visible focus and accessible semantics.

## Non-goals

- Starting or scheduling a crawl from the UI in this increment.
- Displaying invented audit results, scores, customers, or statistics.
- Public signup, billing, team management, REST/MCP integration, or strategic SEO recommendations.

## Experience

The public page uses a precise “evidence console” visual direction: deep ink surfaces, bright cyan and green accents, strong typography, restrained motion, and real product concepts instead of stock imagery. Its narrative moves from the product promise to the evidence workflow, collection boundaries, and a sign-in call to action.

The protected workspace opens with an onboarding panel. An owner enters a label and domain; the system accepts only absolute HTTP(S) origins, removes paths/query fragments, normalizes hostname casing, and saves the tenant-owned site. The new site appears in a responsive list with an honest `Ready for authorization` state. The UI explains that authorization and crawl controls come next.

The login page shares the same visual language and returns users to the protected workspace through the existing proxy behavior.

## Constraints

- Use the existing Next.js 16, React 19, Prisma, authentication store, and `SiteRepository`.
- Do not add a UI framework or new runtime dependency.
- Preserve tenant isolation and require an owner session inside the site-creation route, not only in middleware.
- Keep claims limited to capabilities already implemented and verified.
- Existing local-only owner authentication remains the entry point.

## Approaches

1. **Public marketing page only:** fastest, but leaves the primary domain action nonfunctional and repeats the current product gap.
2. **Dashboard only:** useful for the owner, but gives unauthenticated visitors no explanation or product context.
3. **Public landing plus protected onboarding workspace (selected):** creates a coherent journey and uses existing persistence/authentication without pretending crawl scheduling is finished.

## Builder decisions

- Server-render site lists and keep the create action in a small authenticated API route.
- Isolate origin parsing in a pure module so malformed domains are tested without database setup.
- Split presentation components from data-loading pages so UX markup can be rendered in fast unit tests.
- Use CSS-only visuals and icons to avoid external asset/licensing dependencies.

