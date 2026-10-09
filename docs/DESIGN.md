# Water Inspector: visual design brief

The look is a survey instrument at night: a dark, full-bleed map or 3D scene with every piece of chrome floating over it as frosted glass. Water is the hero and is always cyan-to-teal. Data is set in clean, tabular type. Nothing is decorative for its own sake, and nothing invents data.

## Tokens (see `app/src/index.css`)

| Token | Value | Use |
|---|---|---|
| `--ink-0` / `--ink-1` | `#040b10` / `#071219` | Page and scene backgrounds |
| `--glass` / `--glass-strong` | `rgba(9,21,28,.74)` / `rgba(8,18,24,.9)` + `backdrop-filter: blur(18px)` | Every floating surface |
| `--line` / `--line-strong` | `rgba(150,205,222,.12)` / `.22` | Hairlines, borders |
| `--text` / `--text-2` / `--muted` | `#e8f1f3` / `#b7c9ce` / `#7d959c` | Primary, secondary, labels |
| `--accent` | `#5fd4e8` | Water, selection, focus, the active control |
| `--good` / `--watch` / `--bad` | `#62dca9` / `#f2c566` / `#ff8574` | Status, always paired with text |
| `--demo` | `#e6c27a` | Demo-data labels |

Type: Inter Variable for UI and data (`.tnum` for tabular figures), Instrument Serif for waterbody names only. Labels are 10.5 to 11 px uppercase with 0.09 to 0.12 em tracking. Body 13.5 to 14 px.

## Chrome rules

- Use the shared classes: `.legend` (top-left info panel), `.scene-controls` (bottom-left control bar), `.scene-card` (hover card), `.btn`, `.chip`, `.chip-good|watch|bad|accent|demo`. Do not restyle them inside a scene.
- The inspector panel covers the right 464 px of the window on desktop. Scene canvases are full-bleed under it, and `SceneCanvas` already shifts the camera centre into the visible stage. Keep overlays on the left half, or offset them with `right: calc(var(--stage-right) + 14px)`.
- The view dock sits top-centre. Keep the top 64 px of the stage clear apart from the top-left badges.

## 3D scenes

- Background: deep ink with a subtle radial lift, never flat black.
- Light like a photograph: one key light, a cool sky fill, gentle rim. Use ACES filmic tone mapping, sRGB output and soft shadows where they help.
- Water is translucent, cyan-to-deep-teal by depth, with a crisp Fresnel edge. Murkier water (lower visibility, higher turbidity or chlorophyll) shifts it green-brown, from the `SceneModel`.
- Restrained post-processing: a little bloom on emissive accents, a soft vignette. No chromatic aberration, no heavy film grain.
- Motion is slow and calm. Respect `reducedMotion`.
- Everything procedural: geometry, textures (canvas or noise in shaders) and materials are generated in code. No model or texture downloads.
- Honesty: only draw what the `SceneModel` contains. Estimated depth stays labelled "Modelled". Never add particles, species or values that are not in the data.

## Performance

Target 60 fps on integrated graphics at 1080p. Use instancing, keep draw calls low, and scale effects with `useRenderQuality()`. The e2e suite renders with SwiftShader, so scenes must still render (slowly) without a GPU.
