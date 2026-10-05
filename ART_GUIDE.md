# Illustrated art guide

The game's illustrated artwork is stored in `client/public/assets/illustrated/`. [ASSET_MANIFEST.json](ASSET_MANIFEST.json) records the supplied files, their roles, the runtime normalization contract and where each image is used.

The current inventory contains **23 supplied PNGs**: 12 playable forms, five enemy types, three environment images and three interactive objects. Each character or object file contains one painted pose. The game supplies movement, breathing, leaning, recoil, lunges and effects through runtime animation.

## Visual direction and growth

Use serious, illustrated science fiction with living forms, sculpted bioceramic surfaces, mineralized armor and contained energy. The station is grown architecture in warm ivory and pale gray, with restrained gold inlays against a muted teal void. Its softly worn, organic construction should remain readable behind the creatures. Characters preserve their lineage-specific dark mineral plates and energy accents. Give each lineage a recognizable silhouette and material language. Lighting comes from the upper left; the fixed elevated three-quarter camera shows fronts and sides.

The four base forms are deliberately small, juvenile organisms. Increasing level grows their displayed presence. Choosing a saved evolution selects a distinct mature illustration, with a stronger silhouette and developed anatomy. The visual scale is independent of the source PNG dimensions and never changes collision, attack reach or server statistics.

| Lineage | Juvenile file | Mature branch files | Identity to preserve |
| --- | --- | --- | --- |
| PYRA | `char_pyra_base.png` | `char_pyra_flare.png`, `char_pyra_furnace.png` | Vented armor, predatory shape and amber plasma. Flare emphasizes crest and released energy; Furnace emphasizes contained heat and protective mass. |
| KRIOS | `char_krios_base.png` | `char_krios_prism.png`, `char_krios_glacier.png` | Cyan channels and crystalline anatomy. Prism emphasizes attached crystalline plates and blade-like growths, with no floating pieces; Glacier emphasizes a dense protective shell. |
| VEKTOR | `char_vektor_base.png` | `char_vektor_tempest.png`, `char_vektor_raptor.png` | Light anatomy, swept fins and pale pressure trails. Tempest emphasizes flowing motion; Raptor emphasizes precise talon forms. |
| LITOS | `char_litos_base.png` | `char_litos_monolith.png`, `char_litos_seismic.png` | Mineral mass, basalt and restrained gold seams. Monolith emphasizes a solid protective silhouette; Seismic emphasizes fissured limbs and striking weight. |

No text, labels, logos, baked interface or scenery belongs in a character cutout. Keep feet, claws, fins, tails and bright energy contours fully inside the image. Let the game draw the ground shadow.

## Runtime asset inventory

All filenames below are relative to `client/public/assets/illustrated/`.

| File or group | Runtime consumer | Source type |
| --- | --- | --- |
| Twelve `char_<lineage>_<form>.png` files above | Laboratory/evolution portraits, player bodies and player HUD portraits | Transparent single-pose illustration |
| `enemy_pursuer.png` | Melee pursuer | Transparent single-pose illustration |
| `enemy_ranged.png` | Telegraphing ranged enemy | Transparent single-pose illustration |
| `enemy_armored.png` | Armored frontliner | Transparent single-pose illustration |
| `enemy_support.png` | Support/spawner | Transparent single-pose illustration |
| `enemy_boss.png` | Mission boss | Transparent single-pose illustration |
| `lobby_background.png` | Laboratory and lobby backdrop | Opaque scenery |
| `arena_background.png` | Battlefield scenery layer | Opaque scenery |
| `floor_texture.png` | Repeated walkable-ground surface | Opaque texture |
| `prop_stabilizer.png` | Stabilizer objective | Transparent single-pose illustration |
| `prop_gateway.png` | Section gateways and extraction | Transparent single-pose illustration |
| `pickup_biocell.png` | Battlefield pickups | Transparent single-pose illustration |

The manifest retains the existing character IDs and `enemy.<kind>.provided` IDs. Environment IDs are `env.lobby`, `env.station_nexus` and `env.floor`. Interactive-object IDs are `prop.stabilizer`, `prop.gateway` and `pickup.biocell`.

## Source image and runtime texture are different sizes

For a `runtime-illustration` entry, these fields have distinct meanings:

| Field | Meaning |
| --- | --- |
| `file` | Original generated PNG at its native dimensions |
| `sourceLayout: "single-image"` and `frameCount: 1` | One complete pose in the file |
| `renderStrategy: "runtime-normalized"` | The client identifies the subject and creates a cached texture |
| `frameWidth: 256`, `frameHeight: 256` | Dimensions of that runtime texture |
| `anchor: { "x": 128, "y": 236 }` | Feet position in the runtime texture |
| `transparent: true` | A real RGBA cutout, with transparent pixels around the subject |

A native 1024 × 1536 or 1000 × 1500 PNG is valid. Its dimensions do not have to divide into 256-pixel frames, and the feet do not have to sit on source row 236. Loading a high-resolution cutout as a sprite sheet would incorrectly divide the character into unrelated tiles.

The client scans a bounded preview, at most 512 pixels on its longest side, and reads visible alpha bounds using **alpha > 16**. It identifies the solid body with **alpha ≥ 128** and estimates the foot position from that body, so a faint glow does not define the feet. The cached 256 × 256 texture is aligned around the runtime anchor. Painted body bounds determine display size, which preserves the intended scale of wide and tall forms.

Cutouts are normalized in the loader before their textures are uploaded to the GPU; the original high-resolution cutouts do not become battlefield GPU textures. Only normalized canvases are retained in the portrait cache after decoding. The source PNG files on disk are not resized, cropped, flattened, recolored or overwritten. The single right-facing pose is mirrored for left-facing display. There are no separate up/down rows, hand-painted animation frames or rigged 3D models in this inventory.

Battle preload selects the fixed party's character forms and their base fallbacks. All twelve forms remain available through the runtime registry and portrait workflow; each battle does not have to preload every evolution.

Props use the same normalized canvas contract. Their horizontal anchor uses the visible bounds' midpoint to keep a two-sided gateway centered; the vertical anchor uses the structural bottom. Placement and display size are set by role, and the pickup may use a centered display origin. The environment renderer composes the native arena and floor sources into map chunks, then releases their raw textures. It mirrors the floor material into a 2 × 2 repeating tile for continuous edges. The arena illustration is scenery, not a pixel-accurate copy of the collision map. The walkable layout remains defined in `shared/src/map.ts`.

## Validation and replacement workflow

1. Generate or edit the intended source image, using the existing form as a reference when continuity matters. Preserve native output size and real transparency for cutouts.
2. Save it at the exact filename in the manifest. A new form needs a matching entry and an actual runtime consumer; an unused concept sheet does not belong in this inventory.
3. Run `npm run assets:validate`. It checks every `provided` source file.
4. Run `node --import tsx --test tests/assets.test.ts` and `npm run build`.
5. Review the image in the laboratory and in battle at phone size. Check the feet, silhouette, left/right mirroring, glow, growth/evolution comparison and readability against both the floor and enemy telegraphs.

To check a native cutout before replacing a supplied file:

```bash
npm run assets:validate -- path/to/character.png --illustration
```

The validator requires:

- A valid PNG; transparent illustrations must be RGBA, PNG color type 6.
- A nonempty subject, including solid body pixels suitable for foot detection.
- At least four source pixels of clear border around pixels with alpha greater than 16. Faint alpha at or below that cutoff does not trigger a false crop error.
- Illustration dimensions of 64–4096 pixels per side.
- A source-file budget of 16 MiB and a decoded-image budget of 16 megapixels.
- Opaque pixels throughout backgrounds and floor textures.
- Valid runtime frame/anchor metadata, unique IDs and source filenames, and actual files at the declared paths.

Source borders, subject visibility and technical format can be checked automatically. Facing, anatomical continuity, texture seams, visual style and the quality of inferred feet still need an in-game review.

The older aligned-sprite validator remains available for maintenance:

```bash
npm run assets:validate -- path/to/aligned-sheet.png --frame 128
```

That mode checks exact frame dimensions, transparent padding and pixel-level feet alignment. It accepts one aligned frame or a legacy 40-column layout, with at most four facing rows. No current supplied asset uses that layout; its validation support does not imply that new multi-frame animation playback is implemented.

## Copyable image prompts

Generate one runtime asset at a time. Each prompt should name its output file and purpose. Keep source images consistent before ordering another form.

### Juvenile base form

> Create a single full-body juvenile [LINEAGE] organism for an original illustrated mobile science-fiction action game. Output purpose: a transparent runtime character cutout for [FILENAME]. This is a small early life stage with simple anatomy, a compact readable body and clear potential to evolve into a much stronger creature. Preserve these lineage cues: [SILHOUETTE, MATERIALS, ENERGY COLOR]. Serious illustrated science fiction, living tissue and mineralized dark ceramic armor, contained elemental energy, deliberate shapes readable at phone size. Face right in a fixed elevated three-quarter view; upper-left lighting. Show the entire body and all feet, claws, fins and tail, surrounded by generous empty transparent margin. One pose, one character, true transparent background. No ground shadow, scenery, text, logos, interface, checkerboard pattern or animation sheet.

### Mature evolution from an existing form

Attach the base form and, when available, the other mature branch as references.

> Create one mature evolution of the referenced [LINEAGE] creature: [EVOLUTION NAME], for [FILENAME]. Preserve the family's anatomy, material language, lighting, camera and right-facing orientation, while clearly developing its size, silhouette and [BRANCH FEATURE]. It must read as the mature form of the small reference creature. Keep the branch distinct from [OTHER BRANCH FEATURE]. Illustrated science fiction with a strong mobile-game silhouette and controlled detail. Output one full-body pose on a true transparent background, with generous transparent space beyond all extremities and energy contours. Keep the feet visible; do not bake in a shadow or floor. No comparison sheet, second character, labels, logos, scenery or UI.

### Enemy

> Create one original unstable-biomass enemy for a serious illustrated science-fiction co-op game. Output purpose: transparent runtime cutout for [FILENAME]. Combat role: [PURSUER / RANGED / ARMORED / SUPPORT-SPAWNER / BOSS]. Its silhouette must communicate that role at phone size: [ROLE-SPECIFIC SHAPE]. Use alien biological structure, corrupted mineral armor and restrained hostile energy accents. The boss should feel mature and imposing; ordinary enemies must remain visually distinct from it and from the player lineages. Fixed elevated three-quarter view facing right, light from the upper left. One complete creature, fully visible feet and appendages, clear transparent margin. True transparent background, no ground shadow, scenery, text, logos or UI.

### Environment layer

> Create an illustrated environment layer for [LOBBY OR ARENA] in an original serious science-fiction mobile action game, output file [FILENAME]. A grown alien station with sculpted bioceramic architecture: warm ivory and pale gray structural surfaces, softly worn organic ribs and arches, restrained gold inlays, and a muted teal void beyond. Preserve the supplied station images' material language and calm, painterly atmosphere. Match their upper-left lighting and fixed elevated oblique camera. Keep the main usable area low in contrast, with broad readable shapes and few distracting highlights. [LOBBY: compose a quiet backdrop with room for character cards and controls.] [ARENA: compose a wide background/scenery layer that can sit behind a separately rendered walkable floor; avoid painting foreground obstacles that imply incorrect collision.] Opaque background. No characters, enemies, pickups, UI, readable lettering, labels or logos.

### Floor texture

> Create a seamless opaque floor texture for the supplied illustrated science-fiction station, output file floor_texture.png. Warm ivory and light gray bioceramic plates grown into a softly worn organic surface, subtle curved joints, muted teal-gray recesses, and fine restrained gold inlays. Match the existing floor's quiet painterly material and pale palette. Keep pattern scale consistent across the image. Low contrast; no dramatic highlights, perspective vanishing point, raised walls, large props, characters, symbols, text or UI. Keep opposite edges visually continuous so repeated tiles do not produce obvious seams.

### Objective or pickup

> Create one isolated illustrated science-fiction [STABILIZER / GATEWAY / BIOCELL] for [FILENAME]. Match the same material language, elevated oblique camera and upper-left lighting as the supplied environment. Make its function legible through silhouette and a restrained energy accent. [DESCRIBE THE OBJECT'S DISTINCTIVE FORM.] Keep the entire object fully inside a generous transparent margin, including its base and glow. True transparent background, no baked ground shadow, scenery, lettering, labels, logos or interface. Output one object, one pose.

## Original files vs. web copies

Full-resolution originals are kept in `art-source/illustrated/`. The game serves smaller copies with the same names from `client/public/assets/illustrated/` (characters, enemies and props are at most 512 px on the longest side, the boss 640 px, backgrounds 1280 px and the floor 768 px). This cuts the download from 35 MB to about 9 MB. The renderer scales each illustration to its own display size, so these copies change sharpness only, not layout.

After adding or replacing an original in `art-source/illustrated/`, run `npm run art:optimize`, then `npm run assets:validate`.

## Frame animations (sprite strips)

The game plays animation strips automatically when they are present:

1. Copy the delivered strips and `animations.json` into `client/public/assets/animations/`. The repository ships an empty `animations.json` (`[]`).
2. Each JSON entry needs `file`, `id` (`pyra_base`, `krios_glacier`, `enemy_pursuer`, `enemy_boss`, …), `animation`, `frames`, `frameWidth`, `frameHeight`, `fps`, `loop`, `anchorX` and `anchorY`.
3. Run `npm run build`. Any form that has an `idle` strip switches from the single illustration to frame animation.

| Form | Animations played |
| --- | --- |
| Heroes | `idle`, `run`, `attack1..3`, `skill1`, `skill2`, `dodge`, `downed` |
| Enemies | `idle`, `move`/`walk`, `windup` (and `sweep_windup`/`strike_cast` for the boss), `attack`/`shoot`/`slam`/`sweep`, `hurt`, `channel`, `stagger`, `roar`, `death` |

Missing animations fall back to the next suitable one. A form without strips keeps its illustration.

## Second boss: Crystal Warden (placeholder is procedural)

The Crystal Warden and its shield pylons are currently drawn in code (`client/src/game/wardenArt.ts`). Copyable prompts for replacement art:

> Single full-body illustration of an original boss creature for a mobile 2.5D co-op action game, transparent background (PNG with alpha), no ground shadow. "Crystal Warden": a massive, slow guardian colossus made of dark basalt plates, with huge pale-cyan crystal spikes on its shoulders and forearms ending in crystal blades. A floating halo of crystal shards hovers behind its head, and a glowing violet energy core sits in its chest. It is serious and ancient, not cute. Facing right, elevated three-quarter view from about 35° above, key light from the upper left. Strong silhouette readable at 160 px tall. Feet fully visible, generous empty margin. No text, no logo.

> Single object illustration on a transparent background: "Crystal pylon", a shield-generating obelisk of pale-cyan crystal rising from a small dark stone base, with smaller crystal shards around it and a glowing violet rune in the centre. Same art style, camera and lighting as the Crystal Warden. Readable at 100 px tall. No text.

Expected files: `art-source/illustrated/enemy_warden.png` and `art-source/illustrated/prop_pylon.png`. They need to be wired into `client/src/game/artwork.ts` (one line each) once delivered. For animation strips, use the ids `enemy_warden` (idle, walk, beam_windup, nova, blink, roar, stagger, death) and `enemy_pylon` (idle, death).
