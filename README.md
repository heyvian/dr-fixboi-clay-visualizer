# Dr. FixBoi®’s Clay Visualizer

Preview a clay 3D print from G-code in a 90s-inspired browser lab. The app opens with a sample vase. Drop in your own file, orbit the model to examine the beads, and change nozzle diameter, viscosity, or gravity to compare outcomes.

Files are processed in a browser worker and stay on your device. Fast is the default and estimates gravity-driven compression and droop from nearby support and unsupported span length. Accurate uses finer, continuous deposition samples. It uses relative extrusion commands where available and accounts for contact with earlier beads, lateral spreading, and yield-stress flow along the bead. The viscosity slider sets relative mobility and yield stress. Turning gravity off leaves the deposited bead profile visible in both modes.

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
