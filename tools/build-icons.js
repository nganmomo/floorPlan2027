// Writes every icon in js/icons.js to icons/<id>.svg as a standalone SVG file.
// Usage: node tools/build-icons.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'icons.js'), 'utf8'), ctx);
const icons = ctx.window.FP_ICONS;

const outDir = path.join(root, 'icons');
fs.mkdirSync(outDir, { recursive: true });

const style =
  '.b{fill:#fff}.k{fill:currentColor}.tx{fill:currentColor;stroke:none;font-family:Arial,Helvetica,sans-serif}';

const visible = icons.filter((i) => !i.hidden);
for (const ic of visible) {
  const inner = ic.draw ? ic.draw(ic.w, ic.h, { t: 15, label: ic.label || '' }) : ic.svg;
  const pad = 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${ic.w + pad * 2} ${ic.h + pad * 2}" ` +
    `width="${ic.w + pad * 2}" height="${ic.h + pad * 2}" color="#1f2328" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">\n` +
    `  <title>${ic.name}</title>\n  <style>${style}</style>\n  ${inner}\n</svg>\n`;
  fs.writeFileSync(path.join(outDir, `${ic.id}.svg`), svg);
}
console.log(`Wrote ${visible.length} SVG icons to ${path.relative(process.cwd(), outDir) || outDir}`);
