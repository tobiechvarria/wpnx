# WPNX 107.7 FM — Developer Scratchpad
> Use this with Claude Code in WebStorm. Reference during development.

---

## Project Stack
- **Framework:** Astro (static output)
- **Hosting:** Cloudflare Pages
- **CMS Options:** Decap CMS (Git-based) or Tina CMS (visual editing)
- **Audio:** KLF MP3 looping player (custom vanilla JS)
- **Fonts:** Bebas Neue, IBM Plex Mono, Source Serif 4 (Google Fonts)
- **Brand color:** `#ef4444` (Tailwind red-500)

---

## Project Structure
```
wpnx/
├── public/
│   ├── admin/
│   │   ├── index.html          # Decap CMS UI entry point
│   │   └── config.yml          # Decap CMS collection definitions
│   ├── images/                 # CMS-uploaded images land here
│   └── the-klf-elvis-on-the-radio.mp3
├── src/
│   ├── components/
│   │   ├── Nav.astro           # Sticky nav + hamburger + scroll-spy
│   │   ├── Hero.astro          # Hero section (accepts tagline, heroBody props)
│   │   ├── Player.astro        # KLF audio player (preload:none, plays on click)
│   │   ├── GRCBanner.astro     # Red top banner (accepts bannerText prop)
│   │   ├── ShowRow.astro       # Single show row with progressive audio player
│   │   ├── Countdown.astro     # Ticket countdown (accepts targetDate prop)
│   │   ├── ContactForm.astro   # Form with fetch() submission + inline validation
│   │   └── Footer.astro        # Footer nav
│   ├── content/
│   │   ├── settings/
│   │   │   └── station.json    # Station name, tagline, hero text, contact email
│   │   ├── shows/
│   │   │   ├── show-01.json    # Each show is a separate file
│   │   │   ├── show-02.json    # Add new shows by adding new files here
│   │   │   └── ...
│   │   ├── grc/
│   │   │   └── grc.json        # Conference dates, prices, focus areas
│   │   ├── schedule/
│   │   │   └── schedule.json   # 3-day schedule array
│   │   └── donate/
│   │       └── tiers.json      # Donation tier amounts and names
│   ├── layouts/
│   │   └── Layout.astro        # Base HTML, head, OG tags, fonts
│   ├── pages/
│   │   └── index.astro         # Main page — assembles all components
│   └── styles/
│       └── global.css          # Design tokens, reset, base styles, utilities
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

---

## Local Development
```bash
# Install dependencies
npm install

# Start dev server (hot reload)
npm run dev
# → http://localhost:4321

# Build for production
npm run build

# Preview production build locally
npm run preview
```

---

## Design Tokens (src/styles/global.css)
```css
:root {
  /* Colours */
  --color-ink:        #000000;
  --color-paper:      #ffffff;
  --color-paper-alt:  #f5f5f5;
  --color-red:        #ef4444;   /* brand — Tailwind red-500 */
  --color-red-dark:   #c0392b;
  --color-muted:      #666666;
  --color-rule:       #e0e0e0;

  /* Spacing scale */
  --space-2xs: 0.25rem;
  --space-xs:  0.5rem;
  --space-sm:  0.75rem;
  --space-md:  1rem;
  --space-lg:  1.5rem;
  --space-xl:  2rem;
  --space-2xl: 3rem;
  --space-3xl: 4rem;

  /* Typography */
  --font-display: 'Bebas Neue', sans-serif;
  --font-mono:    'IBM Plex Mono', monospace;
  --font-serif:   'Source Serif 4', Georgia, serif;
  --font-size-base: 17px;

  /* Layout */
  --max-width:  1200px;
  --nav-height: 56px;
}
```

---

## Adding a New Show
Create a new file in `src/content/shows/show-10.json`:
```json
{
  "id": "10",
  "show": "Show Name",
  "host": "w/ Host Name",
  "episode": "June 20, 2026 — Episode Title",
  "src": "https://your-audio-url.mp3"
}
```
Leave `"src": ""` for Coming Soon. Commit → Cloudflare auto-deploys.

---

## Updating the Schedule
Edit `src/content/schedule/schedule.json`.
Event type options: `keynote` | `screening` | `workshop` | `performance` | `social`

---

## Updating Ticket Prices / Dates
Edit `src/content/grc/grc.json`:
- `earlyBirdPrice` — number, no $ sign
- `earlyBirdEnd` — string, e.g. `"July 31, 2026"`
- `generalPrice` — number
- `registrationOpens` — ISO string, e.g. `"2026-07-01T00:00:00"` (drives countdown)

---

## Formspree Setup (Contact Form)
1. Create account at formspree.io
2. Create a form → copy the form ID
3. In `src/components/ContactForm.astro`, replace:
   ```
   action="https://formspree.io/f/YOUR_FORM_ID"
   ```

---

## Zeffy Embed (Donations + Tickets)
In `src/pages/index.astro`, find the `embed-placeholder` divs and replace with Zeffy iframes:
```html
<!-- Replace this div: -->
<div class="embed-placeholder">...</div>

<!-- With your Zeffy iframe: -->
<iframe src="https://www.zeffy.com/embed/..." ...></iframe>
```
Two embeds needed:
- Donation campaign → in `#donate` section
- Ticketing campaign → in `#grc-tickets` section

---

## Mobile Breakpoints
- `900px` — hamburger nav, single column grids, stacked hero
- `480px` — tighter spacing, smaller type, volume slider hidden

---

## CSS Naming Convention — BEM
```
.block {}
.block__element {}
.block__element--modifier {}

Examples:
.nav {}
.nav__link {}
.nav__link--highlight {}
.show-row {}
.show-row__btn {}
.show-row__btn.is-playing {}   ← state via JS class, not BEM modifier
```

---
---

# CMS Option 1: Decap CMS (Git-based)
> Editor goes to /admin, edits forms, saves → triggers Cloudflare rebuild (~30s)

## What It Is
- Open source, free, no monthly cost
- Editor logs in with GitHub
- Changes save as JSON commits to the repo
- Cloudflare Pages detects the commit and auto-rebuilds

## One-Time Developer Setup

### Step 1 — Push to GitHub
```bash
cd wpnx
git init
git add .
git commit -m "Initial commit"
gh repo create wpnx --public --source=. --push
# or create repo on github.com and push manually
```

### Step 2 — Connect Cloudflare Pages to GitHub
1. Cloudflare Dashboard → Pages → Create application → Pages
2. Connect to Git → Select your `wpnx` repo
3. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Deploy

### Step 3 — Create GitHub OAuth App
1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Fill in:
   - Application name: `WPNX CMS`
   - Homepage URL: `https://wpnx.pages.dev`
   - Authorization callback URL: `https://api.netlify.com/auth/done`
     *(Decap uses Netlify's auth service even on non-Netlify hosts)*
3. Copy **Client ID** and generate a **Client Secret**

### Step 4 — Deploy Netlify Identity Proxy
Decap needs a small auth proxy. Easiest: deploy
[netlify/netlify-cms-oauth-provider-node](https://github.com/vencax/netlify-git-api) to a free Render.com or Railway instance, or use the official Decap proxy:
```bash
npx decap-server  # for local testing only
```
For production, follow:
https://decapcms.org/docs/external-oauth-clients/

**Simpler alternative:** Use Cloudflare Pages with their built-in GitHub OAuth.
In `public/admin/config.yml` set:
```yaml
backend:
  name: github
  repo: your-username/wpnx
  branch: main
  base_url: https://wpnx.pages.dev
```
Then add a Cloudflare Pages Function to handle OAuth:
`functions/auth/[provider].js` — see https://decapcms.org/docs/cloudflare-pages/

### Step 5 — Update config.yml
```yaml
# public/admin/config.yml
backend:
  name: github
  repo: YOUR-USERNAME/wpnx   # ← your actual repo
  branch: main
  base_url: https://wpnx.pages.dev  # ← your actual URL
```

### Step 6 — Invite Editors
GitHub repo → Settings → Collaborators → Add people (by email)
They'll get an invite email, accept it, then can log into `/admin`

## What the Editor Sees at /admin
```
Dashboard collections:
  ⚙️  Site Settings     → station name, tagline, hero text, contact email, addresses
  🎙️  On Demand Shows   → list of shows, add/edit/delete, paste audio URLs
  📻  GRC Conference    → dates, ticket prices, description, focus areas
  📅  Weekend Schedule  → per-day event list, times, event types
  💛  Donation Tiers    → amounts, tier names, featured flag
```
Editor clicks → edits text in a form → hits Publish → site rebuilds → done.

## Editor Workflow (no code)
1. Go to `wpnx.pages.dev/admin`
2. Log in with GitHub (stays logged in)
3. Click a collection (e.g. "On Demand Shows")
4. Click a show to edit, or "New Show" to add
5. Fill in the fields
6. Click **Publish**
7. Wait ~30 seconds → site is live

---
---

# CMS Option 2: Tina CMS (Visual / On-Page Editing)
> Editor clicks directly on text on the live site to edit it. Most intuitive option.

## What It Is
- Visual editing — editor sees the actual site, clicks to edit inline
- Changes save to GitHub (same as Decap)
- Free tier: 2 users, unlimited projects
- Paid from $29/month for more users + real-time collaboration
- Requires a Tina Cloud account (free)

## How It Looks for the Editor
Instead of a separate dashboard at `/admin`, the editor goes to the live site
and clicks a floating **Edit** button. The site gains an editing overlay —
they click on the station name, it becomes an editable field right on the page.
No separate UI to learn. Closest thing to editing a Google Doc while seeing it render.

## One-Time Developer Setup

### Step 1 — Install Tina
```bash
npx @tinacms/cli@latest init
# Choose: TypeScript, GitHub backend
# This creates:
#   tina/config.ts       ← schema definition (equivalent to Decap's config.yml)
#   tina/__generated__/  ← auto-generated types (commit these)
```

### Step 2 — Define the Schema
Replace the generated `tina/config.ts` with your content model:
```typescript
import { defineConfig } from 'tinacms';

export default defineConfig({
  branch: process.env.GITHUB_BRANCH ?? 'main',
  clientId: process.env.TINA_PUBLIC_CLIENT_ID ?? '',
  token: process.env.TINA_TOKEN ?? '',

  build: {
    outputFolder: 'admin',
    publicFolder: 'public',
  },

  media: {
    tina: {
      mediaRoot: 'images',
      publicFolder: 'public',
    },
  },

  schema: {
    collections: [
      // Station Settings
      {
        name: 'settings',
        label: 'Site Settings',
        path: 'src/content/settings',
        format: 'json',
        fields: [
          { type: 'string', name: 'name',          label: 'Station Name' },
          { type: 'string', name: 'tagline',        label: 'Tagline' },
          { type: 'string', name: 'heroBody',       label: 'Hero Text',        ui: { component: 'textarea' } },
          { type: 'string', name: 'contactEmail',   label: 'Contact Email' },
          { type: 'string', name: 'transmitterAddress', label: 'Transmitter Address', ui: { component: 'textarea' } },
          { type: 'string', name: 'grcVenueName',   label: 'GRC Venue Name' },
          { type: 'string', name: 'grcVenueAddress',label: 'GRC Venue Address', ui: { component: 'textarea' } },
        ],
      },
      // Shows
      {
        name: 'shows',
        label: 'On Demand Shows',
        path: 'src/content/shows',
        format: 'json',
        fields: [
          { type: 'string', name: 'id',      label: 'Show Number (e.g. 01)' },
          { type: 'string', name: 'show',    label: 'Show Name' },
          { type: 'string', name: 'host',    label: 'Host', required: false },
          { type: 'string', name: 'episode', label: 'Episode Title' },
          { type: 'string', name: 'src',     label: 'Audio URL (leave blank = Coming Soon)', required: false },
        ],
      },
      // GRC
      {
        name: 'grc',
        label: 'GRC Conference',
        path: 'src/content/grc',
        format: 'json',
        fields: [
          { type: 'string', name: 'edition',           label: 'Edition (e.g. 30th Annual)' },
          { type: 'string', name: 'startDate',         label: 'Start Date' },
          { type: 'string', name: 'endDate',           label: 'End Date' },
          { type: 'string', name: 'bannerText',        label: 'Banner Text' },
          { type: 'string', name: 'description',       label: 'Description', ui: { component: 'textarea' } },
          { type: 'string', name: 'focusAreas',        label: 'Focus Areas', list: true },
          { type: 'number', name: 'earlyBirdPrice',    label: 'Early Bird Price ($)' },
          { type: 'string', name: 'earlyBirdEnd',      label: 'Early Bird End Date' },
          { type: 'number', name: 'generalPrice',      label: 'General Ticket Price ($)' },
          { type: 'string', name: 'registrationOpens', label: 'Registration Opens (ISO date)' },
        ],
      },
    ],
  },
});
```

### Step 3 — Create Tina Cloud Account
1. Go to https://app.tina.io
2. Create a project → connect your GitHub repo
3. Copy your **Client ID** and **Token**

### Step 4 — Add Environment Variables
In Cloudflare Pages → Settings → Environment Variables:
```
TINA_PUBLIC_CLIENT_ID = your-client-id-from-tina-cloud
TINA_TOKEN           = your-token-from-tina-cloud
GITHUB_BRANCH        = main
```

### Step 5 — Update Build Command
In Cloudflare Pages build settings:
```
Build command:  npx tinacms build && astro build
Output dir:     dist
```

### Step 6 — Add Visual Editing to Components
In each Astro component that should be editable, add `data-tina-field` attributes.
Example in `Hero.astro`:
```astro
<p class="hero__freq" data-tina-field="tagline">{tagline}</p>
<div class="hero__body" data-tina-field="heroBody">
  {paragraphs.map(p => <p>{p}</p>)}
</div>
```
Tina reads these attributes to know which field to activate when the editor clicks.

## Editor Workflow with Tina (no code)
1. Go to `wpnx.pages.dev` (the actual site, not /admin)
2. Click the **Edit** button (bottom left, appears when logged in via Tina Cloud)
3. The site gets an editing overlay
4. Click on any text to edit it inline
5. Sidebar shows the form fields for that section
6. Click **Save** → changes commit to GitHub → site rebuilds in ~30s

---
---

# Decap vs Tina — Which to Choose

| | Decap CMS | Tina CMS |
|---|---|---|
| **Editor experience** | Form dashboard at /admin | Click to edit on the live site |
| **Learning curve for editor** | Low — familiar form UI | Very low — WYSIWYG |
| **Cost** | Free | Free (2 users), $29+/mo for more |
| **Auth complexity** | Medium — GitHub OAuth setup | Low — Tina Cloud handles it |
| **Best for** | Editors comfortable with web forms | Editors who want to see what they're editing |
| **Visual editing** | No | Yes |
| **Offline editing** | Yes (local Git) | No (requires Tina Cloud) |
| **Your current setup** | Already configured (public/admin/) | Needs tina/config.ts + data attributes |

**Recommendation for WPNX:** Tina if the editors are non-technical and will be confused by a separate dashboard. Decap if you want zero ongoing cost and editors can handle a form UI.

---

## Cloudflare Pages Build Config (both options)
```
Framework preset:    Astro
Build command:       npm run build          (Decap)
                     npx tinacms build && astro build   (Tina)
Build output dir:    dist
Node version:        20
```

## Environment Variables Needed
```
# Decap — none needed in Cloudflare (OAuth handled client-side via GitHub)

# Tina
TINA_PUBLIC_CLIENT_ID=xxxxx
TINA_TOKEN=xxxxx
GITHUB_BRANCH=main
```

---

## Git Workflow as Developer
```bash
# Make component/layout changes locally
npm run dev        # preview at localhost:4321

# When happy
git add .
git commit -m "describe change"
git push           # Cloudflare auto-deploys

# Pull editor's CMS changes before working
git pull
```

## Key Files to Never Hand-Edit After CMS Setup
Once CMS is live, these files are owned by the CMS — only edit via the dashboard:
- `src/content/shows/*.json`
- `src/content/settings/station.json`
- `src/content/grc/grc.json`
- `src/content/schedule/schedule.json`
- `src/content/donate/tiers.json`

You can still edit them directly in an emergency, but the CMS will overwrite on next save.

---

## Known Issues / TODOs
- [ ] Replace `YOUR_FORM_ID` in `ContactForm.astro` with real Formspree ID
- [ ] Replace Zeffy placeholder divs in `index.astro` with real Zeffy iframes (two: donate + tickets)
- [ ] Update `config.yml` `repo:` with actual GitHub username/repo name
- [ ] Add `og-image.jpg` to `public/` for social sharing previews (1200×630px recommended)
- [ ] Add `favicon.svg` to `public/` (currently placeholder)
- [ ] Test hamburger nav on physical iPhone after deploy (not just DevTools)
- [ ] Add WPNX real audio stream URL once Radio.co station is configured
- [ ] Add remaining show MP3 URLs to `src/content/shows/show-0*.json` as they become available

---

## Audio Player Notes
- Player uses `preload="none"` — MP3 not downloaded until play is clicked
- `src` attribute set in JS on first play only (avoids mobile data waste)
- Volume slider hidden on mobile (< 900px) to save space
- KLF track: `/the-klf-elvis-on-the-radio.mp3` (3.3MB, served from Cloudflare CDN)
- When Radio.co is live: replace `Player.astro` audio `src` with actual stream URL
