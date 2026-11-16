# FICSIT Planner

A personal Satisfactory factory planner (game version 1.2.x, recipes unchanged since 1.0).

## Use it

**https://charliejmsanderson.github.io/ficsit-planner/**

Every push to `main` rebuilds and redeploys the site automatically (GitHub Actions → Pages), so the link always has
the latest version.

### Saving

Your factories and unlocked recipes auto-save to [`save.json` on the `saves` branch](../../blob/saves/save.json).
Every browser loads that file when the planner opens. A browser you've connected with a GitHub access key
(*Unlocks & settings → Save & sync*) also writes each change back a few seconds after you make it. The key needs
access to this repo only, with **Contents: Read and write**. It stays in that browser and is never committed.
Saves go to the `saves` branch, so they don't trigger a redeploy. *Save & sync* also has backup export/import.

For offline use, `npm run build` writes a single self-contained file to `dist/index.html`.

## What it does

- Pick outputs (items/min, m³/min for fluids, MW for power), or press **Max** on an output to make as much as your
  inputs allow. See the whole chain as a **network graph**, an
  expandable **tree**, an **items** table and a **buildings & power** list. Split view shows two at once.
- Building counts with **exact clock speeds**, rounded up to 2 decimals (what a PS5 controller can set), plus the
  "n at 100% + 1 at x%" alternative.
- **Optimise for** fewest raw resources, simplest build (fewest steps), fewest buildings, least power, or
  max output from your inputs.
- **Inputs**: set what you have (ore, or parts you already make) and your resource nodes. "Need vs. have"
  shows shortfalls, the limiting input, and how much of your target those inputs can make.
- **Recipes**: standard recipes by default. Alternates you've ticked in *Unlocks* are tested in the background
  and suggested when they help. The **hard drive advisor** ranks alternates you haven't unlocked yet.
- **Byproducts**: if this factory can use one (water, silica…) it asks before reusing it. Otherwise
  "What should I do with it?" lists sink points, recipes that use it, and burning it for power.
- **Somersloop recommendations** ranked by raw resources saved per Somersloop, with one-click apply.
- Power: add generators to power the factory itself, or plan a power plant by adding *Power* as an output.

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # solver tests
npm run build      # writes dist/index.html (single file)
```

Recipe data: `scripts/build_data.py` converts the community-parsed game data
(greeny/SatisfactoryTools `data/data1.0.json`, generated from the game's Docs.json) into `src/data/gamedata.json`.
Somersloop slots, world resource limits and a few unlock tiers come from satisfactory.wiki.gg.
The solver is HiGHS (linear/integer programming) compiled to WebAssembly.
