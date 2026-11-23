# Dr. FixBoi®’s Clay Visualizer

Preview a clay 3D print from G-code in a 90s-inspired browser lab. The app opens with a sample vase. Drop in your own file, orbit the model to examine the beads, and change nozzle diameter, viscosity, or gravity to compare outcomes.

Files are processed in a browser worker and stay on your device. The preview estimates bead spreading, layer compression, and sag from nearby support. The viscosity scale runs from runny to stiff and has no physical units. Treat the preview as an estimate and validate settings against your printer, clay recipe, and test prints.

The parser supports linear moves, XY-plane arcs, absolute and relative coordinates and extrusion, inch and millimeter units, coordinate resets, and M101/M103-style extrusion. If the file contains no extrusion commands, the app shows horizontal print moves and flags that assumption. The app needs a WebGL 2 browser and accepts files up to 25 MB.

## Run locally

Use Node.js 24 or another version supported by Vite.

```sh
npm ci
npm run dev
```

Run `npm test` for the G-code and simulation checks and `npm run build` to generate the static site in `dist/`.

## GitHub Pages

GitHub Pages serves the built app from the root of the `main` branch. Run `npm run build:pages` after editing the app and commit the updated `index.html` and `pages-assets/` with your source changes. The workflow verifies the tests and checks that the committed site matches the build.
