# Dr. FixBoi®’s Clay Visualizer

Preview clay 3D prints from G-code in a ’90s-inspired browser lab. [Open the live visualizer](https://heyvian.github.io/dr-fixboi-clay-visualizer/)

**Made by Vian Esterhuizen.** Vian supplied the concept, feature ideas, and design direction. OpenAI Codex in ChatGPT implemented Vian’s specifications.

## What the app does

- **Load and inspect G-code.** Start with the built-in sample vase or drop in a file up to 25 MB. Orbit and zoom the model to examine individual beads. The parser handles linear moves, XY arcs, absolute and relative coordinates and extrusion, inch and millimeter units, coordinate resets, and M101/M103-style extrusion. It can infer deposition from horizontal print moves when extrusion commands are absent.
- **Check print placement.** The app flags unexpected first layers, below-bed deposition, skipped arcs, and inferred extrusion. When the center of the deposited toolpath’s XY bounds is more than 50 mm from `X0 Y0`, a **High Alert** with a rotating beacon frames the viewport. A red ring around the print has an 8 mm gap from its widest radial extent and a 10 mm band. The arrow extends from the ring and points toward `X0 Y0`. Its label shows the full center-to-origin distance, including when the origin is off-screen. In Render, the marking tints the canvas weave.
- **Adjust deposition.** The default nozzle is 4 mm. The viscosity slider ranges from runny to stiff and changes bead shape and mobility. The gravity switch enables or disables sag and compression. **Fast**, the default, estimates gravity effects from nearby support and unsupported span length. **Accurate** uses finer deposition samples, extrusion amounts where available, contact with earlier beads, lateral spreading, and yield-stress flow along the bead. **VIC** adds experimental failure analysis and a replay.
- **Measure and compare firing.** **Dimensions** labels length, width, and height in the viewport. Choose a clay body to compare estimated greenware and unglazed cone 6 oxidation finishes. The size table compares printed and fired measurements. **Shrinkage overlay** shows a ghost of the as-printed vessel around the fired model and labels both sets of dimensions.
- **Render the finish.** **Render** adds textured clay and a canvas work surface with a sponge, double-ended trimming tool, and 30 cm ruler at real-world scale. Use **Studio view** to frame the vessel and props. High render quality adds sampled softbox shadows, accent lights from varied angles, and finer color, roughness, and normal detail. Render quality is independent of simulation quality.
- **Keep files and settings local.** A browser worker reads and simulates G-code on your device. The browser remembers settings locally. The preview requires WebGL 2.

## VIC · Experimental

**Viscoplastic Instability & Collapse** follows the deposition order and estimates where freshly printed clay loses support. Select **VIC** with gravity on. **Hotspots** colors the original toolpath by the number of material cases that fail at each sampled bead section. **Demonstrate** plays one labeled case, with a scrubber for examining the first yield, torn joints, falling clumps, and surviving sections. **Load overhang sample** loads a deliberately unsupported wall.

- The solver estimates bead footprints, finds contact with earlier deposits, and transfers self-weight through those contacts. It tests compression, eccentric loading at overhangs, and the bending and sag of supported spans and cantilevers. Span deflection grows approximately with the fourth power of span length. [Clay paste rheology and printability](https://doi.org/10.1016/j.addma.2020.101335) [Experimental study of spanning filaments](https://doi.org/10.1021/la0257135)
- VIC uses G-code feed rates and dwell commands to estimate bead age, with a 25 mm/s default feed where timing is absent. The model uses an assumed wet density of 1,850 kg/m³ and a viscosity slider that changes both yield stress and stiffness. The nominal initial yield stress ranges from 610 to 6,710 Pa and the nominal elastic modulus from 6.5 to 116.5 kPa. The solver approximates recovery after extrusion with a saturating age term. These are exploratory defaults. [Time-dependent ceramic ink rheology](https://www.nature.com/articles/s41598-017-06115-0)
- The seven cases range from 56% to 165% of the nominal yield stress and stiffness. A hotspot with 7/7 agreement failed in every case under those assumptions. The agreement is a sensitivity check, and its calibration for real prints is unknown. If the nominal case holds but a softer one fails, the demo selects the closest softer case that failed and names it in the player.
- VIC targets roughly a quarter-nozzle-diameter sample spacing, with a cap on complexity for longer files. It uses 48 deposition checkpoints, finer overload and tear timing, and 84 frames for the compressed replay. Falling sections can stretch, lose bonds, slide against surviving clay, stack on debris, and flatten on impact. A shear-thinning flux transfers volume between connected bead sections. The replay uses the selected body's greenware color and shows the new faces of torn beads. The underlying model still approximates contact and flow. The behavior of a particular clay batch depends on measured rheology and comparison with physical prints. [Measured clay recovery and solidity](https://doi.org/10.1016/j.addma.2020.101335) [Clay overhang experiments](https://www.sciencedirect.com/science/article/abs/pii/S235271022502995X)

## Clay presets and shrinkage sources

PSH Dark Granite is the default and uses PSH’s published 12.5% total cone 6 shrinkage. The Plainsman presets apply the midpoints of each published wet-to-dry and dry-to-fired shrinkage range in sequence. The pictured finishes and dimensions are estimates. [PSH Dark Granite](https://psh.ca/products/20kg-psh-dark-granite-clay-cone-6) · [Plainsman M340](https://www.plainsmanclays.com/product/m340/) · [M340S](https://www.plainsmanclays.com/product/m340s/) · [M370](https://www.plainsmanclays.com/product/m370-2/) · [M390](https://www.plainsmanclays.com/product/m390/) · [Polar Ice](https://www.plainsmanclays.com/product/polarice/)

## Libraries and type credits

- Three.js and its add-ons power the WebGL scene, orbit controls, lighting, materials, and geometry utilities. [Three.js](https://threejs.org/) · [MIT license](pages-assets/licenses/three.txt)
- Vite builds the static site and bundles the simulation worker. [Vite](https://vite.dev/) · [MIT license](https://github.com/vitejs/vite/blob/main/LICENSE.md)
- Fontsource packages the fonts for local serving. Archivo Black is by the Archivo Black Project Authors (Omnibus-Type), DM Sans by the DM Sans Project Authors, and IBM Plex Mono by IBM. [Fontsource](https://fontsource.org/) · SIL Open Font License 1.1 for [Archivo Black](pages-assets/licenses/archivo-black.txt), [DM Sans](pages-assets/licenses/dm-sans.txt), and [IBM Plex Mono](pages-assets/licenses/ibm-plex-mono.txt)
- GitHub Pages hosts the app and GitHub Actions checks that the published files match the source build. See the lockfile for the full dependency inventory. [Pages workflow](.github/workflows/pages.yml) · [Package lockfile](package-lock.json)

## Run locally

Use Node.js 24 or another version supported by Vite.

```sh
npm ci
npm run dev
```

Run `npm test` for the G-code and simulation checks and `npm run build` to generate the static site in `dist/`.

## GitHub Pages

GitHub Pages serves the built app from the root of the `main` branch. Run `npm run build:pages` after editing the app and commit the updated `index.html` and `pages-assets/` with your source changes. The workflow verifies the tests and checks that the committed site matches the build.
