# Perago Design System

**Status:** Active. The user supplied Perago's design direction on 2026-09-19 and authorized interface work; the earlier UI hold is lifted for `apps/web`.
**Machine-readable source:** [`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css). This document explains the tokens; the CSS defines them. If the two disagree, the CSS wins and this document is corrected in the same change.
**Scope:** `apps/web` only. Contracts, API, and executor surfaces are unaffected.

## 1. What this system is for

Perago's public surface has one job: make bounded authority legible to a reader who has never heard of a Task Mandate, and do it without claiming anything the contracts do not enforce.

Three rules govern every decision below.

1. **The interface is the product's argument.** The page shows limits, reason codes, and receipts. It does not promise safety it cannot prove.
2. **One world, one convention.** When a second pattern appears beside an existing one, the second one is removed.
3. **Illustrative values are labeled.** Example addresses, blocks, and amounts carry a visible note that they are illustrative; field names are real because they come from the contract surface.

### Provenance

- Visual language: derived from the user-supplied reference (`reference/perago-reference.mp4`): full-bleed Swiss grid, hairline rules, one saturated accent, editorial display scale.
- Product language: from [`PRD.md`](PRD.md) and [`technical/SMART-CONTRACT.md`](technical/SMART-CONTRACT.md).
- Brand marks: `apps/web/public/brand/`, supplied by the user.
- No reference product's flow, route, copy, or asset is reused.

## 2. Palette

Surfaces are three, and they are reused everywhere.

| Token | Value | Role |
| --- | --- | --- |
| `paper` | `#f4f5f2` | Default light surface |
| `ink` | `#0c120e` | Dark surface, primary text on paper |
| `panel` | `#131b16` | Raised block inside `ink` |
| `fog` | `#525a54` | Secondary text on paper |
| `rule` | `#ccd1c8` | Hairline on paper |
| `ruleinvert` | `#2b352f` | Hairline on ink |
| `signal` | `#00d0c0` | Brand mark teal. Fills, rules, graphic marks, and text on dark only |
| `signal-ink` | `#077d74` | The same accent darkened for text on paper |
| `phos` | `#34d399` | Terminal text inside dark panels |
| `statusok` | `#34d399` | `SUCCEEDED`, verification pass |
| `statuspending` | `#fbbf24` | In-flight or awaiting-signature state |
| `statusfail` | `#f87171` | `FAILED`, `EXPIRED`, `REVOKED` |

**Measured contrast** (WCAG ratio, computed from the values above):

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `fog` on `paper` | 6.51 | AA for body text |
| `signal-ink` on `paper` | 4.57 | AA for small text |
| `signal` on `paper` | 1.78 | Decorative only, never text |
| `ink` on `signal` | 9.73 | AA, used for the closing block |
| `signal` on `ink` | 9.73 | AA for labels and marks |
| `phos` on `ink` | 9.85 | AA |
| `statusfail` on `ink` | 6.85 | AA |
| `paper/45` on `ink` | 3.92 | Disclaimed footnotes only |

Accent discipline: `signal` is the only saturated color in the system. It appears as fills, 1px rules, 2px status squares, and text on dark. A new section may not introduce a second accent.

## 3. Typography

| Face | Token | Loaded as | Role |
| --- | --- | --- | --- |
| Archivo | `--font-archivo` | `next/font/google`, variable | Display and body |
| JetBrains Mono | `--font-jetbrains` | `next/font/google`, variable | Machine facts: labels, addresses, statuses, the clock |

Archivo is a neutral grotesque with tight apertures, which is what the reference direction calls for at display scale. JetBrains Mono is reserved for values a machine produced or consumes. Prose is never set in mono, and mono is never used as decoration.

**Scale in use**

| Element | Classes |
| --- | --- |
| Hero headline | `text-[clamp(3.2rem,8.4vw,7.75rem)] leading-[0.94] tracking-[-0.03em] font-semibold` |
| Section heading | `text-4xl md:text-6xl tracking-[-0.03em] font-semibold` |
| Body | `text-lg leading-relaxed`, measure held near `max-w-[42ch]` to `max-w-[60ch]` |
| Mono label | `font-mono text-[11px] uppercase tracking-[0.16em]` |
| Mono data | `font-mono text-[13px] leading-loose` |

Tracking stops at `-0.03em`. Headings are sentence case. No text is set in a system font.

## 4. Layout

- **Full bleed.** Sections span the viewport. There is no centered maximum-width container; a fixed container leaves dead gutters on wide displays and breaks the grid.
- **Rails.** Structure is expressed with 1px rules (`rule` on paper, `ruleinvert` on ink) and filled blocks (`ink`, `panel`, `signal`). Cells carry `border-l` and `border-t`.
- **Grids in use.** `md:grid-cols-12` for split sections (hero, mandate anatomy), `md:grid-cols-4` for the lifecycle bento where one cell spans two rows, `grid-cols-2` for the failure gallery. A grid is filled completely; an empty trailing cell means the composition is wrong.
- **Radius is zero.** Nothing is rounded. Pills, chips, and rounded cards are out of the system.
- **Elevation is a border, never a shadow.** A rule and a shadow on the same element is a defect.
- **Cell padding.** `p-6 md:p-8` in bento cells, `px-6 py-16 md:px-10` in full-width sections, so text never touches a rail.
- **Section order is the reading order.** Promise, constraints, lifecycle, signed object, failure honesty, proof, action.

## 5. Motion

Motion is functional. It shows state, entrance, and continuity. It never decorates a financial value.

Two libraries, two lanes.

- **Motion for React (`motion/react`)** owns component state, entrances, and hover feedback. Never import `framer-motion`.
- **GSAP** is available for scroll-scrubbed timeline orchestration. No timeline exists yet; when one is added it is authored once for a single section rather than spread as per-element effects.

**Easing and duration tokens**

| Token | Value |
| --- | --- |
| `--ease-out-vivid` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--ease-inout-vivid` | `cubic-bezier(0.77, 0, 0.175, 1)` |
| `pressable` utility | 220ms, all interactive color, border, and transform changes |
| `arrow` utility | 260ms, arrow travel on group hover |

**Authored moments**

| Moment | Definition |
| --- | --- |
| Hero headline | Three lines, each masked in `overflow-hidden`, translating from `112%` to `0%` over 950ms with a 110ms stagger |
| Section entrance | `RiseIn` (750ms, `y: 26` to `0`, `blur(6px)` to `0`) or `Unveil` (850ms, `clip-path` inset reveal). Fires once per element at `-12%` viewport margin |
| Lifecycle sequence | The hero log replays seven phases, with 420ms for each RUN state and 200ms to settle, then holds the verified outcome before resetting |
| Marquee | 36s linear, duplicated track translating `-50%`, paused on hover |
| Status squares | `animate-blink` at 1.06s, `steps(2, start)` |

**Reduced motion.** Server and client render the same entrance markup; a CSS media query forces every `[data-reveal]` element visible and removes its transform, blur, and clip. This also prevents hidden server-rendered content when hydration is delayed. `useReducedMotion` disables the hero log replay after hydration. The marquee uses `motion-safe:` and active press scale is disabled. The content is identical, only the movement is absent.

**No JavaScript.** Entrance animations ship their start state inline, so the layout carries a `noscript` rule that resets `opacity`, `transform`, `clip-path`, and `filter` on every `[data-reveal]` element. Verified: the page renders 5,378 characters of visible text with scripting disabled.

## 6. Components

| File | Role |
| --- | --- |
| `src/app/globals.css` | Tokens, `pressable`/`arrow` utilities, `dither`, `rain`, browser-chrome theming |
| `src/app/layout.tsx` | Fonts, metadata, `noscript` reveal override |
| `src/app/page.tsx` | Section order and nothing else |
| `src/components/brand/wordmark.tsx` | The lockup: mark image plus a typographic wordmark, themed per surface |
| `src/components/chrome/top-bar.tsx` | Fixed 64px strip: rail, cell nav, clock cell, action cell |
| `src/components/chrome/utc-clock.tsx` | Client island that reports the current UTC time |
| `src/components/chrome/footer.tsx` | In-flow footer: mark, anchor row with underline draws, release facts |
| `src/components/motion/reveal.tsx` | `RiseIn` and `Unveil`, the only entrance primitives |
| `src/components/primitives.tsx` | `ChainTag`, `Caption` |
| `src/components/rail.tsx` | Column rail primitive |
| `src/components/sections/*` | One file per section, each owning one layout family |

Rules: a section is a server component unless it animates, then the animated leaf carries `"use client"`. A repeated pattern is extracted into a shared component instead of restyled. No component library is installed; shadcn/ui was deliberately not initialized because its tokens and defaults would introduce a second convention beside this system.

## 7. Copy

Copy states what the deployed contracts enforce.

- A mandate is revocable while authorized. Once execution begins it runs to its terminal state. "Revocable anytime" is false and is never written.
- Every terminal state is shown with its reason code and its plain sentence (`PRD-F-016`).
- Illustrative values are labeled as illustrative.
- No testimonial, logo wall, metric, or benchmark appears unless it is a verified fact. None do, so none are shown.
- No em dashes or en dashes. No marketing superlatives. Active voice, concrete nouns.

## 8. Accessibility

- Contrast is measured, not assumed. The table in section 2 is the evidence, and a token change requires it to be recomputed.
- `:focus-visible` is a 2px `signal` outline on paper and a 2px `phos` outline inside `.on-dark`, offset by 2px.
- Landmarks: `header`, `nav[aria-label]`, `main`, `footer`, `section[aria-label]` where the section is a list.
- Decorative arrows, status squares, and the mark carry `aria-hidden` or `alt=""`; the enclosing link or heading carries the accessible name.
- Status is never carried by color alone: every status also has its word.
- Keyboard order follows DOM order; there are no focus traps and no hover-only controls.

## 9. Assets and provenance

| File | Origin |
| --- | --- |
| `brand/icon-no-bg.png`, `brand/primary-no-bg.png` | User-supplied marks on transparent canvases |
| `brand/icon-bg.png`, `brand/primary-bg.png` | User-supplied marks on the dark character-rain backdrop |
| `brand/icon-mark.png` | Tight crop of `icon-no-bg.png`, trimmed to the alpha bounding box with a 16px pad |
| `brand/primary-mark.png` | Tight crop of `primary-no-bg.png`, same method |

The PNG wordmark is white, so it disappears on paper. The header and footer therefore use the `Wordmark` component: the mark image plus the word "Perago" set in Archivo. The rain texture behind dark panels is CSS gradients, not a raster. No generated imagery is used, and no third-party stock asset is included.

## 10. Deliberately absent

- Component library defaults, icon-font glyphs standing in for icons, and any second radius or palette.
- A dark/light toggle. One world is committed; a theme switch would double the contrast work for no gain.
- A fixed reveal footer. It followed the viewport and covered content, so the footer is in flow.
- A preloader, a cursor effect, scroll hijacking, and parallax on text.
- Testimonials, client logos, and outcome statistics that cannot be verified.

## 11. Verification record

- `pnpm --filter @perago/web build` compiled and prerendered `/`, `/app`, and `/faucet`; `pnpm run check` completed the workspace typecheck and tests.
- Rendered with scripting disabled: content visible, no hidden sections.
- Desktop and mobile browser captures at 1440px and 390px found no horizontal overflow. Reduced-motion captures exposed all 30 landing reveal elements without hydration errors after the stable-markup cutover.

## 12. Changing this system

1. Reuse an existing token, primitive, or section convention. Adding a parallel one is the failure mode this document exists to prevent.
2. A new section owns a layout family the page does not already use, and fills its grid.
3. New claims must be traceable to `PRD.md`, `technical/SMART-CONTRACT.md`, or observed chain evidence, or they are removed.
4. Any token change recomputes the contrast table above.
5. Verify with a production build plus a browser check at a narrow and a wide viewport before the change is called done.
