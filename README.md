# Dr. FixBoi®’s Clay Visualizer

Preview a clay 3D print from G-code in a 90s-inspired browser lab. The app opens with a sample vase. Drop in your own file, orbit the model to examine the beads, and change nozzle diameter, viscosity, or gravity to compare outcomes.

Files are processed in a browser worker and stay on your device. Fast is the default and estimates gravity-driven compression and droop from nearby support and unsupported span length. Accurate uses finer, continuous deposition samples. It uses relative extrusion commands where available and accounts for contact with earlier beads, lateral spreading, and yield-stress flow along the bead. The viscosity slider sets relative mobility and yield stress. Turning gravity off leaves the deposited bead profile visible in both modes.

### VIC · Experimental

**Viscoplastic Instability & Collapse** follows the deposition order and estimates where freshly printed clay loses support. Select **VIC** with gravity on. **Hotspots** colors the original toolpath by the number of material cases that fail at each sampled bead section. **Demonstrate** plays one labeled case, with a scrubber for examining the first yield, torn joints, falling clumps, and surviving sections. **Load overhang sample** loads a deliberately unsupported wall.

- The solver estimates bead footprints, finds contact with earlier deposits, and transfers self-weight through those contacts. It tests compression, eccentric loading at overhangs, and the bending and sag of supported spans and cantilevers. Span deflection grows approximately with the fourth power of span length. [Clay paste rheology and printability](https://doi.org/10.1016/j.addma.2020.101335) [Experimental study of spanning filaments](https://doi.org/10.1021/la0257135)
- VIC uses G-code feed rates and dwell commands to estimate bead age, with a 25 mm/s default feed where timing is absent. The model uses an assumed wet density of 1,850 kg/m³ and a viscosity slider that changes both yield stress and stiffness. The nominal initial yield stress ranges from 610 to 6,710 Pa and the nominal elastic modulus from 6.5 to 116.5 kPa. The solver approximates recovery after extrusion with a saturating age term. These are exploratory defaults. [Time-dependent ceramic ink rheology](https://www.nature.com/articles/s41598-017-06115-0)
- The seven cases range from 56% to 165% of the nominal yield stress and stiffness. A hotspot with 7/7 agreement failed in every case under those assumptions. The agreement is a sensitivity check, and its calibration for real prints is unknown. If the nominal case holds but a softer one fails, the demo selects the closest softer case that failed and names it in the player.
- The replay combines reduced-order bead mechanics, gravity, distance constraints, inelastic contacts, and a shear-thinning flux that transfers volume between connected bead sections. It uses a compressed timeline and coarser spatial and time steps for browser performance. Printer motion errors, true cross-bead flow, drying gradients, humidity, and shell buckling are outside this model. The behavior of a particular clay batch depends on measured rheology and comparison with physical prints. [Measured clay recovery and solidity](https://doi.org/10.1016/j.addma.2020.101335) [Clay overhang experiments](https://www.sciencedirect.com/science/article/abs/pii/S235271022502995X)

Use **Dimensions** to label the model. **Shrinkage overlay** shows a ghost of the as-printed vessel around the fired model and labels both sets of dimensions. **Render** switches on studio lighting and clay and canvas materials. High render quality adds sampled softbox shadows, subtle accent lights, higher-resolution lighting and display, and finer material color, roughness, and normal detail. Render quality is independent of simulation quality.

The material presets show freshly printed greenware and unglazed cone 6 oxidation finishes. PSH Dark Granite is the default and uses PSH's published 12.5% total cone 6 shrinkage. For the Plainsman presets, the Fired stage applies the midpoint of each body's published wet-to-dry and dry-to-fired shrinkage ranges in sequence. Each preset links to the supplier's data. Treat the preview as an estimate and compare it with a sample made from your own clay and firing schedule. The browser saves the chosen settings locally.

The parser supports linear moves, XY-plane arcs, absolute and relative coordinates and extrusion, inch and millimeter units, coordinate resets, and M101/M103-style extrusion. G-code checks flag high starts, deposition below Z0, skipped arcs, and inferred extrusion. The app needs a WebGL 2 browser and accepts files up to 25 MB.

## Run locally

Use Node.js 24 or another version supported by Vite.

```sh
npm ci
npm run dev
```

Run `npm test` for the G-code and simulation checks and `npm run build` to generate the static site in `dist/`.

## GitHub Pages

GitHub Pages serves the built app from the root of the `main` branch. Run `npm run build:pages` after editing the app and commit the updated `index.html` and `pages-assets/` with your source changes. The workflow verifies the tests and checks that the committed site matches the build.
