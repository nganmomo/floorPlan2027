# Floor Plan 2027

A floor-plan editor that runs entirely in the web browser: draw a house on a 2D plan and see it in 3D.

- **Plan (2D):** walls, rooms, doors and windows (including arched ones), stairs, floor slabs, roofs, furniture,
  kitchen and bath fittings, garden objects, fences, terrain (hills, slopes, gravel paths) — from an icon picker.
- **Levels:** basements and upper floors, with a height bar in 0.5 m steps for placing things at any elevation.
- **Prefabs:** ready-made rooms (garage, kitchen, bathroom, living room, bedrooms…) placed as editable groups.
- **3D view:** the whole house or one level, with materials for walls, roofs and floors; right-click any icon or
  prefab in the picker for a 3D preview.
- **Wizard and demos:** answer a few questions and watch a house being designed and built step by step, or follow
  one of the sample houses.
- **3D simulator file:** export the house as a standalone web page to orbit round and walk through.
- **AI export:** a structured description of the plan for generating architectural drawings or renderings.
- Light and dark appearance.

All lengths are in metres. Plans are saved in the browser (local storage) and can be saved to / opened from files.

## Running it

It is plain HTML, CSS and JavaScript — no build step. Serve the folder with any static web server, for example:

```bash
python -m http.server 8027
```

then open <http://localhost:8027>. The 3D view loads [three.js](https://threejs.org/) from a CDN, so it needs an
internet connection the first time.

## Project layout

| Path | What it is |
|---|---|
| `index.html` | the page |
| `css/style.css` | styles |
| `js/icons.js` | the icons (2D symbols), stair layouts, floor materials |
| `js/walls.js` | wall geometry: segments, openings, elevations |
| `js/app.js` | the editor: plan, panels, levels, slabs, stairs, prefabs |
| `js/view3d.js` | the 3D view and the 3D previews |
| `js/prefabs.js` | the prefab rooms |
| `js/wallmaterials.js` | wall and roof materials |
| `js/aiexport.js` | the AI export |
| `js/wizard.js` | the House Building Wizard |
| `js/demo.js`, `img/demo/` | the sample houses and their pictures |
| `js/sim3d.js` | the standalone 3D simulator file |
| `js/settings.js` | the settings (appearance) |
| `tools/build-icons.js` | writes the icons out as SVG files (`node tools/build-icons.js`) |
