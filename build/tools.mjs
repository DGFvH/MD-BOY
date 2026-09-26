// The free tool pages (/markdown-to-word, /mermaid-editor, …). Each is the home page editor
// with its own starting text and main button, plus a short how-to and FAQ. Pages are written
// by build/gen-pages.mjs (npm run gen:pages); edit this file, then run it.

const REPORT = `# Quarterly report

## Summary

Revenue grew **12%** this quarter, driven by the new *self-serve* plan.

- Three new enterprise customers
- Support response time down to 4 hours
- [x] Launched the mobile app
- [ ] Localise the help centre

| Region | Revenue | Change |
| ------ | ------: | -----: |
| Europe | €1.2M   | +15%   |
| US     | $2.4M   | +9%    |

> [!NOTE]
> Figures are unaudited.

\`\`\`python
growth = (this_quarter - last_quarter) / last_quarter
\`\`\`
`;

export const TOOLS = [
  {
    slug: 'markdown-to-word',
    name: 'Markdown to Word',
    h1: 'Markdown to Word converter',
    title: 'Markdown to Word Converter – Free, Online, No Sign-up | Hashlite',
    description: 'Convert Markdown to Word for free. Paste Markdown, check the preview, and copy it into Word with headings, lists, tables and code intact. No sign-up.',
    action: 'copy',
    sample: REPORT,
    intro: 'Paste Markdown on the left and it appears formatted on the right. Click <strong>Copy for Word / Docs</strong>, then paste into Microsoft Word: headings, bold and italic, lists, tables, links and code blocks keep their formatting.',
    steps: [
      ['Paste your Markdown', 'Paste it into the editor above, or open a .md file from the ⋯ menu. The preview shows what Word will get.'],
      ['Click Copy for Word / Docs', 'The formatted document goes to your clipboard, with the Markdown as a plain-text fallback.'],
      ['Paste into Word', 'Press Ctrl+V (⌘V on a Mac) in Word. Headings become Word headings, so the navigation pane and table of contents work.'],
    ],
    faq: [
      ['Do headings become real Word headings?', 'Yes. # and ## become Heading 1 and Heading 2 in Word, so you can build a table of contents from them.'],
      ['Do tables survive?', 'Yes. Markdown tables paste as Word tables, including column alignment.'],
      ['Can I get a .docx file?', 'Paste into a new Word document and save it as .docx. For a file without Word, download HTML or save as PDF from the ⋯ menu.'],
      ['Is my text uploaded?', 'No. Converting happens in your browser. Nothing is sent anywhere unless you choose Save to keep it in an account.'],
    ],
    related: ['markdown-to-google-docs', 'markdown-to-pdf-converter', 'markdown-to-html'],
  },
  {
    slug: 'markdown-to-google-docs',
    name: 'Markdown to Google Docs',
    h1: 'Markdown to Google Docs',
    title: 'Markdown to Google Docs – Paste Markdown with Formatting | Hashlite',
    description: 'Get Markdown into Google Docs with headings, lists, tables and code intact. Paste Markdown, copy it as formatted text, paste into Docs. Free, no sign-up.',
    action: 'copy',
    sample: REPORT,
    intro: 'Paste Markdown here, click <strong>Copy for Word / Docs</strong>, and paste into Google Docs. Headings, lists, tables, links and code keep their formatting, instead of arriving as # and ** symbols.',
    steps: [
      ['Paste your Markdown', 'For example an AI assistant’s answer, a README or your notes. The preview shows the result.'],
      ['Click Copy for Word / Docs', 'The formatted version goes to your clipboard.'],
      ['Paste into Google Docs', 'Press Ctrl+V (⌘V on a Mac). Headings become Docs headings, so they show up in the document outline.'],
    ],
    faq: [
      ['Doesn’t Google Docs read Markdown itself?', 'It can: turn on Tools › Preferences › Enable Markdown, then use Edit › Paste from Markdown. Tables and code blocks usually come through better with Copy for Word / Docs.'],
      ['What about math?', 'Math may paste as plain text. For documents with a lot of math, save a PDF from the ⋯ menu instead.'],
      ['Do I need an account?', 'No. Everything on this page works without signing up.'],
    ],
    related: ['markdown-to-word', 'markdown-to-pdf-converter', 'markdown-viewer'],
  },
  {
    slug: 'markdown-to-pdf-converter',
    name: 'Markdown to PDF',
    h1: 'Markdown to PDF converter',
    title: 'Markdown to PDF Converter – Free, Online, No Sign-up | Hashlite',
    description: 'Convert Markdown to PDF in your browser. Tables, code, math and Mermaid diagrams are rendered. Free, no sign-up, nothing to install.',
    action: 'pdf',
    sample: `${REPORT}
$$
\\text{growth} = \\frac{q_2 - q_1}{q_1}
$$
`,
    intro: 'Paste Markdown and click <strong>Save as PDF</strong>. The PDF is printed from the preview in a clean, light layout, with tables, highlighted code, math and diagrams as you see them.',
    steps: [
      ['Paste or open your Markdown', 'Paste it into the editor, or open a .md file from the ⋯ menu.'],
      ['Click Save as PDF', 'Your browser’s print dialog opens with just the document.'],
      ['Choose Save as PDF', 'Pick “Save as PDF” as the destination. Turn off “Headers and footers” to remove the date and address.'],
    ],
    faq: [
      ['Are code blocks and tables split across pages?', 'Hashlite asks the browser to keep code blocks, table rows and diagrams together where it can.'],
      ['Can I convert many files at once?', 'This page converts one document at a time. For batch jobs, see the pandoc section in the Markdown to PDF guide.'],
      ['Is it really free?', 'Yes, with no sign-up, watermark or page limit.'],
    ],
    related: ['markdown-to-word', 'markdown-to-html', 'latex-math-editor'],
    guide: '/learn/markdown-to-pdf',
  },
  {
    slug: 'markdown-to-html',
    name: 'Markdown to HTML',
    h1: 'Markdown to HTML converter',
    title: 'Markdown to HTML Converter – Free and Online | Hashlite',
    description: 'Convert Markdown to clean HTML. Copy the HTML source or download a standalone HTML page that works offline. Tables, code, math and diagrams included.',
    action: 'html',
    sample: `## Getting started

Install the package and import it:

\`\`\`bash
npm install my-package
\`\`\`

- Works in the browser and in Node
- **No dependencies**
- See the [docs](https://example.com)

| Option  | Default |
| ------- | ------- |
| \`debug\` | \`false\` |
`,
    intro: 'Paste Markdown and click <strong>Copy HTML</strong> for the HTML source, or choose <strong>Download HTML</strong> in the ⋯ menu for a standalone page with styles included. The HTML is sanitized, so scripts in the Markdown are removed.',
    steps: [
      ['Paste your Markdown', 'The preview shows the rendered HTML.'],
      ['Click Copy HTML', 'The HTML source goes to your clipboard, ready for a CMS, an email template or your own page.'],
      ['Or download a page', '⋯ › Download HTML gives a single .html file that works offline, with math as MathML and diagrams inlined.'],
    ],
    faq: [
      ['Which Markdown flavour is supported?', 'GitHub-flavoured Markdown: tables, task lists, footnotes, autolinks and callouts, plus math and Mermaid diagrams.'],
      ['Is raw HTML in the Markdown kept?', 'Safe HTML is kept; scripts, event handlers and forms are removed.'],
      ['Does the copied HTML include styles?', 'Copy HTML gives the document’s HTML without a stylesheet. Download HTML includes the styles in the file.'],
    ],
    related: ['markdown-to-pdf-converter', 'markdown-viewer', 'readme-editor'],
  },
  {
    slug: 'markdown-viewer',
    name: 'Markdown viewer',
    h1: 'Online Markdown viewer',
    title: 'Online Markdown Viewer – Open .md Files in Your Browser | Hashlite',
    description: 'View Markdown files online. Drop a .md file or paste Markdown to see it rendered, with tables, code, math and diagrams. Free, private, no sign-up.',
    action: 'open',
    view: 'preview',
    sample: `# Drop a Markdown file here

Or click **Open .md file** above, or paste Markdown into the editor.

This viewer shows:

- Headings, lists, **bold** and *italic*
- Tables and task lists
- Code with syntax highlighting
- Math like $a^2 + b^2 = c^2$
- Mermaid diagrams

Switch to the editor with the pencil button to make changes.
`,
    intro: 'Open a <code>.md</code> file, drop it on the page, or paste Markdown, and read it rendered. The file is read in your browser and never uploaded.',
    steps: [
      ['Open a file', 'Click Open .md file, or drag a file onto the page.'],
      ['Read it', 'The document is shown rendered. Use the pencil button to see or edit the Markdown.'],
      ['Export if you like', 'Save as PDF, download HTML, or copy it into Word or Google Docs from the ⋯ menu.'],
    ],
    faq: [
      ['Is the file uploaded?', 'No. The file is opened by your browser, and nothing is sent to a server.'],
      ['Which files can I open?', '.md, .markdown, .mdown, .mkd and plain .txt files up to 5 MB.'],
      ['Are images in the file shown?', 'Images with a full web address (https://…) are shown. Images stored next to the file on your computer can’t be reached from a web page.'],
    ],
    related: ['readme-editor', 'markdown-to-pdf-converter', 'markdown-to-html'],
  },
  {
    slug: 'csv-to-markdown-table',
    name: 'CSV to Markdown table',
    h1: 'CSV to Markdown table converter',
    title: 'CSV to Markdown Table Converter – Also Excel and Google Sheets | Hashlite',
    description: 'Convert CSV, TSV or cells copied from Excel or Google Sheets into a Markdown table. Choose alignment and header row, then copy. Free, instant, private.',
    action: 'copymd',
    tool: 'csv',
    toolSample: 'Name,Role,Location\nAda Lovelace,Engineer,London\nGrace Hopper,"Rear Admiral, US Navy",Arlington\nAlan Turing,Mathematician,Manchester',
    sample: `| Name         | Role                  | Location   |
| ------------ | --------------------- | ---------- |
| Ada Lovelace | Engineer              | London     |
| Grace Hopper | Rear Admiral, US Navy | Arlington  |
| Alan Turing  | Mathematician         | Manchester |
`,
    intro: 'Paste CSV, tab-separated text, or cells copied straight from Excel or Google Sheets. The Markdown table appears below with a live preview. Commas inside quotes, and pipes in cells, are handled for you.',
    steps: [
      ['Paste your data', 'Copy cells from a spreadsheet, or paste a CSV or TSV file’s contents. The separator is detected.'],
      ['Pick options', 'Say whether the first row is the header, and choose the column alignment.'],
      ['Copy the table', 'Click Copy Markdown, or keep editing the table in the editor.'],
    ],
    faq: [
      ['Can I paste from Excel or Google Sheets?', 'Yes. Copied cells arrive as tab-separated text, which is detected automatically.'],
      ['What happens to | characters in my data?', 'They are escaped as \\| so they don’t break the table.'],
      ['Can Markdown tables merge cells?', 'No. Standard Markdown tables have no merged cells. See the Markdown tables guide for workarounds.'],
    ],
    related: ['markdown-table-generator', 'markdown-to-word', 'markdown-to-html'],
    guide: '/learn/markdown-tables',
  },
  {
    slug: 'markdown-table-generator',
    name: 'Markdown table generator',
    h1: 'Markdown table generator',
    title: 'Markdown Table Generator – Build Tables in a Grid | Hashlite',
    description: 'Create Markdown tables without counting pipes. Type into a grid, add rows and columns, set alignment, and copy the Markdown. Free and instant.',
    action: 'copymd',
    tool: 'grid',
    sample: `| Name  | Role     | Since |
| ----- | -------- | ----- |
| Ada   | Engineer | 2021  |
| Grace | Admiral  | 2019  |
`,
    intro: 'Type into the grid and the Markdown table is written for you, neatly aligned. Add or remove rows and columns, paste cells from a spreadsheet, and copy the result.',
    steps: [
      ['Fill in the grid', 'Type in the cells. Use + Row and + Column to grow the table.'],
      ['Set the alignment', 'Choose left, center or right alignment, and whether the first row is a header.'],
      ['Copy the Markdown', 'Click Copy Markdown and paste it into your README, docs or notes.'],
    ],
    faq: [
      ['Can I paste a whole block of cells?', 'Yes. Paste cells copied from a spreadsheet into any grid cell; the grid grows to fit.'],
      ['Why are the columns padded with spaces?', 'It makes the Markdown easy to read. The spaces don’t change how the table looks.'],
      ['Where do Markdown tables work?', 'On GitHub, GitLab, in most documentation tools and note apps, and in Hashlite.'],
    ],
    related: ['csv-to-markdown-table', 'readme-editor', 'markdown-to-word'],
    guide: '/learn/markdown-tables',
  },
  {
    slug: 'mermaid-editor',
    name: 'Mermaid editor',
    h1: 'Mermaid diagram editor',
    title: 'Mermaid Live Editor – Flowcharts and Diagrams in Markdown | Hashlite',
    description: 'Write Mermaid diagrams with a live preview: flowcharts, sequence diagrams, Gantt charts and more, inside Markdown. Export as PDF or HTML. Free, no sign-up.',
    action: 'pdf',
    sample: `# Diagrams with Mermaid

\`\`\`mermaid
flowchart LR
  A[Write Markdown] --> B{Looks good?}
  B -- Yes --> C[Export PDF]
  B -- No --> A
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant You
  participant Hashlite
  You->>Hashlite: Paste Markdown
  Hashlite-->>You: Live preview
\`\`\`
`,
    intro: 'Write Mermaid code in a <code>```mermaid</code> block and see the diagram as you type, next to the rest of your document. Flowcharts, sequence diagrams, class and state diagrams, Gantt charts and more.',
    steps: [
      ['Write a mermaid block', 'Start a code block with ```mermaid and describe the diagram.'],
      ['Watch the preview', 'The diagram redraws as you type. Syntax errors are shown instead of the diagram.'],
      ['Export it', 'Save as PDF, or download HTML with the diagram inlined as SVG.'],
    ],
    faq: [
      ['Which diagram types work?', 'All Mermaid types, including flowchart, sequence, class, state, entity-relationship, Gantt, pie and mindmap.'],
      ['Can I mix diagrams with text?', 'Yes. Diagrams sit in a normal Markdown document, with headings, lists and tables around them.'],
      ['Does it work in dark mode?', 'Yes. Diagrams follow the colour theme, and printing always uses a light version.'],
    ],
    related: ['latex-math-editor', 'markdown-to-pdf-converter', 'readme-editor'],
    guide: '/learn/markdown-math-and-diagrams',
  },
  {
    slug: 'latex-math-editor',
    name: 'LaTeX math editor',
    h1: 'Online LaTeX math editor',
    title: 'Online LaTeX Math Editor – Equations in Markdown with KaTeX | Hashlite',
    description: 'Write LaTeX math with a live preview, inline or as display equations, inside Markdown. Rendered with KaTeX. Export to PDF or HTML. Free, no sign-up.',
    action: 'pdf',
    sample: `# Math with KaTeX

Inline math: the area of a circle is $A = \\pi r^2$.

Display math:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

$$
\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}
\\begin{pmatrix} x \\\\ y \\end{pmatrix}
=
\\begin{pmatrix} ax + by \\\\ cx + dy \\end{pmatrix}
$$
`,
    intro: 'Type LaTeX between <code>$…$</code> for inline math or <code>$$…$$</code> for display equations, and see it typeset as you type. Mix it with normal Markdown text, then save as PDF.',
    steps: [
      ['Write your equations', 'Use $…$ inline and $$…$$ on their own lines for display math.'],
      ['Check the preview', 'Equations are typeset with KaTeX as you type. Errors are shown in red.'],
      ['Save or share', 'Save as PDF, or download HTML with the math as MathML.'],
    ],
    faq: [
      ['Which LaTeX commands are supported?', 'Most math-mode commands: fractions, roots, sums, integrals, matrices, aligned equations, Greek letters and more. KaTeX’s documentation lists them all.'],
      ['Can I write whole LaTeX documents?', 'No. This is Markdown with LaTeX math, not a full LaTeX compiler. Packages and document classes aren’t supported.'],
      ['Does the math work in exports?', 'Yes. PDF shows it as typeset, and HTML downloads include it as MathML, which browsers display without extra files.'],
    ],
    related: ['mermaid-editor', 'markdown-to-pdf-converter', 'markdown-to-html'],
    guide: '/learn/markdown-math-and-diagrams',
  },
  {
    slug: 'readme-editor',
    name: 'README editor',
    h1: 'README editor with live preview',
    title: 'README Editor – Write a GitHub README with Live Preview | Hashlite',
    description: 'Write a README.md with a live, GitHub-style preview: tables, task lists, code, callouts, math and Mermaid diagrams. Start from a template. Free, no sign-up.',
    action: 'copymd',
    sample: `# Project name

One sentence about what this project does and who it is for.

## Installation

\`\`\`bash
npm install project-name
\`\`\`

## Usage

\`\`\`js
import { hello } from 'project-name';
hello('world');
\`\`\`

## Features

- [x] Does one thing well
- [ ] Planned: another thing

> [!TIP]
> Keep the first screen short: what it is, how to install, how to use.

## License

MIT
`,
    intro: 'Start from the README template, or paste your own. The preview follows GitHub-flavoured Markdown: tables, task lists, fenced code with highlighting, callouts, math and Mermaid diagrams.',
    steps: [
      ['Edit the template', 'Replace the placeholders with your project’s details.'],
      ['Check the preview', 'It renders the way GitHub does for the features most READMEs use.'],
      ['Copy it', 'Click Copy Markdown, or download it from the ⋯ menu and rename it to README.md.'],
    ],
    faq: [
      ['Is the preview identical to GitHub?', 'Very close for standard features: headings, tables, task lists, code, callouts, math and Mermaid. GitHub-only extras like @mentions and issue links aren’t resolved.'],
      ['Can I keep several READMEs?', 'Choose Save to keep them in a free account, with folders and version history.'],
      ['What should a README contain?', 'What the project is, how to install it, how to use it, and how to contribute. Keep the first screen short.'],
    ],
    related: ['markdown-table-generator', 'markdown-viewer', 'mermaid-editor'],
  },
];

export const toolBySlug = (slug) => TOOLS.find((t) => t.slug === slug);
