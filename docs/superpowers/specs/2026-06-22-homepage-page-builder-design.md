# Homepage Page Builder — Design

## Problem

The homepage is a fixed sequence of hardcoded sections in `src/pages/index.astro` (Nav, GRC banner, Hero, GRC, Schedule, Shows, Participate, Donate, About, Footer). Editors using Decap CMS can edit text *within* most sections, but cannot reorder sections, hide a section, or insert new freeform content between sections. The goal is to give editors that control without requiring code changes.

## Scope

- All 9 existing sections (Nav, GRC Banner, Hero, GRC, Schedule, Shows, Participate, Donate, About, Footer) become reorderable, show/hide-able blocks.
- 4 new generic block types are introduced: Text, Quote, Image + Caption, CTA Banner — insertable anywhere, with their own freeform content fields.
- Nav and Footer's link lists become derived from whichever blocks are actually present, instead of hardcoded — so they can never point at a missing or hidden section.
- Section numbers ("03 / GRC", "04 / Schedule", etc.) become derived from actual position instead of hardcoded — so they always match true position after reordering.
- Out of scope: migrating the *existing* content of the 9 sections (Hero copy, GRC details, schedule days, shows list, donation tiers, About prose, Participate cards, Nav/Footer copy) into the new block data model. Those keep reading from their current collections (`station.json`, `grc.json`, `schedule.json`, shows files, `tiers.json`) exactly as today — only their presence/order is now data-driven. Per-instance editable content for the 9 fixed types is a future enhancement, not this pass.
- Out of scope: multiple homepages/pages. This applies only to the single existing homepage (`src/pages/index.astro`).

## Data Model

New file: `src/content/page/home.json`

```json
{
  "blocks": [
    { "type": "nav" },
    { "type": "grcBanner" },
    { "type": "hero" },
    { "type": "grc" },
    { "type": "schedule" },
    { "type": "shows" },
    { "type": "participate" },
    { "type": "donate" },
    { "type": "about" },
    { "type": "footer" }
  ]
}
```

Seeded with the current 9 sections in their current order, so the live site is visually unchanged until an editor changes it.

Block type catalog:

| `type` | Kind | Data source |
|---|---|---|
| `nav` | Fixed section | Computed from `blocks` (see Nav/Footer Links) |
| `grcBanner` | Fixed section | `grc.json` (`bannerText`) |
| `hero` | Fixed section | `station.json` (`tagline`, `heroBody`) |
| `grc` | Fixed section | `grc.json` |
| `schedule` | Fixed section | `schedule.json` |
| `shows` | Fixed section | `src/content/shows/*.json` |
| `participate` | Fixed section | Hardcoded (unchanged) |
| `donate` | Fixed section | `tiers.json` |
| `about` | Fixed section | Hardcoded (unchanged) |
| `footer` | Fixed section | Computed from `blocks` (see Nav/Footer Links) |
| `text` | Flexible block | Inline: `body` (markdown) |
| `quote` | Flexible block | Inline: `text`, `attribution` (optional) |
| `image` | Flexible block | Inline: `image` (upload), `alt`, `caption` (optional) |
| `cta` | Flexible block | Inline: `heading`, `subtext`, `buttonLabel`, `buttonHref` |

Each block in the JSON array carries a `"type"` discriminator (Decap's default `typeKey` for the list widget's `types:` feature). Fixed-type entries carry no other fields. Flexible-type entries carry their own fields directly.

## Decap Config

New collection "Homepage Layout", single file `src/content/page/home.json`, one field `blocks` using `widget: list` with `types:` listing all 14 block types above. Each fixed type gets a single informational field (e.g. a disabled-looking hint) since its real content lives in its own existing collection; each flexible type gets its real fields (markdown/string/image as appropriate, using the same markdown widget + button set already configured for Text).

This gives editors an "Add" dropdown with all 14 types, drag-handles to reorder, and a delete control per block — native Decap list-widget behavior, no custom UI code required.

## Astro Rendering

`index.astro`:
1. Imports `home.json`, plus the same per-collection imports it already has (`station`, `grc`, `schedule`, shows glob, `tiers`).
2. Holds a `type → component` registry mapping each of the 14 types to its Astro component.
3. Maps over `home.blocks`, rendering each via the registry, passing whatever props that component already expects (unchanged for the 9 existing components — they don't know this system exists).
4. Computes `navLinks` once via a small static lookup (`NAV_META`: type → `{ href, label }`) covering the 7 anchor-able section types (`hero`, `grc`, `schedule`, `shows`, `participate`, `donate`, `about`), filtered/mapped against `home.blocks` in order. Passes `navLinks` into `Nav` and `Footer`.
5. Computes section numbers via a similar lookup (`SECTION_NUM_META`: type → display label, e.g. `grc` → `"GRC"`) covering the 6 currently-numbered types (`grc`, `schedule`, `shows`, `participate`, `donate`, `about`). Numbering starts at `01` for the first numbered block encountered in `home.blocks`, incrementing per numbered block in actual order — replacing today's hardcoded `"03 / GRC"`-style strings. (This changes the starting number from the current ad-hoc `03` to `01`; flagged here since it's a visible, if minor, change from current hardcoded text.)

## Component Changes

- **Nav.astro**, **Footer.astro**: drop hardcoded link arrays; accept `links: {href, label}[]` prop instead.
- **GRC / Schedule / Shows / Participate / About / Donate sections**: currently inline markup in `index.astro`, not separate components. Each gets extracted into its own `.astro` component (e.g. `GRCSection.astro`, `ScheduleSection.astro`, …) so the block registry can render them independently. Each accepts a `number` prop (replacing its hardcoded `section__num` text) instead of hardcoding its position label.
- **New components**: `TextBlock.astro`, `QuoteBlock.astro`, `ImageCaptionBlock.astro`, `CTABanner.astro` — small, single-purpose, styled to match existing section conventions (BEM, design tokens from `global.css`).

## Error Handling

- If `home.json` is missing/malformed at build time, the build fails loudly (static site, no runtime fallback needed/wanted — better to catch a bad CMS edit at build time than ship a broken page).
- Unknown `type` values in `blocks` (e.g. from a future Decap type added without a matching Astro component) are skipped with a build-time console warning rather than crashing the build, so a typo in config doesn't take the whole site down.

## Testing

No existing test suite in this project (static Astro site, build-as-verification). Verification for this work:
1. `npm run build` succeeds.
2. Built `dist/index.html` contains all 9 default sections in original order (visual no-op confirmation).
3. Manually reorder/hide a block in `home.json`, rebuild, confirm output reflects the change (order, nav links, section numbers all update consistently).
4. Add one instance of each new flexible block type, rebuild, confirm each renders.
