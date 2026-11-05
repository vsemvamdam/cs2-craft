# Pattern data: sources and licenses

All files in this folder are dependency-free TypeScript. No third-party code or data files are
bundled except the ported algorithm in `fade.ts` (MIT, header kept). Seed lists are plain facts
(numbers) collected from public pages; each list in `data.ts` names its sources.

## Code

| What | Source | License | Used for |
|---|---|---|---|
| Fade % algorithm | [chescos/csgo-fade-percentage-calculator](https://github.com/chescos/csgo-fade-percentage-calculator) v2.0.0 (npm tarball + repo commit `fd02dd1`) | MIT, © 2022 chescos | Ported into `fade.ts`. The MIT notice is reproduced in the file header |
| Valve uniform RNG | [Step7750/UniformRandom](https://github.com/Step7750/UniformRandom) (via chescos' TS port) | No license file in repo; chescos credits it in his MIT package | Algorithm reference only. The code in `fade.ts` comes from chescos' MIT port |

Verification: `/tmp/claude-0/patterns-research/check.mjs` (outside the project) compiles this
module and compares `getFadePercentage` with the original library for every seed of every
supported weapon (34,034 pairs, exact equality of `percentage` and `ranking`), plus the
repo's jest test values and its pre-generated JSON. That JSON is older: percentages match,
rankings are off by ±1 for knives because the JSON has no seed 1000.

## Game data (paint indexes, rarities, Russian names)

| What | Source | License |
|---|---|---|
| Weapons that have each finish | [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) `public/api/en/skins.json` | MIT, © 2023 ByMykel |
| Official Russian finish names (`PaintKit_*_Tag`) and knife names | `static/csgo_russian.json` + `static/items_game.json` in [ByMykel/counter-strike-file-tracker](https://github.com/ByMykel/counter-strike-file-tracker) | MIT, © 2025 ByMykel (game strings © Valve) |
| Doppler/Gamma paint indexes, paint-kit rarity tiers (`mythical`/`legendary`/`ancient`) | `game/csgo/pak01_dir/scripts/items/items_game.txt` in [SteamDatabase/GameTracking-CS2](https://github.com/SteamDatabase/GameTracking-CS2) | Valve game files (facts only, nothing copied) |
| Paint index → phase map (cross-check) | [csfloat/extension](https://github.com/csfloat/extension) `src/lib/utils/dopplers.ts` | MIT, © 2026 CSFloat Inc. |

## Seed-list cross-check datasets (read, not copied)

| Dataset | License | How it was used |
|---|---|---|
| [csfloat/extension `data/bluegem.json`](https://github.com/csfloat/extension/blob/master/data/bluegem.json) (generated from bluegem.app) | MIT (repo) | Ranked each item's seeds by `playside_blue` and confirmed that published Case Hardened tier-1 seeds rank near the top |
| [gergelyszabo94/csgo-trader-extension `patterns.js`](https://github.com/gergelyszabo94/csgo-trader-extension/blob/master/extension/src/utils/static/patterns.js) | **GPL-3.0** | Independent comparison only. No code or data structure copied. Seed numbers are kept only where a non-GPL web source publishes the same list |

## Web sources (seed lists, odds, descriptions)

Case Hardened:
- https://csgoskins.gg/blog/ak-47-case-hardened-blue-gem-seed-patterns
- https://csgoskins.gg/blog/five-seven-case-hardened-blue-gem-seed-patterns
- https://csgoskins.gg/blog/karambit-case-hardened-blue-gem-seed-patterns
- https://csgoskins.gg/blog/butterfly-knife-case-hardened-blue-gem-seed-patterns
- https://csgoskins.gg/blog/flip-knife-case-hardened-blue-gem-seed-patterns
- https://csgoskins.gg/blog/bayonet-case-hardened-blue-gem-seed-patterns
- https://csgoskins.gg/blog/m9-bayonet-case-hardened-blue-gem-seed-patterns
- https://csdb.gg/ak-47-case-hardened-blue-gem-seed-patterns
- https://csdb.gg/blue-gem/five-seven/
- https://csdb.gg/blue-gem/karambit/
- https://csdb.gg/blue-gem/m9-bayonet/
- https://sellyourskins.com/blog/?p=4073 (Karambit)
- https://sellyourskins.com/blog/?p=4075 (M9 Bayonet)
- https://profilerr.net/butterfly-case-hardened-blue-gem-patterns/
- https://profilerr.net/bayonet-case-hardened-blue-gem-patterns/
- https://www.steamdb.com/en/skins/cs2/patterns/case-hardened/ak-47 (credits CSGOSKINS.GG; not counted as independent)

Marble Fade:
- https://csgoskins.gg/blog/karambit-marble-fade-fire-and-ice-seed-patterns
- https://csgoskins.gg/blog/bayonet-marble-fade-fire-and-ice-seed-patterns
- https://csgoskins.gg/blog/flip-knife-marble-fade-fire-and-ice-seed-patterns
- https://csgoskins.gg/blog/gut-knife-marble-fade-fire-and-ice-seed-patterns
- https://csdb.gg/gut-knife-marble-fade-fire-and-ice-seed-patterns
- https://skin.land/blog/bayonet-marble-fade-patterns-guide/
- https://skin.land/blog/best-m9-bayonet-marble-fade-patterns/
- https://profilerr.net/karambit-fire-and-ice-iconic-cs2-knife-skin/
- https://steamdb.com/en/skins/cs2/patterns/marble-fade

Doppler / Gamma Doppler (descriptions and approximate odds; Valve publishes no phase odds):
- https://steamdb.com/en/articles/cs2-doppler-phases-guide (phase = paint index, not seed; colours)
- https://www.steamanalyst.com/guides/doppler-phases (gems "around 1–2% each", Black Pearl "approximately 1%")
- https://key-drop.com/blog/doppler-phases-cs2/ (Phase 1–4 "around 90%")
- https://skins.cash/blog/doppler-phases-cs2/ ("Valve has never published a Doppler phase split")
- https://steamcommunity.com/sharedfiles/filedetails/?id=431724158 (legendary < 10%, Black Pearl ~1%)
- https://profilerr.net/csgo-doppler-phases-all-you-need-to-know/
- https://skin.land/blog/all-gamma-doppler-phases-in-csgo-cs2/ (Gamma colours)
- https://cs2floatchecker.com/blog/doppler-phases-guide (outlier: Ruby/Sapphire ~0.1%, Black Pearl ~0.05%; uncited)

Crimson Web / Slaughter (explanations only, no seed lists shipped):
- https://steamdb.com/en/skins/cs2/patterns/crimson-web
- https://www.steamanalyst.com/guides/slaughter-pattern

Fade % platform note: the chescos README lists the sites that use this algorithm
(CSFloat, Skinport, CSGOSKINS.GG, …) and those that do not (BUFF163, CS.MONEY, …).

## Deliberately left out (could not confirm in ≥2 independent sources)

- Case Hardened tier 2+ for most knives, Five-SeveN tier 2+, MAC-10, the other knives, gold-gem lists.
- Marble Fade 4th–10th max and Fake FI lists (sources disagree, and the GPL dataset labels many of these seeds differently).
- Gut Knife 3rd max. M9 Bayonet "Max Red Tip" seeds that only one source lists.
- Heat Treated, Crimson Web and Slaughter seed lists (single-source or per-site only). The M9 triple-web list on steamdb.com is single-source.
- Per-phase odds for Gamma Doppler, and any official odds.
- Amber/Acid Fade are included because the same MIT algorithm supports them. Fade gloves and Marble Fade have no fade %.
