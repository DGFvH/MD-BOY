# Launch kit

Ready-to-post text for sharing Hashlite. Post from your own accounts, one place at a time, and
stick around to answer questions: that is what makes a launch work. Everything here is honest
about what Hashlite is. Keep it that way: no fake accounts, no asking friends to upvote, no
posting the same text everywhere on the same day.

**Before posting:** make sure the latest version is live on hashlite.io, the Supabase email
settings are done (see the Cowork prompt).

## What to say in one line

> Hashlite: a free Markdown editor that opens straight into the editor. No sign-up. Paste
> Markdown (for example from an AI chat) and export it to PDF, Word, Google Docs or HTML.

## Show HN (news.ycombinator.com/submit)

Best on a weekday morning, US Eastern time. Answer every comment.

**Title:** `Show HN: Hashlite – a Markdown editor that opens straight into the editor, no sign-up`

**URL:** `https://hashlite.io`

**Text:**

> I kept pasting Markdown from AI chats and READMEs into editors that wanted an account first,
> so I built Hashlite. The home page is the editor: paste or type, see the preview, and export
> to PDF or HTML, or copy it as formatted text into Word or Google Docs. Tables, task lists,
> KaTeX math and Mermaid diagrams work. Nothing leaves your browser unless you choose to save
> to an account (then you get folders, search, version history and share links).
>
> A few details: `hashlite.io/#text=<url-encoded markdown>` opens text directly (the fragment
> never reaches a server), there are small tools such as CSV → Markdown table, and it installs
> as a PWA with a share target, so on a phone you can share text to it.
>
> Built with CodeMirror 6, markdown-it and Supabase. It is free and has no ads. Feedback very
> welcome, especially on what's missing for your Markdown workflow.

## Product Hunt

**Name:** Hashlite
**Tagline (≤60):** `Free Markdown editor: paste, preview, export. No sign-up.`
**Topics:** Productivity, Writing, Developer Tools, Artificial Intelligence
**Description:**

> Hashlite opens straight into a Markdown editor with live preview. Paste an AI answer, a README
> or your notes, and export it to PDF, HTML, Word or Google Docs, with tables, code, math and
> diagrams intact. No account needed. A free account adds folders, search, version history and
> share links.

**First comment (maker):** why you built it, what's free (everything), what's next, and a
question for feedback. **Gallery:** the home editor, the ⋯ export menu, the CSV → table tool and
a phone screenshot.

## Reddit

Read each subreddit's rules first. Many only allow self-promotion in a weekly thread, or ask
that most of your activity is not about your own project. Post as yourself, say you built it,
and ask for feedback rather than advertising.

- **r/Markdown**: "I made a free Markdown editor that needs no sign-up: feedback welcome".
  Mention the tables, math, Mermaid and the CSV → table tool.
- **r/ChatGPT, r/ClaudeAI and similar AI subreddits** (check the rules; often a weekly thread):
  "Tip: to get an AI answer into Word or Google Docs with tables intact, paste it into a
  Markdown editor and copy it as formatted text. I built a free one for this: hashlite.io".
  Lead with the tip; it is useful without the link.
- **r/productivity, r/notetaking**: only in their promotion threads.
- **r/webdev, r/SideProject, r/InternetIsBeautiful**: r/SideProject welcomes launches;
  r/InternetIsBeautiful has strict rules (no sign-up walls, which helps you here).

## Directories and lists

Submit once each, with the one-line description above.

- **AlternativeTo:** add Hashlite as an alternative to Dillinger, StackEdit, Typora, HackMD and
  Markdown Live Preview. Category: Markdown editor; license: free; platform: web.
- **SaaSHub, Slant, Product Hunt, BetaList, Uneed, There's An AI For That** (the AI-output use
  case), **Toolify**: the free listings.
- **Awesome lists on GitHub:** for example `mundimark/awesome-markdown` and
  `BubuAnabelas/awesome-markdown`. Open a pull request that adds one line in the right section,
  following each list's contribution rules.
- **PWA directories:** for example `appsco.pe` and `progressiveapp.store`.

## GitHub repository

- **Description:** `Free online Markdown editor with live preview. No sign-up. Export to PDF, HTML, Word and Google Docs.`
- **Website:** `https://hashlite.io`
- **Topics:** `markdown`, `markdown-editor`, `markdown-preview`, `codemirror`, `markdown-it`,
  `mermaid`, `katex`, `pwa`, `supabase`, `markdown-to-pdf`, `markdown-to-word`
- Consider renaming the repository from `MD-BOY` to `hashlite`, so the name people see matches
  the site. GitHub redirects the old address.

## Search engines

- **Google Search Console:** add `hashlite.io` (DNS verification at Porkbun), then submit
  `https://hashlite.io/sitemap.xml`.
- **Bing Webmaster Tools:** import the site from Search Console. The IndexNow action in
  `.github/workflows/indexnow.yml` then notifies Bing after every production deploy.
- Check both after a week: which queries show Hashlite, and which pages are indexed.

## After launch

- Reply to feedback quickly, and fix the small things people mention: nothing earns goodwill
  faster.
- Write a short "What's new" post on the same channels only when there is something real to
  say, a few weeks apart.
