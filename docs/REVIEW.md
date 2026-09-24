# Hashmark review: walkthrough and improvements

**Date:** 2026-09-24. This covers the review done right after the first version was built, when the app was still called MD-BOY.

## How the review was done

1. **Review.** Four agents each looked at one part: the server, the editor's saving and draft logic, Markdown editing and rendering, and a real walkthrough in Chromium at desktop, tablet and phone sizes. A second agent then re-checked every finding against the code and tried to disprove it, and added what the first one missed. That confirmed about 70 findings.
2. **Fix.** Five agents fixed the findings. Each owned its own files, and each fix was reviewed by another agent.
3. **Final check.** A last round connected the parts. One agent then walked through every feature in the browser, another reviewed the whole diff, and the problems they found were fixed.

The API tests went from 11 to 38 and the browser tests from 1 to 6. All of them pass.

## Name

The app is now called **Hashmark**, with the tagline *"Write Markdown. See it live. Keep it safe."*

- **Why this name:** it is a normal word, easy to say and spell, and `#` is the first character every Markdown user types. A web search found no Markdown or notes app using it. The other names considered (Folio, Inkwell, Pilcrow, Margin, Plume, Verso, Quire) are all taken by existing Markdown editors. This was only a web search, not a trademark check.
- **Logo:** a white, slightly slanted `#` on the indigo accent colour.
- **In the code:** the name and tagline live in `client/src/brand.js`.

## Walkthrough: what a user experiences now

- **Sign-up and welcome doc:** a new user lands on sign-up (a returning user sees sign-in). Errors show next to the form, and the email is kept when switching between the two forms. The welcome document shows math, a diagram, a table, highlighted code, a task list and footnotes.
- **Editing:** every toolbar button works on an empty line and on a selection, and pressing it again undoes it. Ctrl+/ switches between editor, split and preview without commenting out the line. Keyboard combinations that type characters (AltGr on European layouts) no longer trigger shortcuts.
- **Scrolling, outline and history:** the editor and preview scroll together in both directions, and clicking the outline moves both. Version history keeps the text *before* it is overwritten, so the last state of a writing session is never lost. Restoring a version keeps the current text in the history.
- **Organising:** folders, drag and drop, search with highlighted matches, and the trash all work, with an Undo toast after moving something to the trash.
- **Import and export:**
  - A dropped Markdown file becomes a new document and leaves the open document alone.
  - The exported HTML works offline.
  - Printing always uses the light theme, diagrams included.
- **Two tabs or devices:** when both change the same document, the default choice is **Keep both**. Renaming in one tab never undoes changes in another, and a document moved to the trash elsewhere offers "Restore it" or "Save as new document".
- **Offline:** the status reads "Offline – saved locally" and saving resumes when the connection is back. Signing out with unsaved text asks first.
- **Account dialog:** change password, download everything as a `.zip`, or delete the account.
- **Phone:** the sidebar is a drawer that keeps keyboard focus and closes with Escape. The theme choices move into the ⋯ menu, and tap targets are at least 40px.

## What was fixed

**Server**
- **Docker:** the image could not write its database. It now can, and it has a health check.
- **Behind a proxy:** the same-origin check blocked every write, sign-in included, behind a normal nginx setup. It now uses `Sec-Fetch-Site`, and falls back to comparing with the forwarded host.
- **Cookies:** a malformed cookie from another app on the same domain made every request fail with a server error.
- **Version history** now saves the text that is being replaced. Old versions are thinned out over time (all from the last day, then hourly, then daily).
- **Rate limits** are now per address, per email and per account, and they no longer slow down as they fill up.
- **Sessions** renew while you use them.
- **Accounts:** you can change your password, delete your account and download all your data. `server/admin.js` resets a password, since the app does not send email. Sign-ups can be closed, and each account has a storage limit.
- **Static files:** hashed files are cached forever and served as precompressed `.br`/`.gz`. A missing file returns a proper 404 instead of the app page.
- **Other fixes:**
  - Renaming or moving a document no longer causes false "changed elsewhere" conflicts.
  - A trashed document can no longer be saved to silently.
  - The server shuts down cleanly on SIGTERM.
  - Future database migrations can no longer wipe the version history.

**Editor**
- **Empty lines:** the heading, list, task and quote buttons put the cursor after the marker instead of before it.
- **Horizontal rule** no longer turns the paragraph above it into a heading.
- **Code block:** the button no longer swallows the rest of the document, and pressing it twice no longer nests fences.
- **Bold and italic:** Ctrl+I on bold text no longer breaks the bold, and trailing spaces are kept outside the markers so the formatting still renders.
- **Other commands:**
  - Lists over several paragraphs are numbered correctly.
  - Tasks inside quotes can be ticked.
  - The line-numbers setting survives switching documents.

**Preview and export**
- **Mermaid:** diagram syntax errors no longer leak "Syntax error" images into the page and the printout.
- **Heading links:** headings named "Links", "Title" or "Name" lost their anchor ids, and outline links didn't match the preview when heading names repeated. Both fixed.
- **Math:** the math renderer used a different KaTeX version than its stylesheet, so fractions, superscripts and limits had the wrong sizes.
- **Speed:** the preview re-renders only the blocks that changed, and skips rendering while it is hidden.
- **Download size:** simple diagrams no longer download the 1.4 MB ELK layout engine. They use a 40 KB one instead.
- **Contrast:** faint text now meets WCAG AA contrast in both themes.

**App**
- **Trash view:** it showed `[object HTMLDivElement]` instead of the documents.
- **Keyboard:** AltGr+backslash could not be typed on European keyboards, and Ctrl+S saved twice.
- **Saving:**
  - A title with trailing spaces caused an endless save loop.
  - After the session expired, the old page kept saving and could overwrite newer work.
  - Opening documents quickly one after another no longer lets the slowest response win.
- **Accessibility:** the whole app was a live region, which made screen readers read out every change. It now has a skip link, focus returns where it should after dialogs and menus, menus work with the arrow keys, and the folder buttons work from the keyboard.
- **Updates:** after a new version is deployed, the app offers to reload.

## Not done yet (possible next steps)

These are ordered roughly by value. Each one was left out on purpose, to keep the product simple for now.

1. **Talking to LLMs.** Chat with a document, rewrite a selection, and accept or reject suggested edits. The research and plan are in [LLM-INTEGRATION.md](LLM-INTEGRATION.md). The first step is milestone M1: stored API keys and a chat panel, about 1.5–2 weeks.
2. **Images.** Paste or drop an image, stored on the server. Today images can only be linked by URL.
3. **Password reset by email.** This needs an email (SMTP) service. For now the admin runs `node server/admin.js reset-password <email>`.
4. **Sharing.** A read-only public link for a document, and later shared folders.
5. **Live updates between tabs and devices.** Today the app warns about a conflict when you save. It could instead reload the other tab's changes as they happen.
6. **A lighter first load.** The main script is about 250 KB compressed (Brotli). The math and code-highlighting libraries could be loaded only when a document needs them. That would need extra re-render logic, so it was left out.
7. **More Markdown extras.** GitHub-style callouts (`> [!NOTE]`), `==highlight==` and emoji shortcodes.
8. **Small polish items:**
   - The three conflict-dialog buttons wrap onto two rows.
   - Clicking Link twice nests a link inside the first.
   - Restoring a version can add a history entry identical to that version.
   - The outline doesn't highlight the section you are reading.
   - Tablets get the phone layout below 820px.
9. **Storage limit:** the limit counts document text only. Old versions are capped by the thinning instead.
