# ScoreGame Brand Assets

## Canonical Identity

- Product name: `ScoreGame`.
- Official social handle and link slug: `@scoregameee`.
- Canonical logo: the original stylized `SG` mark supplied by the project owner on 2026-07-21.
- The mark uses a bright blue gradient, a light white/cream outline and glow, and a light underline that curves upward on the right.
- The original composition is centered on a square black background with generous negative space.

## Usage Rules

- Use the canonical blue `SG` logo in product and social-media materials.
- Do not redraw, reshape, rotate, recolor, crop tightly, or replace the mark with generated lettering.
- Preserve the original proportions, outline, glow, underline, and black background unless the project owner explicitly approves a derivative.
- Orange `SG` artwork is a campaign draft, not the canonical ScoreGame logo.
- Future posters must use the supplied original asset, not an AI approximation.

## Source Asset

The image supplied by the project owner from `score-game.jpg` on 2026-07-21 is the visual source of truth. The binary master is stored without recompression at:

`social-media/brand/scoregame-logo-original.jpg`

Master properties: `2084 × 2084`, JPEG, SHA-256 `A639BBA5488328C8B205BFACD1FCCF0EDD29BC8328BF55F023CC340070E1A715`.

Use this file as the source for final brand materials. Any PNG or transparent-background versions must be derived from this master without altering the logo design.

## Working Copy (2026-08-05)

The master above is not present on every machine (`social-media/` is gitignored). A downscaled but otherwise identical copy of the same canonical mark is available at:

`social-media/brand/score-game2.jpg` — `1262 × 1262`, JPEG, SHA-256 `C36CE67752FB0EB2799ACFB2BBDD31C24D744DE0438134C5213CD75302E8FAD4`.

This is a **working copy, not the master**: same design, half the resolution. Approved by the project owner on 2026-08-05 for launch social materials — sufficient for Telegram posts, 1080×1080 Instagram, avatars, and 1080×1920 vertical video. Do not rename it to the master's filename, and do not use it for print or any output above 1262 px; fetch the 2084 px master for those.

## Per-Theme Masters (2026-08-08)

The project owner pinned one transparent PNG master per Telegram theme. These are the sources of truth for anything laid out on a matching background, and for the in-app masks:

| Theme | Master | Size | Source URL | SHA-256 |
|---|---|---|---|---|
| dark | `social-media/brand/scoregame-logo-dark.png` | `1262 × 1262` (mark bbox `1055 × 516`) | `res.cloudinary.com/donovs08g/image/upload/v1785873920/score-game2_dxh7eo.png` | `20EED3F3E412BCB3C950271151F4EAC1B8C6F5815723C5B2FADF194CE8040B0D` |
| light | `social-media/brand/scoregame-logo-light.png` | `1145 × 667` (mark bbox `1055 × 516`) | `res.cloudinary.com/donovs08g/image/upload/v1786209871/56_qdp5u0.png` | `C7B133D5B4A02828C9E16EF9BD0CD40D98113A36BF391307DB2578536A1912A5` |

Same geometry in both — the light mark is a recolor, not a redraw. Dark: cream outline and underline around thick blue letter bodies, with gradients. Light: a flat single-color silhouette, exactly one color (`#0561FE`) across the whole mark, no outline and no gradient.

Two earlier light drafts were rejected by the project owner on 2026-08-08 — `scorelight_dglkua.png` (near-white bodies, read as an empty outline at header size) and `svetl_logo_inn4e5.png` (navy bodies under a bright blue outline). All three share the same bbox and geometry.

`social-media/brand/scoregame-logo-transparent.png` is an older cut of the dark master — same artwork, slightly different edge alpha. Prefer `scoregame-logo-dark.png`.

### In-app masks

`web/app/components/ui/BrandLogo.tsx` renders both marks from PNG alpha masks filled with color, so the accent layer is painted with `--tg-button` and follows the user's Telegram accent:

| Theme | Masks | Fill |
|---|---|---|
| dark | `web/public/sg-logo-cream.png` (outline + underline), `web/public/sg-logo-blue.png` (letter bodies) | cream `#fff3d9` behind `--tg-button` |
| light | `web/public/sg-logo-light.png` (whole silhouette) | `--tg-button` |

All masks share a `320 × 157` canvas cropped to the mark bbox, so the two variants sit identically in the header. The light mark is flat, so its mask is just the master's alpha channel. The dark pair was split by lightness, which preserves the thin pale contour lines inside the letters — **do not re-cut it by blueness**; verified 2026-08-08 against the dark master that a blueness re-cut tracks the artwork worse.

Never edit masks by hand — regenerate them from the masters above if the artwork changes.
