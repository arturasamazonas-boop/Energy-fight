# Art guide and ChatGPT image workflow

The game runs today on **procedural placeholder art** (`client/src/game/art.ts`). Finished visuals can replace it one asset at a time through [`ASSET_MANIFEST.json`](ASSET_MANIFEST.json), without changing any combat rules.

## Two kinds of images. Do not mix them up.

| Kind | Purpose | Used in game? |
| --- | --- | --- |
| **Concept / portrait** | Decide the look, silhouette, materials and colours | No. Reference only (`role: "concept"`) |
| **Runtime sprite** | Frames the game actually draws | Yes. Must follow the sprite contract below |

A beautiful concept illustration is **not** an animation-ready game character. Generated images do not come with rigs or 3D models. Turning a concept into consistent animation frames needs review and, realistically, manual cleanup or animation work. Until that is done, the placeholder animation stays in use.

## Visual identity (all prompts share this)

- Serious, stylized science fiction. Four engineered living lineages descended from one synthetic organism: living tissue, mineralized armour, dark ceramic surfaces, contained energy channels.
- Fixed oblique camera: elevated about 35°, looking slightly down. Fronts and sides of characters are visible. Key light from the upper left, soft fill, clear contact shadow under the feet.
- Readable at phone size: strong silhouette, limited detail, a high-contrast energy accent. **No text, logos, watermarks or UI.**
- Environments are lower in contrast and saturation than characters, so attacks and enemy telegraphs stay readable.

| Lineage | Silhouette | Palette |
| --- | --- | --- |
| PYRA (fire) | forward-leaning predator, digitigrade legs, vented back armour, tail | dark ceramic brown, amber plasma fissures `#ffad4a` |
| KRIOS (ice) | upright, tall angular crystalline plates, precise stance | slate, pale crystal, cyan channels `#8ff3ff` |
| VEKTOR (wind) | narrow, swept-back fins, light build | dark green-black, pale green/white pressure trails `#d9ffe9` |
| LITOS (earth) | broad, dense, oversized mineral forearms, small head | basalt grey, restrained gold `#e0b85a` |

## Runtime sprite contract

- PNG, RGBA (colour type 6), straight alpha, **transparent background**.
- 128 × 128 frames (boss 256 × 256, small enemies 96 × 96). The feet anchor is at **(64, 118)**: the bottom of the feet sits on that row, horizontally centred.
- Keep at least **4 px transparent padding** in every frame.
- Draw facing **right**. The game mirrors it for left. Optional rows: down (2) and up (3).
- Animation columns in order (from the manifest): `idle 4, run 6, attack1 4, attack2 4, attack3 5, dodge 3, skill1 5, skill2 5, hurt 2, downed 2` = 40 columns. A **single 128 × 128 idle frame** is accepted as an interim replacement. The game then animates it with squash, lean and lunge, like the placeholders.

### Contact-sheet template (one row = one facing)

```
x:   0    128  256  384  512 ... (128 px per column)
     [idle0][idle1][idle2][idle3][run0]…[run5][atk1_0]…[downed1]
feet line ───────────────────────────── y = 118 in every frame
```

### Replacing a placeholder

1. Save the file as `client/public/assets/<file>` (the filename is in the manifest, e.g. `char_pyra_base.png`).
2. Change that entry's `"status"` from `"placeholder"` to `"provided"`.
3. Run `npm run assets:validate`. It checks dimensions, frame counts, alpha, padding and feet alignment. To check a single file: `npm run assets:validate -- path/to/file.png --frame 128`.
4. Run `npm run build` and look at it in game. If a file is missing or fails to load, the game falls back to the procedural art.

---

## Copyable ChatGPT image prompts

Generate these **one at a time**. Do not ask for the entire animated cast in one image.

### 1. Style exploration sheet (concept, opaque background is fine)

> Concept art sheet for an original serious science-fiction co-op action game. Show four related creature-like lineages side by side, full body, same scale, all derived from one synthetic biological organism: living tissue, mineralized armour plates, dark ceramic surfaces and glowing contained energy channels. Left to right: PYRA, a forward-leaning predator with vented back armour and amber plasma fissures; KRIOS, an upright, precise figure with tall angular crystalline plates and pale cyan channels; VEKTOR, a narrow, swept-back figure with flexible fins and pale green-white pressure trails; LITOS, a broad, dense figure with huge mineral forearms, dark basalt and restrained gold highlights. Each must be recognisable by silhouette alone, not just colour. Elevated three-quarter view from about 35 degrees above, key light from the upper left, soft contact shadows. Neutral dark grey studio background. Stylized, readable shapes suitable for small mobile-game characters. No text, no logos, no watermark.

### 2. Base-form character references (one image per lineage, transparent background)

Use this template four times and replace the bracketed part:

> Single full-body character reference for a mobile 2.5D action game, transparent background (PNG with alpha), no shadow on the background. Original serious science-fiction creature: [PYRA – forward-leaning fire predator, digitigrade legs, vented dark ceramic back armour with glowing amber plasma fissures, low head with a short crest, a tail] . Body made of living tissue, mineralized armour and dark ceramic plates with contained energy channels. Facing right, elevated three-quarter view from about 35 degrees above, key light from the upper left. Strong, simple silhouette that stays readable at 80 pixels tall; limited fine detail; one bright energy accent colour. Feet fully visible at the bottom, character centred, with generous empty margin around it. No text, no logo, no weapon props, no background scenery.

The other three bracket texts:

- `KRIOS – upright precise ice figure with tall angular translucent crystal plates, a tall narrow head, a shard-like blade on the forearm, pale cyan energy channels, slate-dark body`
- `VEKTOR – narrow swept-back wind figure with flexible fins on the head and back, slim long limbs, light agile stance, pale green and white pressure-trail accents, dark green-black body`
- `LITOS – broad dense earth figure with oversized mineral forearms like basalt blocks, a small head, short thick legs, dark basalt body with restrained gold seams`

### 3. Evolution comparison for one lineage (first consistency test)

> Side-by-side comparison on a transparent background: the same original sci-fi creature PYRA shown three times at identical scale, pose and camera (facing right, elevated three-quarter view, light from the upper left). Left: base form – forward-leaning predator, vented dark ceramic armour, amber plasma fissures. Middle: evolution FLARE – the same body with a taller crown of flame-like amber crest spikes along the back, brighter fissures. Right: evolution FURNACE – the same body with a heavier chest plate and a glowing circular heat core that suggests a protective shield. Keep proportions, colours and materials identical except the described changes, so it is obvious they are the same creature. No text labels, no logos.

If this comes back consistent, repeat it for KRIOS (PRISM: floating crystal shards; GLACIER: thick ice shell on shoulders and hips), VEKTOR (TEMPEST: extra fins and a spiral wind trail; RAPTOR: white talon blades on the forearms and feet) and LITOS (MONOLITH: a slab-like back plate; SEISMIC: glowing gold cracks on the fists and legs).

### 4. Prototype arena background (opaque, matches the fixed camera)

> Wide side-scrolling game background, 4300 × 500 pixels, for a mobile 2.5D co-op brawler. A damaged research and refinery complex on an alien world, overrun by unstable purple-magenta biomass. Fixed elevated oblique camera (about 35 degrees down), no perspective vanishing toward the horizon: the floor is a flat band seen from above at an angle, with the back wall along the top. Left to right: a narrow entry corridor, a wide arena, a short passage, a second arena with an empty circular platform in the centre (for a stabilizer device), another passage, and a large boss hall ending in an extraction pad. Dark metal floor panels with subtle grid seams, pipes and bulkheads on the back wall, biomass stains and veins. Low contrast and desaturated so characters and effects stand out; consistent light from the upper left. No characters, no text, no UI, no logos.

Background alignment: ground y 0–600 maps to screen y 0–372 (depth scale 0.62). The image's top 110 px is the back wall; the floor starts at y ≈ 110. Expect to adjust the generated image by hand to match the walkable layout in `shared/src/map.ts`.

---

## Recommended next request

Start with **prompt 2 for PYRA** (base form, transparent background). If its silhouette reads well at phone size, convert it into a single 128 × 128 idle frame (feet on row 118, 4 px padding), save it as `client/public/assets/char_pyra_base.png`, set `char.pyra.base` to `provided` and validate. Then run prompt 3 to test whether ChatGPT keeps the evolution forms consistent before ordering the other lineages.
