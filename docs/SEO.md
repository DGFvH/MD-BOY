# SEO and GEO plan

How Hashmark gets found by search engines (SEO) and cited by AI answer engines such as
ChatGPT, Perplexity, Claude and Google AI Overviews (GEO).

## Goals

1. Rank for "online Markdown editor" style queries and send those visitors to `/app`.
2. Rank for Markdown syntax queries ("Markdown cheat sheet", "Markdown table") with `/guide`,
   and turn some of that traffic into users.
3. Be the tool AI assistants name, with correct facts, when someone asks for a free Markdown
   editor with live preview, math or diagrams.

## Pages, keywords and search intent

| Page | Primary keywords | Secondary | Intent |
| --- | --- | --- | --- |
| `/` | free online markdown editor, markdown editor with live preview | markdown editor online, markdown preview, markdown to pdf/html, mermaid / math markdown editor, self-hosted markdown editor | Transactional: find a tool and start writing |
| `/guide` | markdown cheat sheet | markdown syntax, markdown table, markdown task list, markdown footnote, markdown callout, markdown math | Informational: learn or look up syntax |
| `/learn` | learn markdown | markdown tutorial, markdown guide | Informational hub |
| `/learn/markdown-to-pdf` | markdown to pdf | convert markdown to pdf, pandoc markdown to pdf, vs code markdown pdf | Informational / task (HowTo) |
| `/learn/markdown-tables` | markdown table | markdown table alignment, escape pipe in markdown table, markdown table line break, merge cells | Informational |
| `/learn/markdown-math-and-diagrams` | markdown math, mermaid markdown | latex in markdown, katex markdown, mermaid flowchart / sequence / gantt, github math | Informational |
| `/learn/markdown-vs-rich-text` | markdown vs rich text | markdown vs word, markdown vs google docs, why use markdown | Informational / comparison |
| `/privacy` | hashmark privacy | — | Navigational / trust |
| `/app` | — (noindex) | — | The app itself |
| `/404.html` | — (noindex) | — | — |

## On-page checklist (implemented)

- [x] Unique `<title>` (≤ 60 chars) and meta description (140–160 chars) on every page.
- [x] Exactly one `<h1>` per page, with the primary keyword; logical `h2`/`h3` below it.
- [x] Canonical URL, Open Graph (`og:type`, `og:title`, `og:description`, `og:url`, `og:image`,
      `og:site_name`) and Twitter card (`summary_large_image`) tags.
- [x] Social card `public/og.png` (1200×630), icons `favicon.svg`, `icon-192.png`, `icon-512.png`,
      `apple-touch-icon.png`; `theme-color` `#4f46e5`.
- [x] Real app screenshot (`public/screenshot.webp`, 1440×900, ~65 KB) with descriptive alt text
      and explicit width/height (no layout shift).
- [x] JSON-LD: landing has `WebSite` + `SoftwareApplication` (free `Offer`, `featureList`,
      `screenshot`) + `FAQPage` that mirrors the visible FAQ word for word; guide has `TechArticle`;
      `/learn` has `CollectionPage` + `BreadcrumbList`; each article has `TechArticle` (PDF article:
      `HowTo` with the Hashmark steps) + `BreadcrumbList` (Home › Learn › Article).
- [x] Short copy: hero is H1 + one line + one button; FAQ answers are at most two sentences.
- [x] Learn articles open with a direct answer, use real copyable examples (`.pair` Markdown/result
      blocks), end with one "Try it in Hashmark" link and a Related list (other articles + `/guide`).
- [x] Internal links: header (Learn, Open editor) and footer (Learn, Cheat sheet, Privacy, Open
      editor) on every page; the guide links to the tables and math articles.
- [x] Semantic landmarks (`header`, `nav`, `main`, `footer`), skip link, visible focus, WCAG AA
      contrast, light/dark via `prefers-color-scheme`, no horizontal scroll at 360 px.
- [x] `404.html` has `<meta name="robots" content="noindex">`.

## Technical SEO (server)

- **`PUBLIC_URL`**: the pages contain the placeholder `%PUBLIC_URL%` in the canonical, `og:url`,
  `og:image`, `twitter:image` tags and in JSON-LD `url`/`image`/`screenshot` values. The server
  replaces it at request time (e.g. `https://hashmark.example`). Without `PUBLIC_URL` it deletes the
  `<link>`/`<meta>` lines containing it and replaces it with `""` inside JSON-LD, so no relative or
  wrong absolute URLs are published. **Set `PUBLIC_URL` in production** — canonical and social
  previews depend on it. Vite leaves the placeholder untouched in the build.
- **Canonical URLs**: `/`, `/guide`, `/privacy`, `/learn`, `/learn/<slug>` (no trailing slash, no `index.html`).
- **`robots.txt`**: allows the public pages, disallows `/api/`, `/app`, `/s/`, `/i/`, and points to the sitemap.
- **`sitemap.xml`**: `/`, `/guide`, `/privacy` and the `/learn` pages with absolute URLs from `PUBLIC_URL`
  (the `/learn` pages must be listed in `server/site.js` and added as Vite inputs).
- **`llms.txt`**: a plain-text summary of what Hashmark is, its features and key URLs, for LLM crawlers.
- **noindex** (`X-Robots-Tag: noindex` or meta): `/app`, shared documents `/s/…` (user content,
  may be private-ish), `/api/…`, uploaded images `/i/…`.
- **Real 404s**: unknown paths return status 404 with `404.html`, not the landing page (avoids soft 404s).
- **Compression and caching**: HTML/CSS/JS are pre-compressed (brotli + gzip); hashed assets are
  cached for a year, HTML is revalidated.

## GEO tactics

- **Answer-first copy**: the first sentence of the landing intro is a self-contained definition
  ("Hashmark is a free online Markdown editor with live preview…"). The guide and every `/learn`
  article open with a one- or two-sentence answer.
- **FAQ + `FAQPage` schema** with direct, factual answers to the questions people ask assistants.
- **Factual feature list**: only real features, stated plainly (same list in HTML and JSON-LD).
- **Crawlable static HTML**: all content is in the HTML; no JavaScript is needed to read it.
- **`llms.txt`** for LLM crawlers.
- **Consistent naming**: always "Hashmark", always described as "free online Markdown editor".
- No invented numbers: no user counts, ratings or reviews.

## Performance / Core Web Vitals

- Landing HTML ≈ 13 KB, shared CSS ≈ 20 KB (≈ 4 KB brotli). No web fonts, no
  third-party requests, no JavaScript on `/`; the guide loads a tiny module for copy buttons.
- LCP: the hero heading or the screenshot (`fetchpriority="high"`, WebP, explicit dimensions).
- CLS ≈ 0: every image has width/height; no late-injected content.
- INP: effectively no JavaScript on the public pages.
- The heavy editor bundle only loads on `/app`.

## Off-site checklist (later)

- [ ] Google Search Console: verify the domain, submit `sitemap.xml`, request indexing of `/` and `/guide`.
- [ ] Bing Webmaster Tools (also feeds ChatGPT search and DuckDuckGo); enable IndexNow.
- [ ] List on AlternativeTo (as alternative to StackEdit, Dillinger, HackMD, Typora).
- [ ] Launch on Product Hunt; post on Hacker News (Show HN) and relevant subreddits.
- [ ] GitHub README: one-line definition, screenshot, link to the hosted site; repo topics
      (`markdown-editor`, `markdown`, `self-hosted`).
- [ ] Submit to awesome lists (awesome-markdown, awesome-selfhosted).

## Content calendar

Next `/learn` articles, one every two weeks. Same format: answer first, 400–800 words, real
examples, `TechArticle` (or `HowTo`) + `BreadcrumbList`, Related list.

| # | Article | Target query |
| --- | --- | --- |
| 1 | How to write a good README in Markdown | readme markdown template |
| 2 | Markdown links and images: every syntax | markdown link / markdown image size |
| 3 | Code blocks and syntax highlighting in Markdown | markdown code block |
| 4 | Markdown callouts (GitHub alerts) | github markdown note / warning |
| 5 | Markdown task lists and checklists | markdown checkbox |
| 6 | Convert Word or Google Docs to Markdown | docx to markdown |

## How to measure

- **Search Console**: impressions, clicks and average position per query and page; watch
  "markdown cheat sheet" and "online markdown editor" queries; check the Page indexing and
  Enhancements (FAQ, structured data) reports.
- **Bing Webmaster Tools**: same, plus AI/Copilot referral data where available.
- **AI visibility**: every month, ask ChatGPT, Perplexity, Gemini and Claude "free online Markdown
  editor with live preview / math / diagrams" and note whether and how Hashmark is described.
- **Sign-ups**: new accounts per week, from server data.
- **Optional analytics**: only a privacy-friendly, cookieless tool (e.g. Plausible, Umami or
  GoatCounter, self-hosted). Adding one requires updating `/privacy`, which currently says there
  is no analytics.
