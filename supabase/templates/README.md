# Email templates

Hashlite-styled emails for Supabase Auth. Supabase keeps these in the dashboard, not in the
database, so copy them in by hand:

**Supabase dashboard → Authentication → Emails → Templates**

| Template | Subject | Body |
| --- | --- | --- |
| Confirm signup | `Confirm your email for Hashlite` | [confirmation.html](confirmation.html) |
| Reset password | `Reset your Hashlite password` | [recovery.html](recovery.html) |
| Change email address | `Confirm your new email for Hashlite` | [email_change.html](email_change.html) |
| Magic link | `Your Hashlite sign-in link` | [magic_link.html](magic_link.html) |

For each one, paste the subject, then paste the whole file into the message body (the
"Source" view) and save. Keep the `{{ .ConfirmationURL }}` placeholders: Supabase replaces
them with the real link.

The layout is a single table with inline styles, so it looks the same in Gmail, Outlook and
Apple Mail. The colours match the site (accent `#4f46e5`).

With the Supabase CLI (`supabase/config.toml`), the same files can be referenced as
`content_path = "./supabase/templates/confirmation.html"` under `[auth.email.template.confirmation]`, and so on.
