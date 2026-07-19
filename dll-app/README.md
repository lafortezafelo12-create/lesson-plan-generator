# ILAW &mdash; Daily Lesson Log Generator

A small web app that drafts DepEd Daily Lesson Logs (ILAW Format, MATATAG) using the Gemini API,
lets you edit the AI draft, and exports it as a `.docx` in the correct table format &mdash; for
any number of days (1, 4, 5, or more).

- **Frontend**: plain HTML/CSS/JS, no build step (`public/`)
- **AI calls**: a Netlify Function (`netlify/functions/generate.js`) calls Gemini server-side, so
  your API key is never exposed in the browser.
- **Word export**: another Netlify Function (`netlify/functions/generate-docx.js`) builds the
  `.docx` file server-side using the `docx` npm package and streams it back for download.
- **"Library"**: generated lesson plans are kept in your browser's `localStorage` for the session
  (per device/browser) so you can revisit or re-download them &mdash; nothing is uploaded to a
  database.

## 1. Get a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and sign in with your Google
   account.
2. Click **Create API key** and copy it.
3. Keep it secret &mdash; you'll paste it into Netlify's environment variables, never into the
   frontend code.

## 2. Run it locally (optional, requires Node.js + Netlify CLI)

```bash
npm install
npm install -g netlify-cli   # if you don't have it already
netlify dev
```

Netlify CLI will ask you to link/create a site the first time. Before it can call Gemini locally,
create a `.env` file in the project root:

```
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-2.5-flash
```

Then open the local URL it prints (usually `http://localhost:8888`).

> `.env` is only for local development. **Do not commit it** &mdash; add it to `.gitignore`.

## 3. Deploy to Netlify

**Option A &mdash; Netlify CLI (fastest)**
```bash
netlify deploy --prod
```

**Option B &mdash; Git-based deploy (recommended for updates)**
1. Push this project to a GitHub/GitLab repo.
2. In the Netlify dashboard: **Add new site > Import an existing project**, and pick the repo.
3. Build settings are already defined in `netlify.toml` (publish dir `public`, functions dir
   `netlify/functions`) &mdash; no build command is needed.

### Set your API key on Netlify

In the Netlify dashboard: **Site configuration > Environment variables > Add a variable**

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | your Gemini API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` (optional &mdash; change if you want a different model) |

Redeploy after adding/changing environment variables so the functions pick them up.

## How it works

1. You fill in subject, grade level, topic, and number of days.
2. The browser calls `/api/generate` &rarr; the Netlify function calls Gemini with a prompt asking
   for structured JSON (competency + per-day objectives, flow, resources, assessment, etc.) and
   returns it to the browser.
3. You review/edit the generated text directly on the page.
4. Clicking **Download as Word** sends your (possibly edited) content to `/api/generate-docx`,
   which builds a `.docx` matching the ILAW table layout &mdash; with one column per day &mdash;
   and returns the file for download.
5. Each generation is also stored in your browser's `localStorage` under "Your session library" so
   you can reopen or re-download it later on the same device.

## Customizing

- **Model**: change `GEMINI_MODEL` in Netlify's environment variables at any time.
- **Prompt / content shape**: edit the `schemaHint`/`prompt` in `netlify/functions/generate.js`.
- **Docx layout/branding**: edit `netlify/functions/generate-docx.js` (colors `NAVY`/`GOLD`,
  fonts, header table fields, signature block names).
- **Design**: `public/style.css` uses CSS variables at the top (`--navy`, `--gold`, `--paper`,
  etc.) for quick re-theming.

## Notes & limits

- No login/accounts are built in &mdash; anyone with the site URL can generate lesson plans (and
  will use your Gemini quota). If you want to restrict access, consider adding Netlify Identity or
  a simple shared password gate before making the site public.
- The "library" lives only in `localStorage`&mdash;clearing browser data or switching devices
  loses it. If you later want lesson plans to follow you across devices, that would need a real
  backend (e.g., Firebase or Supabase) instead of `localStorage`.
