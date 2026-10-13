/* Settings — the gear button in the bottom-left corner.
   Appearance: Light, Dark or System (follows the computer's light / dark setting).
   The choice is remembered in this browser; index.html applies it before the page is drawn. */
(function () {
  'use strict';
  const KEY = 'floorplan2027.theme';
  const root = document.documentElement;
  const btn = document.getElementById('btnSettings');
  const pop = document.getElementById('settingsPop');
  if (!btn || !pop) return;
  const opts = [...pop.querySelectorAll('[data-theme-opt]')];
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

  let mode = 'dark';
  try { mode = localStorage.getItem(KEY) || 'dark'; } catch (e) { /* storage unavailable */ }
  if (!['light', 'dark', 'system'].includes(mode)) mode = 'dark';

  function apply() {
    const resolved = mode === 'system' ? (mq && mq.matches ? 'dark' : 'light') : mode;
    root.setAttribute('data-theme', resolved);
    opts.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeOpt === mode)));
  }
  function setMode(m) {
    mode = m;
    try { localStorage.setItem(KEY, m); } catch (e) { /* storage unavailable */ }
    apply();
  }
  if (mq) {
    const onChange = () => { if (mode === 'system') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
  // another tab changed the theme: follow it
  window.addEventListener('storage', (e) => { if (e.key === KEY && e.newValue) { mode = e.newValue; apply(); } });

  function open(on) {
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    if (on) (pop.querySelector('[aria-checked="true"]') || opts[0]).focus();
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(pop.hidden); });
  pop.addEventListener('click', (e) => {
    const o = e.target.closest('[data-theme-opt]');
    if (o) setMode(o.dataset.themeOpt);
    if (e.target.closest('[data-sp-close]')) { open(false); btn.focus(); }
  });
  // arrow keys move between the three choices
  pop.addEventListener('keydown', (e) => {
    const g = document.activeElement && document.activeElement.closest('[role=radiogroup]');
    if (!g || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const list = [...g.querySelectorAll('[role=radio]')], i = list.indexOf(document.activeElement);
    e.preventDefault(); e.stopPropagation();
    const n = list[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? list.length - 1 : 1)) % list.length];
    n.focus(); n.click();
  });
  document.addEventListener('mousedown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); open(false); btn.focus(); } }, true);

  // New stairs: does the Height bar set where they start, or where they end? (read by app.js when stairs are added)
  const SKEY = 'floorplan2027.stairHeight';
  const sOpts = [...pop.querySelectorAll('[data-stair-opt]')];
  let sMode = 'start';
  try { sMode = localStorage.getItem(SKEY) === 'top' ? 'top' : 'start'; } catch (e) { /* storage unavailable */ }
  const sApply = () => sOpts.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.stairOpt === sMode)));
  pop.addEventListener('click', (e) => {
    const o = e.target.closest('[data-stair-opt]');
    if (!o) return;
    sMode = o.dataset.stairOpt;
    try { localStorage.setItem(SKEY, sMode); } catch (err) { /* storage unavailable */ }
    sApply();
  });
  sApply();

  // Units: metric or imperial (app.js redraws everything; it reads the same stored choice on start)
  const uOpts = [...pop.querySelectorAll('[data-unit-opt]')];
  const uNow = () => (window.FP && window.FP.units ? window.FP.units() : 'metric');
  const uApply = () => uOpts.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unitOpt === uNow())));
  pop.addEventListener('click', (e) => {
    const o = e.target.closest('[data-unit-opt]');
    if (!o || !window.FP || !window.FP.setUnits) return;
    window.FP.setUnits(o.dataset.unitOpt);
    uApply();
  });
  uApply();

  // show the open tab's hint (its .panel-foot) beside the gear
  const hint = document.getElementById('dockHint');
  const views = [...document.querySelectorAll('.panel.left .view')];
  function syncHint() {
    const v = views.find((x) => !x.hidden);
    const f = v && v.querySelector(':scope > .panel-foot');
    if (hint) hint.textContent = f ? f.textContent : '';
  }
  if (hint && views.length) {
    const mo = new MutationObserver(syncHint);
    views.forEach((v) => mo.observe(v, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true, characterData: true }));
    syncHint();
  }

  apply();
})();
