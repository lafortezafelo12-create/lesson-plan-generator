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

## 2. Choose an admin password

The app has an **Admin** button that lets you update the Gemini API key from the live site,
without redeploying. It's protected by a password that you set yourself.

Pick a password and keep it for step 4 (setting environment variables). It is never stored in any
file in this repo &mdash; only in Netlify's environment variables, exactly like the API key.

## 3. Run it locally (optional, requires Node.js + Netlify CLI)

```bash
npm install
npm install -g netlify-cli   # if you don't have it already
netlify dev
```

Netlify CLI will ask you to link/create a site the first time. Before it can call Gemini locally,
create a `.env` file in the project root:

```
GEMINI_API_KEY=your-key-here
ADMIN_PASSWORD=your-chosen-password
```

Then open the local URL it prints (usually `http://localhost:8888`). The Admin panel and API-key
override use **Netlify Blobs**, which requires `netlify dev` (not a plain static server or `node`)
to work locally, since Blobs needs the Netlify site context.

> `.env` is only for local development. **Do not commit it** &mdash; add it to `.gitignore` (it
> already is).

## 4. Deploy to Netlify

**Option A &mdash; Netlify CLI (fastest)**
```bash
netlify deploy --prod
```

**Option B &mdash; Git-based deploy (recommended for updates)**
1. Push this project to a GitHub/GitLab repo.
2. In the Netlify dashboard: **Add new site > Import an existing project**, and pick the repo.
3. Build settings are already defined in `netlify.toml` (publish dir `public`, functions dir
   `netlify/functions`) &mdash; no build command is needed. If your repo has this project inside a
   subfolder (e.g. `dll-app/`), set **Base directory** to that folder name in Netlify's build
   settings.

### Set your environment variables on Netlify

In the Netlify dashboard: **Site configuration > Environment variables > Add a variable**

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | your Gemini API key (used unless an admin override is set) |
| `ADMIN_PASSWORD` | the password you chose in step 2 &mdash; protects the Admin panel |

Redeploy after adding/changing environment variables so the functions pick them up.

## Choosing an AI model

The form includes a model dropdown:

| Option shown to user | Gemini model ID used |
|---|---|
| Gemini 3.5 Flash (recommended) | `gemini-3.5-flash` |
| Gemini 3.1 Pro (higher quality, slower) | `gemini-3.1-pro-preview` |
| Gemini 3.1 Flash-Lite (fastest, cheapest) | `gemini-3.1-flash-lite` |

Google renames/retires Gemini models fairly often. If a model option starts failing, update the
`MODEL_MAP` object at the top of `netlify/functions/generate.js` with the current model ID from
[Google AI Studio](https://aistudio.google.com/) &mdash; that's the only place it needs to change.

## Admin panel

Click **⚙ Admin** in the top bar, enter your `ADMIN_PASSWORD`, and you can:
- See whether the site is currently using the default key (from `GEMINI_API_KEY`) or a custom
  override, with a masked preview of the last 4 characters
- Paste a new Gemini API key to use going forward (saved to Netlify Blobs, not to a file)
- Revert to the default env-var key at any time

The password check happens inside `netlify/functions/admin.js`, server-side &mdash; it is never
present in any file sent to the browser, so it stays safe even in a public GitHub repo.

## How it works

1. You fill in subject, grade level, topic, number of days, and pick a model.
2. The browser calls `/api/generate` &rarr; the Netlify function resolves which API key to use
   (admin override, if any, else `GEMINI_API_KEY`), calls Gemini with a prompt asking for
   structured JSON (competency + per-day objectives, flow, resources, assessment, etc.), and
   returns it to the browser.
3. You review/edit the generated text directly on the page.
4. Clicking **Download as Word** sends your (possibly edited) content to `/api/generate-docx`,
   which builds a `.docx` matching the ILAW table layout &mdash; with one column per day &mdash;
   and returns the file for download.
5. Each generation is also stored in your browser's `localStorage` under "Your session library" so
   you can reopen or re-download it later on the same device.

## Customizing

- **Model options**: edit `MODEL_MAP` in `netlify/functions/generate.js` and the matching
  `<option>` list in `public/index.html`.
- **Prompt / content shape**: edit the `schemaHint`/`prompt` in `netlify/functions/generate.js`.
- **Docx layout/branding**: edit `netlify/functions/generate-docx.js` (colors `NAVY`/`GOLD`,
  fonts, header table fields, signature block names).
- **Design**: `public/style.css` uses CSS variables at the top (`--navy`, `--gold`, `--paper`,
  etc.) for quick re-theming.

## Notes & limits

- Anyone with the site URL can generate lesson plans (and will use your Gemini quota) &mdash; only
  the Admin panel (key management) is password-protected, not lesson generation itself. If you
  want to restrict who can generate at all, consider adding Netlify Identity or a shared password
  gate on the whole site.
- The "library" lives only in `localStorage`&mdash;clearing browser data or switching devices
  loses it. If you later want lesson plans to follow you across devices, that would need a real
  backend (e.g., Firebase or Supabase) instead of `localStorage`.
- The admin-set API key lives in Netlify Blobs, scoped to your site. It survives redeploys but is
  tied to this specific Netlify site &mdash; it won't carry over if you create a new site from the
  same repo.
