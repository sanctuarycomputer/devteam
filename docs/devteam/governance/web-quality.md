# Web quality

What every web UI must meet: accessibility, performance, consent, and, for public pages, search and answer engines. It builds on `code-style.md` §13 (`L-FE-1`, `L-FE-2`) and adds what those don't say.

Law and Doctrine mean what they mean in `code-style.md` §0; a Law is enforced once its gate is commissioned (the gate table below counts as rows of `quality.md` §2), and review holds it until then. A **public page** is one a visitor reaches without signing in; §4 and §5 apply only to those.

## 1. Accessibility

- **`L-WEB-1` WCAG 2.2 AA.** axe runs with zero violations in CI (`L-FE-1`), on the WCAG 2.2 A and AA rules (axe tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`). An exception cites `L-FE-1`. axe catches a minority of failures, so every ticket that adds or changes a user flow also gets two more passes. The keyboard pass is a Playwright test that goes through the whole flow by keyboard alone and asserts the focus order and a visible focus at each step. The screen-reader pass (VoiceOver or NVDA) needs a person: the supervisor collects the new flows of a release into one owner-action question before it ships, and the answer records what was found. Gate: axe and the keyboard test (test gate); the screen-reader pass is the owner action.

- **`L-WEB-3` every shared UI component has a Storybook story.** A component more than one page uses (the design system's, a project's shared `components/`) has at least one story in Storybook, showing its states. Gate: a check that every file in the shared components folder has a matching `*.stories.*` file (lint gate).

## 2. Performance

- **`L-WEB-2` Lighthouse 90 in all four categories, on mobile.** Lighthouse CI (`L-FE-2`) runs the mobile preset and fails under 0.9 in performance, accessibility, best practices and SEO (SEO on public pages only). Where `code-style.md` sets a stricter number for a category or a metric (accessibility 1.0, TBT 200 ms in its default budgets), that number wins. The lab metrics fail at LCP 2.5 s and CLS 0.1. An exception cites `L-FE-2`. Gate: Lighthouse CI.
- **Field Core Web Vitals** are watched in production, at the 75th percentile: LCP under 2.5 s, CLS under 0.1, INP under 200 ms. INP exists only in the field, so CI can't hold it (`L-FE-2`). Sentry's browser SDK reports them, with an alert when one crosses its line. Doctrine.

## 3. Consent

- **`L-WEB-4` trackers wait for consent.** Analytics and ad tags run under Google Consent Mode v2, defaulting to denied where the visitor's law asks for consent (the EU, the EEA and the UK), with a consent banner shown there. Every tracker, and every server-side conversion, sends only what the visitor's consent allows, read in one place, never at a call site (`code-style.md`'s consent rule for the bus and its vendors, where it states one). Gate: an end-to-end test that, with consent denied, the page fires no analytics or ad request beyond Consent Mode's own cookieless pings (test gate).

## 4. Search (public pages)

- **`L-SEO-1` every public page names itself.** A unique `<title>`, a meta description, a canonical URL, Open Graph and Twitter card tags, and an OG image generated from the page's data (Next.js `opengraph-image`, or the stack's image endpoint). Gate: a test visits every URL in the sitemap and asserts each tag (test gate).
- **`L-SEO-2` a sitemap and a robots file.** `sitemap.xml` is generated from the routes and the content, and `robots.txt` points at it. Production allows crawling; a preview disallows it (`operations.md` `L-ENV-2`). Gate: a request test (test gate).
- **Doctrine — JSON-LD on content pages.** schema.org `Organization`, `Article`, `Product`, `BreadcrumbList` as each page fits, built from the page's own data, checked by a test that parses it.
- **`L-SEO-3` a changed URL never 404s.** When a public URL moves or goes, a permanent (301) redirect to its nearest live page goes into the checked-in redirect map (the framework's redirects config, or its routes). Gate: a test that every source in the map answers 301 to a page that answers 200 (test gate). That nobody removed a URL without an entry is review's, unless the project adds a check that compares the sitemap with `main`'s.

## 5. Answer and generative engines (public pages)

- **`L-AEO-1` readable without JavaScript.** Public content is server-rendered: the page's heading and main text are in the HTML the server sends. Gate: a test fetches each sitemap URL with no JavaScript and finds its `<h1>`, and a `<main>` holding at least 90% of the words the page's `<main>` shows once rendered in a browser (test gate).
- **Doctrine — written to be quoted.** One `<h1>`, headings in order, each section opening with the direct answer to the question it is about, then the detail. Structured data as in §4.
- **`L-AEO-2` an `llms.txt`.** `/llms.txt` follows the llmstxt.org format (an H1 with the site's name, a one-paragraph summary, then lists of links to the pages that matter), generated from the same source as the sitemap. Gate: a request test (test gate).
- **`L-AEO-3` robots.txt states a policy on AI crawlers.** It names each known AI crawler and training token (`GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`) with an explicit `Allow` or `Disallow`, so the policy is a decision, not an omission. The default is `Allow` for every one: the supervisor decides it, logged as an act the owner can correct, and a project whose owner says otherwise records their rule in the `robots.txt` itself, in a comment. Gate: a request test that every name on the list appears (test gate).

## Gates

| Gate | Fails on | Law |
|---|---|---|
| test | an axe violation on a WCAG 2.2 A or AA rule | `L-WEB-1` |
| lint | a shared component with no story | `L-WEB-3` |
| test | a tracker or conversion firing with consent denied | `L-WEB-4` |
| lighthouse | a category under 0.9 on mobile (or `code-style.md`'s stricter number), LCP over 2.5 s, CLS over 0.1, or a TBT over `code-style.md`'s budget | `L-WEB-2` |
| test | a sitemap URL missing a title, description, canonical, OG or Twitter tag | `L-SEO-1` |
| test | a missing or wrong `sitemap.xml` or `robots.txt` | `L-SEO-2` |
| test | a redirect map entry that doesn't answer 301 to a 200 | `L-SEO-3` |
| test | a public page whose heading or main text needs JavaScript | `L-AEO-1` |
| test | a missing `llms.txt` | `L-AEO-2` |
| test | an AI crawler on the list with no stated rule | `L-AEO-3` |
