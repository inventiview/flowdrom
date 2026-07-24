'use strict';
/*
 * Flowdrom headless regression harness (plain Node, no framework, no deps beyond
 * the vendored json5). Run with:  node test/regression.js   (or: npm test)
 *
 * It exercises the pure text-surgery functions exported by editor.js and the
 * canonical formatter exported by main.js against a real corpus: the default
 * config embedded in index.html plus every JSON block in docs/user-guide.md.
 *
 * Each invariant maps to a class of bug these checks are meant to catch:
 *   1. deleteArrayElement always leaves valid JSON5 (the missing-comma bug).
 *   2. insert/set/move/rename/delete operations re-parse + mutate correctly.
 *   3. formatConfig is valid, idempotent, model-preserving, canonically ordered,
 *      and renders options inline (the unordered/non-compact JSON bug).
 *   4. lane-group membership survives a shifted ('>'/'<') member lane.
 */

const fs = require('fs');
const path = require('path');

const JSON5 = require('../src/js/json5.min.js');
global.JSON5 = JSON5; // editor.js getJSON5() falls back to the global
const E = require('../src/js/editor.js');
const M = require('../src/js/main.js');
const P = require('../src/js/plantuml.js');

// ---------------------------------------------------------------------------
// tiny assert helpers
// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; failures.push(msg); console.error('  FAIL: ' + msg); }
  return cond; // callers use `if (!ok(...)) continue;`
}
// Recursively sort object keys so two structures compare equal regardless of key
// order (formatConfig intentionally reorders keys — content is what must match).
function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    const o = {};
    Object.keys(x).sort().forEach(k => { o[k] = canon(x[k]); });
    return o;
  }
  return x;
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(a === b, msg + (a === b ? '' : `\n        got:  ${a}\n        want: ${b}`));
}
function parses(text, msg) {
  try { JSON5.parse(text); return true; } catch (e) { ok(false, msg + ' — JSON5 error: ' + e.message); return false; }
}
function section(name) { console.log('\n# ' + name); }

// ---------------------------------------------------------------------------
// corpus
// ---------------------------------------------------------------------------
function readDefaultConfig() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = /<textarea id="input"[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
  return m ? { name: 'index.html default', text: m[1].trim() } : null;
}
function readGuideBlocks() {
  const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'user-guide.md'), 'utf8');
  const out = [];
  const re = /```(?:js|json5?)?\s*\n([\s\S]*?)```/g;
  let m, n = 0;
  while ((m = re.exec(md))) {
    const body = m[1].trim();
    if (!body.startsWith('{')) continue;
    try { JSON5.parse(body); out.push({ name: 'guide block #' + (++n), text: body }); } catch (e) { /* skip prose/snippets */ }
  }
  return out;
}

const corpus = [readDefaultConfig()].filter(Boolean).concat(readGuideBlocks());
const ARRAY_SECTIONS = ['lanes', 'laneGroups', 'infoBoxes', 'messages', 'states', 'legend'];

// ---------------------------------------------------------------------------
section('corpus');
ok(corpus.length > 1, 'corpus has default + guide blocks (got ' + corpus.length + ')');

// ---------------------------------------------------------------------------
section('Invariant 1 — deleteArrayElement leaves valid JSON5 + removes the element');
corpus.forEach(({ name, text }) => {
  const model = JSON5.parse(text);
  ARRAY_SECTIONS.forEach(key => {
    const arr = model[key];
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      const out = E.deleteArrayElement(text, key, i);
      if (!ok(out != null, `${name}: delete ${key}[${i}] returns text`)) continue;
      if (!parses(out, `${name}: delete ${key}[${i}] -> valid JSON5`)) continue;
      const expect = arr.slice(0, i).concat(arr.slice(i + 1));
      eq(JSON5.parse(out)[key] || [], expect, `${name}: delete ${key}[${i}] removed the right element`);
    }
  });
});

// ---------------------------------------------------------------------------
section('Invariant 2 — insert / setOrInsertField / setLanes / moveLane / rename / deleteLane');
corpus.forEach(({ name, text }) => {
  const model = JSON5.parse(text);

  // insert a message
  if (Array.isArray(model.messages)) {
    const out = E.insertArrayElement(text, 'messages', "{ path: 'X->Y', label: 'z', fromTime: 0, toTime: 1 }");
    if (out != null && parses(out, `${name}: insert message -> valid JSON5`)) {
      eq(JSON5.parse(out).messages.length, model.messages.length + 1, `${name}: insert message grows array`);
    }
  }
  // set a field on the first message
  if (Array.isArray(model.messages) && model.messages.length) {
    const out = E.setOrInsertField(text, 'messages', 0, 'color', "'teal'");
    if (out != null && parses(out, `${name}: set message[0].color -> valid JSON5`)) {
      eq(JSON5.parse(out).messages[0].color, 'teal', `${name}: set message[0].color value`);
    }
  }
  // reorder lanes
  if (Array.isArray(model.lanes) && model.lanes.length >= 2) {
    const out = E.moveLane(text, 0, 1);
    if (out != null && parses(out, `${name}: moveLane(0,1) -> valid JSON5`)) {
      const want = model.lanes.slice(); const [x] = want.splice(0, 1); want.splice(1, 0, x);
      eq(JSON5.parse(out).lanes, want, `${name}: moveLane(0,1) reorders`);
    }
  }
});

// ---------------------------------------------------------------------------
section('Invariant 3 — formatConfig: valid, idempotent, model-preserving, ordered, inline options');
corpus.forEach(({ name, text }) => {
  const model = JSON5.parse(text);
  const f1 = M.formatConfig(model);
  if (!parses(f1, `${name}: formatConfig -> valid JSON5`)) return;
  eq(canon(JSON5.parse(f1)), canon(model), `${name}: formatConfig preserves the model (content)`);
  const f2 = M.formatConfig(JSON5.parse(f1));
  ok(f1 === f2, `${name}: formatConfig is idempotent`);

  // canonical top-level order
  const present = M.TOP_LEVEL_ORDER.filter(k => k in model);
  const emitted = Object.keys(JSON5.parse(f1));
  eq(emitted.filter(k => M.TOP_LEVEL_ORDER.includes(k)), present, `${name}: canonical key order`);

  // options inline (single line) when present — may carry a trailing comma
  if (model.options && typeof model.options === 'object' && !Array.isArray(model.options)) {
    const line = f1.split('\n').find(l => /^\s*options\s*:/.test(l));
    ok(line && /\}\,?\s*$/.test(line.trim()), `${name}: options is rendered inline`);
  }
  // array-of-object sections: one compact element per line (trailing comma allowed)
  ARRAY_SECTIONS.forEach(key => {
    if (!Array.isArray(model[key]) || !model[key].length) return;
    if (key === 'lanes') return; // lanes is an inline string array
    if (!model[key].every(v => v && typeof v === 'object')) return;
    const elementLines = f1.split('\n').filter(l => /^\s{4}\{.*\}\,?$/.test(l));
    ok(elementLines.length >= model[key].length, `${name}: ${key} elements are one-per-line compact`);
  });
});

// ---------------------------------------------------------------------------
section('Invariant 4 — lane groups keep shifted ("<"/">") member lanes');
{
  const lanes = ['>CA0', 'CA1', 'HN'];
  const laneGroups = [{ label: 'Caching Agents', lanes: ['CA0', 'CA1'] }];
  const lanePositions = { '>CA0': 170, 'CA1': 400, 'HN': 650 };
  const ext = M.computeGroupExtents(lanes, laneGroups, lanePositions);
  eq(ext[0].lanes, ['CA0', 'CA1'], 'shifted lane CA0 stays a group member');
  eq(ext[0].leftmostX, 170, 'group leftmostX resolves through the shifted raw key');
  eq(ext[0].rightmostX, 400, 'group rightmostX correct');
  // cleanLaneName helper
  eq(M.cleanLaneName('>>CA0'), 'CA0', 'cleanLaneName strips > prefix');
  eq(M.cleanLaneName('<HN'), 'HN', 'cleanLaneName strips < prefix');
  eq(M.cleanLaneName('HN.MEM'), 'HN.MEM', 'cleanLaneName keeps sub-lane dot');
}

// ---------------------------------------------------------------------------
section('Feature 4 — deleteTopLevelKey removes the whole legend, leaves valid JSON5');
corpus.forEach(({ name, text }) => {
  const model = JSON5.parse(text);
  if (!Array.isArray(model.legend)) return;
  const out = E.deleteTopLevelKey(text, 'legend');
  if (out != null && parses(out, `${name}: delete legend -> valid JSON5`)) {
    ok(!('legend' in JSON5.parse(out)), `${name}: legend key removed`);
    const m2 = JSON5.parse(out);
    eq(m2.lanes, model.lanes, `${name}: other sections intact after legend delete`);
  }
});

// ---------------------------------------------------------------------------
section('Feature 3 — group time-shift edits stay valid and apply the same delta');
corpus.forEach(({ name, text }) => {
  const model = JSON5.parse(text);
  if (!Array.isArray(model.messages) || model.messages.length < 2) return;
  const dt = 1.0;
  let out = text;
  [0, 1].forEach(i => {
    const m = model.messages[i];
    out = E.setElementFields(out, 'messages', i, [
      { field: 'fromTime', literal: E.numLiteral(m.fromTime + dt) },
      { field: 'toTime', literal: E.numLiteral(m.toTime + dt) },
    ]);
  });
  if (out != null && parses(out, `${name}: group shift -> valid JSON5`)) {
    const m2 = JSON5.parse(out);
    eq([m2.messages[0].fromTime, m2.messages[1].fromTime],
       [model.messages[0].fromTime + dt, model.messages[1].fromTime + dt],
       `${name}: both messages shifted by +${dt}`);
  }
});

// ---------------------------------------------------------------------------
section('Regression — Bug 2: deleting a middle element must keep the separators');
{
  // Minimal reproducer: deleting the middle of three objects used to drop BOTH
  // commas, yielding "{...} {...}" (invalid). Cover one-line + multiline shapes.
  const cases = [
    `{ messages: [{ path: 'A' }, { path: 'C' }, { path: 'E' }] }`,
    `{\n  messages: [\n    { path: 'A' },\n    { path: 'C' },\n    { path: 'E' }\n  ]\n}`,
    `{ messages: [ { path: 'A' }, { path: 'C' }, { path: 'E' }, ] }`, // trailing comma
  ];
  cases.forEach((t, n) => {
    const out = E.deleteArrayElement(t, 'messages', 1);
    if (parses(out, `bug2 case ${n}: middle delete -> valid JSON5`)) {
      eq(JSON5.parse(out).messages.map(m => m.path), ['A', 'E'], `bug2 case ${n}: kept A + E`);
    }
  });
}

// ---------------------------------------------------------------------------
section('Sub-lanes — migrate legacy "Sub.Parent" to order-based "Parent.Sub"');
{
  // Legacy reverse form (left-side sub-lane) -> "Parent.Sub" placed before the
  // parent so it still renders on the left under the order-based model.
  eq(M.migrateLanes(['CA0', 'sub.CA0', 'CA1']), ['CA0.sub', 'CA0', 'CA1'],
     'reverse sub.CA0 -> CA0.sub before parent');
  // Already new form -> untouched.
  eq(M.migrateLanes(['CA0', 'CA0.sub', 'CA1']), ['CA0', 'CA0.sub', 'CA1'],
     'new-form Parent.Sub left untouched');
  // >/< shift prefix on the parent is preserved.
  eq(M.migrateLanes(['>CA0', 'tag.CA0']), ['CA0.tag', '>CA0'],
     'shift prefix on parent preserved');
  // Multiple legacy left sub-lanes keep their relative order, before the parent.
  eq(M.migrateLanes(['HN', 'CA0.HN', 'x.HN', 'CA1']), ['HN.CA0', 'HN.x', 'HN', 'CA1'],
     'multiple legacy left sub-lanes stacked before parent');
  // Idempotent.
  const once = M.migrateLanes(['A', 'b.A', 'A.c']);
  eq(M.migrateLanes(once.slice()), once, 'migrateLanes is idempotent');
}

// ---------------------------------------------------------------------------
section('Auto-arrange — Phase 1 even re-timing preserves order, equality, structure');
corpus.forEach(({ name, text }) => {
  const model = JSON5.parse(text);
  const anchors = E.arrangeTimeAnchors(model);

  // anchors are strictly ascending & unique
  let sortedUnique = true;
  for (let i = 1; i < anchors.length; i++) if (!(anchors[i] > anchors[i - 1])) sortedUnique = false;
  ok(sortedUnique, `${name}: time anchors are sorted & unique`);

  const arranged = E.autoArrangeTimes(model);
  const map = E.evenTimeMap(anchors);

  // even spacing: the pure remap (before any state sequentialization) maps every
  // distinct time onto the contiguous grid 0..n-1.
  const remapped = E.remapModelTimes(model, map);
  const remapAnchors = E.arrangeTimeAnchors(remapped);
  ok(remapAnchors.every((v, i) => v === i), `${name}: remap forms an even 0..n grid`);

  // the core safety invariant: the remap preserves the order AND equality of
  // every pair of anchors (so no element can change its place in time).
  let orderOk = true;
  for (let i = 0; i < anchors.length && orderOk; i++) {
    for (let j = 0; j < anchors.length; j++) {
      if (Math.sign(anchors[i] - anchors[j]) !== Math.sign(map.get(anchors[i]) - map.get(anchors[j]))) { orderOk = false; break; }
    }
  }
  ok(orderOk, `${name}: remap preserves order + equality of every anchor pair`);

  // only time fields change — everything else (paths, labels, colors, lanes,
  // options, …) is identical.
  const stripTimes = (m) => {
    const c = JSON.parse(JSON.stringify(m));
    (c.messages || []).forEach((x) => { delete x.fromTime; delete x.toTime; });
    (c.states || []).forEach((x) => { delete x.fromTime; delete x.toTime; });
    (c.infoBoxes || []).forEach((x) => { delete x.time; });
    (c.frames || []).forEach((x) => { delete x.fromTime; delete x.toTime; });
    (c.timeGaps || []).forEach((x) => { delete x.fromTime; delete x.toTime; });
    return c;
  };
  eq(canon(stripTimes(arranged)), canon(stripTimes(model)), `${name}: arrange changes only time fields`);

  // no same-lane state overlaps remain after Phase 1 (they're sequentialized).
  eq(E.overlappingStatePairs(arranged).length, 0, `${name}: no same-lane state overlaps after arrange`);
});

// ---------------------------------------------------------------------------
section('Auto-arrange — Phase 1 grids events and scales durations (order preserved)');
{
  const model = {
    messages: [{ path: 'A->B', fromTime: 0, toTime: 1 }, { path: 'B->A', fromTime: 4, toTime: 7.4 }],
    states: [
      { lane: 'A', label: 'short', fromTime: 0, toTime: 0.5 },
      { lane: 'B', label: 'long', fromTime: 2, toTime: 6 },
    ],
  };
  const out = E.autoArrangeTimes(model);
  // All distinct times 0,0.5,1,2,4,6,7.4 -> ranks 0..6.
  eq(out.messages[1].fromTime, 4, 'event time 4 maps to its grid rank (4)');
  eq(out.messages[1].toTime, 6, 'event time 7.4 maps to its grid rank (6)');
  eq([out.states[0].fromTime, out.states[0].toTime], [0, 1], 'short state gridded (0->0.5 becomes 0->1)');
  eq([out.states[1].fromTime, out.states[1].toTime], [3, 5], 'long state gridded (2->6 becomes rank 3->5), order preserved');
  // a long state no longer overshoots a later event: long.toTime(5) < B->A.toTime(6)
  ok(out.states[1].toTime <= out.messages[1].toTime, 'state end does not leapfrog a later event (order safe)');
}

// ---------------------------------------------------------------------------
section('Auto-arrange — overlapping same-lane states become adjacent (sequentialized)');
{
  // I->UD (0-0.5) and ssadas (0.3-1.2) overlap on CA0 → pushed back-to-back.
  const model = {
    messages: [{ path: 'CA0->HN', fromTime: 0, toTime: 1 }],
    states: [
      { lane: 'CA0', label: 'I->UD', fromTime: 0, toTime: 0.5 },
      { lane: 'CA0', label: 'ssadas', fromTime: 0.3, toTime: 1.2 },
    ],
  };
  const out = E.autoArrangeTimes(model);
  const s0 = out.states[0], s1 = out.states[1];
  eq(E.overlappingStatePairs(out).length, 0, 'no same-lane overlap remains');
  ok(Math.abs(s1.fromTime - s0.toTime) < 1e-9, 'second state starts exactly where the first ends (adjacent, no gap)');
}

// ---------------------------------------------------------------------------
section('Auto-arrange — Phase 2 helpers (insertGapAtTime, state sequentialize, boxesOverlap)');
{
  // insertGapAtTime: ONE uniform monotonic rule — every time value after the
  // point shifts, including both state boundaries. A straddling state stretches
  // (duration is traded for order/glue preservation); earlier values untouched.
  const m = { messages: [{ path: 'A->B', fromTime: 0, toTime: 2 }, { path: 'B->A', fromTime: 3, toTime: 4 }],
              states: [{ lane: 'A', fromTime: 1, toTime: 5 }, { lane: 'B', fromTime: 3, toTime: 6 }],
              infoBoxes: [{ lane: 'A', time: 4 }] };
  const g = E.insertGapAtTime(m, 2, 1); // add 1 unit after t=2
  eq([g.messages[0].fromTime, g.messages[0].toTime], [0, 2], 'insertGap: element entirely <= point is untouched');
  eq([g.messages[1].fromTime, g.messages[1].toTime], [4, 5], 'insertGap: element entirely after the point shifts down');
  eq([g.states[0].fromTime, g.states[0].toTime], [1, 6], 'insertGap: state straddling the point stretches (end shifts with everything else)');
  eq([g.states[1].fromTime, g.states[1].toTime], [4, 7], 'insertGap: state entirely after the point shifts whole, duration preserved');
  eq([g.infoBoxes[0].time], [5], 'insertGap: info time after the point shifts');

  // THE Arrange safety invariant: relative order AND ties (glue points) of every
  // order event (message from/to, state from/to) survive any gap insertion.
  const evts = (mm) => {
    const out = [];
    (mm.messages || []).forEach((x) => { out.push(x.fromTime, x.toTime); });
    (mm.states || []).forEach((x) => { out.push(x.fromTime, x.toTime); });
    return out;
  };
  // msg0.to == msg1.from == state.from (triple glue), msg1.to == state.to (glue)
  const glue = { messages: [{ path: 'A->B', fromTime: 0, toTime: 2 }, { path: 'B->A', fromTime: 2, toTime: 3 }],
                 states: [{ lane: 'B', fromTime: 2, toTime: 3 }] };
  [0, 1, 2, 2.5, 3].forEach((at) => {
    const before = evts(glue), after = evts(E.insertGapAtTime(glue, at, 2));
    let holds = true;
    for (let i = 0; i < before.length; i++) for (let j = 0; j < before.length; j++) {
      if (Math.sign(before[i] - before[j]) !== Math.sign(after[i] - after[j])) holds = false;
    }
    ok(holds, 'insertGap at t=' + at + ' preserves order and glue of every event pair');
  });

  // orderEventTimes / isGluedTime (Pass D's glue guard)
  const ts = E.orderEventTimes(glue);
  eq(ts, [0, 2, 2, 2, 3, 3], 'orderEventTimes: sorted multiset of message/state event times');
  ok(E.isGluedTime(ts, 2), 'isGluedTime: a time shared by several events is glued');
  ok(!E.isGluedTime(ts, 0), 'isGluedTime: a unique time is not glued');
  ok(E.isGluedTime(E.orderEventTimes({ messages: [{ path: 'A->B', fromTime: 1, toTime: 1 }] }), 1),
     'isGluedTime: a horizontal message glues its own two ends (stays horizontal)');

  // shiftLanes (Pass L's model rewrite): prefix chosen lanes, net existing markers
  eq(E.shiftLanes(['CA0', 'CA1', 'HN'], ['CA1', 'HN'], 2), ['CA0', '>>CA1', '>>HN'],
     'shiftLanes adds > prefixes to the named lanes only');
  eq(E.shiftLanes(['<CA0', '>CA1'], ['CA0', 'CA1'], 1), ['CA0', '>>CA1'],
     'shiftLanes nets out existing </> prefixes instead of mixing them');
  eq(E.shiftLanes(['A.sub', 'A'], ['A'], 1), ['A.sub', '>A'],
     'shiftLanes leaves sub-lanes untouched (they follow their parent lane)');

  // usedColors feeds the color picker's "most used colors" section (single AND
  // multi-selection "Change color" — the multi path regressed once).
  const cm2 = { messages: [{ color: 'red' }, { color: 'red' }, { color: 'green' }],
                states: [{ color: 'yellow' }],
                legend: [{ color: 'green' }, { color: 'green' }] };
  eq(E.usedColors(cm2, 'message'), ['red', 'green'], 'usedColors: kind-scoped, most-frequent first');
  eq(E.usedColors(cm2, 'state'), ['yellow'], 'usedColors: state colors come from states only');
  eq(E.usedColors(cm2, null), ['green', 'red', 'yellow'], 'usedColors: no kind aggregates all colorable kinds');
  eq(E.usedColors(null, 'message'), [], 'usedColors: tolerates a missing model');
  // info boxes / frames colour via `background`, not `color` (#infobox-color)
  const cm3 = { infoBoxes: [{ background: 'yellow' }, { background: 'yellow' }, { background: 'pink' }],
                frames: [{ background: 'blue' }], messages: [{ color: 'red' }] };
  eq(E.usedColors(cm3, 'infoBox'), ['yellow', 'pink'], 'usedColors: infoBox reads the background field');
  eq(E.usedColors(cm3, 'frame'), ['blue'], 'usedColors: frame reads the background field');
  eq(E.usedColors(cm3, null), ['red'], 'usedColors: aggregate still only counts color-bearing kinds');

  // filterNamedColors — contextual search feeds the named-color browser (#named-colors)
  eq(E.filterNamedColors('').length > 100, true, 'filterNamedColors: empty query returns all colors');
  const purp = E.filterNamedColors('purple').map((c) => c.name);
  ok(purp.indexOf('purple') === 0, 'filterNamedColors: exact name ranks first');
  ok(purp.indexOf('magenta') >= 0 && purp.indexOf('violet') >= 0 && purp.indexOf('hotpink') >= 0,
     'filterNamedColors: purple surfaces its hue neighbours (magenta/violet/pink)');
  ok(purp.indexOf('green') < 0 && purp.indexOf('blue') < 0, 'filterNamedColors: purple excludes far-off hues');
  ok(E.filterNamedColors('purp').indexOf('purple') !== -1 || E.filterNamedColors('purp').some((c) => c.name === 'purple'),
     'filterNamedColors: a prefix still finds the family');
  eq(E.filterNamedColors('zzznope').length, 0, 'filterNamedColors: nonsense query matches nothing');

  // overlappingStatePairs + sequentializeStates: PARTIAL same-lane overlap is a
  // data error (reported + repaired); FULL containment is intentional nesting
  // (sub-state / activation bar) and is left alone. (#activation)
  const sm = { states: [
    { lane: 'X', label: 'a', fromTime: 0, toTime: 4 },
    { lane: 'X', label: 'b', fromTime: 2, toTime: 5 },   // partial overlap with 'a'
    { lane: 'Y', label: 'c', fromTime: 0, toTime: 1 },
  ] };
  eq(E.overlappingStatePairs(sm).length, 1, 'overlappingStatePairs finds the one same-lane partial overlap');
  const seq = E.sequentializeStates(sm);
  eq(E.overlappingStatePairs(seq).length, 0, 'sequentializeStates removes the partial overlap');
  ok(seq.states[1].fromTime >= seq.states[0].toTime - 1e-9, 'sequentialized state starts at/after the previous ends');
  ok((seq.states[1].toTime - seq.states[1].fromTime) === 3, 'sequentialize preserves the moved state duration');

  const nested = { states: [
    { lane: 'X', label: 'busy',   fromTime: 0, toTime: 6 },
    { lane: 'X', label: '^block', fromTime: 2, toTime: 3, width: 14 },
    { lane: 'X', label: '^wait',  fromTime: 4, toTime: 5, width: 14 },  // second nested bar
  ] };
  eq(E.overlappingStatePairs(nested).length, 0, 'containment is not reported as an overlap (nesting)');
  eq(canon(E.sequentializeStates(nested)), canon(nested), 'sequentializeStates leaves nested states in place');

  // messageNumbers — autonumber ordering: fromTime asc, ties by array index (#autonumber)
  eq(M.messageNumbers([{ fromTime: 2 }, { fromTime: 0 }, { fromTime: 1 }]), { 0: 3, 1: 1, 2: 2 },
     'messageNumbers orders by fromTime ascending');
  eq(M.messageNumbers([{ fromTime: 1 }, { fromTime: 1 }, { fromTime: 0 }]), { 0: 2, 1: 3, 2: 1 },
     'messageNumbers breaks fromTime ties by array index');
  eq(M.messageNumbers([]), {}, 'messageNumbers tolerates an empty list');

  // parseStateLabel — the '^' vertical-label modifier (activation bars)
  eq(M.parseStateLabel('^block'), { vertical: true, lines: ['block'] }, 'parseStateLabel: ^ marks vertical and is stripped');
  eq(M.parseStateLabel('I->UD'), { vertical: false, lines: ['I->UD'] }, 'parseStateLabel: plain label untouched');
  eq(M.parseStateLabel('^a|b'), { vertical: true, lines: ['a', 'b'] }, 'parseStateLabel: | still splits lines after ^');
  eq(M.parseStateLabel(null), { vertical: false, lines: [''] }, 'parseStateLabel: tolerates a missing label');

  // parsePath — forward/back arrows and self-message sides (#self-message)
  eq(M.parsePath('CA->HN'), { from: 'CA', to: 'HN', self: false, side: 'right' }, 'parsePath: forward arrow');
  eq(M.parsePath('HN<-CA'), { from: 'CA', to: 'HN', self: false, side: 'left' }, 'parsePath: back arrow swaps to semantic from/to');
  eq(M.parsePath('CA->CA'), { from: 'CA', to: 'CA', self: true, side: 'right' }, 'parsePath: same lane forward = right-hand self loop');
  eq(M.parsePath('CA<-CA'), { from: 'CA', to: 'CA', self: true, side: 'left' }, 'parsePath: same lane backward = left-hand self loop');
  eq(M.parsePath('  A  ->  B '), { from: 'A', to: 'B', self: false, side: 'right' }, 'parsePath: whitespace is trimmed');
  eq(M.parsePath('nonsense'), null, 'parsePath: no arrow gives null');
  eq(M.parsePath(null), null, 'parsePath: null-safe');

  // lifelineSegments — split a lifeline around time-gap bands (#time-gap)
  eq(M.lifelineSegments(0, 100, []), [{ y1: 0, y2: 100, dashed: false }], 'lifelineSegments: no gaps = one solid run');
  eq(M.lifelineSegments(0, 100, [{ y0: 30, y1: 50 }]),
     [{ y1: 0, y2: 30, dashed: false }, { y1: 30, y2: 50, dashed: true }, { y1: 50, y2: 100, dashed: false }],
     'lifelineSegments: a mid gap yields solid / dashed / solid');
  eq(M.lifelineSegments(0, 100, [{ y0: 60, y1: 90 }, { y0: 20, y1: 40 }]),
     [{ y1: 0, y2: 20, dashed: false }, { y1: 20, y2: 40, dashed: true }, { y1: 40, y2: 60, dashed: false }, { y1: 60, y2: 90, dashed: true }, { y1: 90, y2: 100, dashed: false }],
     'lifelineSegments: two gaps are sorted and interleaved');
  eq(M.lifelineSegments(0, 100, [{ y0: 20, y1: 60 }, { y0: 40, y1: 80 }]),
     [{ y1: 0, y2: 20, dashed: false }, { y1: 20, y2: 80, dashed: true }, { y1: 80, y2: 100, dashed: false }],
     'lifelineSegments: overlapping gaps merge into one dashed run');
  eq(M.lifelineSegments(0, 100, [{ y0: 0, y1: 100 }]), [{ y1: 0, y2: 100, dashed: true }], 'lifelineSegments: a full-span gap is all dashed');
  eq(M.lifelineSegments(0, 100, [{ y0: -20, y1: 30 }]),
     [{ y1: 0, y2: 30, dashed: true }, { y1: 30, y2: 100, dashed: false }], 'lifelineSegments: a gap is clamped to the lifeline top');

  // formatConfig canonicalises a timeGaps section (fromTime, toTime, label, background, hideGrid)
  const tg = M.formatConfig({ timeGaps: [{ background: 'gray', label: '3 weeks later', toTime: 5, fromTime: 3 }] });
  ok(tg.indexOf("{ fromTime: 3, toTime: 5, label: '3 weeks later', background: 'gray' }") >= 0,
     'formatConfig orders timeGap keys as fromTime, toTime, label, background');

  // timeGap is a text-styleable entity: options.timeGap.{textSize,textColor} resolve
  eq(M.resolveTextConfig({}).timeGap, { size: 13, color: '#6b7280' }, 'resolveTextConfig: timeGap has size/color defaults');
  eq(M.resolveTextConfig({ timeGap: { textSize: 18, textColor: 'red' } }).timeGap, { size: 18, color: 'red' }, 'resolveTextConfig: timeGap size/color are overridable');
  ok(tg.indexOf('timeGaps:') >= 0 && tg.indexOf('timeGaps:') < (tg.indexOf('messages:') >= 0 ? tg.indexOf('messages:') : Infinity),
     'formatConfig places timeGaps before messages');

  // renameLane must cascade through '<-' paths and KEEP the notation
  const rn = E.renameLane("{\n  lanes: ['A', 'B'],\n  messages: [\n    { path: 'B<-A', fromTime: 0, toTime: 1 }\n  ]\n}", 'A', 'X');
  ok(rn != null && rn.indexOf("'B<-X'") >= 0, 'renameLane renames through a back arrow and keeps <- notation');

  // formatConfig places the new width field in canonical position (after color)
  const wtxt = M.formatConfig({ states: [{ fromTime: 2, width: 14, toTime: 5, label: '^block', color: 'red', lane: 'HN' }] });
  ok(wtxt.indexOf("{ lane: 'HN', label: '^block', color: 'red', width: 14, fromTime: 2, toTime: 5 }") >= 0,
     'formatConfig orders state keys as lane, label, color, width, fromTime, toTime');

  // Frames — canonical ordering, top-level position, and time plumbing. (#frames)
  const ftxt = M.formatConfig({ frames: [{ toTime: 5, lMargin: 60, lanes: ['CA0', 'HN'], fromTime: 2, background: 'blue', rMargin: 20, label: 'loop: retry' }],
                                lanes: ['CA0', 'HN'] });
  ok(ftxt.indexOf("{ label: 'loop: retry', lanes: ['CA0', 'HN'], background: 'blue', fromTime: 2, toTime: 5, lMargin: 60, rMargin: 20 }") >= 0,
     'formatConfig orders frame keys as label, lanes, background, fromTime, toTime, lMargin, rMargin');
  ok(ftxt.indexOf('lanes:') >= 0 && ftxt.indexOf('frames:') > ftxt.indexOf('lanes:'),
     'formatConfig emits frames as a top-level section after lanes');

  // insertGapAtTime shifts a frame like everything else (a straddling frame stretches)
  const fg = E.insertGapAtTime({ frames: [{ label: 'f', lanes: ['A'], fromTime: 1, toTime: 4 }] }, 2, 2);
  eq([fg.frames[0].fromTime, fg.frames[0].toTime], [1, 6], 'insertGap: frame end past the gap shifts (frame stretches)');

  // remapModelTimes interpolates frame boundaries between event anchors without
  // perturbing them; a frame aligned to event times lands on the new grid.
  const rmModel = { messages: [{ path: 'A->B', fromTime: 0, toTime: 2 }, { path: 'A->B', fromTime: 4, toTime: 6 }],
                    frames: [{ label: 'f', lanes: ['A', 'B'], fromTime: 2, toTime: 4 }] };
  const rm = E.remapModelTimes(rmModel, E.evenTimeMap(E.arrangeTimeAnchors(rmModel)));
  eq([rm.frames[0].fromTime, rm.frames[0].toTime], [1, 2], 'remapModelTimes: frame boundaries follow the even-grid remap');

  // Interpolated frame boundaries snap to the 0.1 grid (no 10.0333… leakage). (#frames)
  const rmModel2 = { messages: [{ path: 'A->B', fromTime: 0, toTime: 3 }, { path: 'A->B', fromTime: 3, toTime: 12 }],
                     frames: [{ label: 'f', lanes: ['A', 'B'], fromTime: 1.6, toTime: 11 }] };
  const rm2 = E.remapModelTimes(rmModel2, E.evenTimeMap(E.arrangeTimeAnchors(rmModel2)));
  const onGrid = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
  ok(onGrid(rm2.frames[0].fromTime) && onGrid(rm2.frames[0].toTime),
     'remapModelTimes snaps interpolated frame boundaries to the 0.1 grid');

  // interpTime — pure boundary interpolation
  const amap = new Map([[0, 0], [2, 1], [4, 2]]); const anch = [0, 2, 4];
  eq(E.interpTime(2, anch, amap), 1, 'interpTime: exact anchor maps to its rank');
  eq(E.interpTime(3, anch, amap), 1.5, 'interpTime: midpoint interpolates linearly');
  eq(E.interpTime(6, anch, amap), 4, 'interpTime: above the last anchor extends by the same offset');

  // boxesOverlap
  const A = { x: 0, y: 0, w: 10, h: 10 };
  ok(E.boxesOverlap(A, { x: 5, y: 5, w: 10, h: 10 }), 'overlapping boxes detected');
  ok(!E.boxesOverlap(A, { x: 20, y: 0, w: 5, h: 5 }), 'separated boxes do not overlap');
  ok(!E.boxesOverlap(A, { x: 11, y: 0, w: 5, h: 5 }), 'touching-with-1px-gap boxes do not overlap (gap 0)');
  ok(E.boxesOverlap(A, { x: 12, y: 0, w: 5, h: 5 }, 3), 'margin makes near boxes count as overlapping');
}

// ---------------------------------------------------------------------------
section('PlantUML import — plantumlToModel maps the common subset (#plantuml)');
{
  const conv = (lines) => P.plantumlToModel(lines.join('\n'));

  // participants (display-name + alias), forward/dashed/colored/self, direction
  let r = conv([
    '@startuml', 'title T', 'participant "Caching Agent" as CA', 'participant HN',
    'CA -> HN : Req', 'HN --> CA : Ack', 'HN -[#red]> HN : self', 'CA <- HN : Rev', '@enduml',
  ]);
  eq(r.model.title, 'T', 'plantuml: title');
  eq(r.model.lanes, ['Caching Agent', 'HN'], 'plantuml: alias resolves to display name, in declared order');
  eq(r.model.messages[0], { path: 'Caching Agent->HN', fromTime: 1, toTime: 1, label: 'Req', style: 'solid' }, 'plantuml: forward message, horizontal, one row per message from row 1');
  eq(r.model.messages[1].style, 'dashed', 'plantuml: --> is dashed');
  eq(r.model.messages[2], { path: 'HN->HN', fromTime: 3, toTime: 4, label: '^self', color: 'red', style: 'solid' }, 'plantuml: self message spans 2 rows + [#color], label made horizontal (^)');
  eq(r.model.messages[3].path, 'HN->Caching Agent', 'plantuml: A <- B resolves to B->A');
  eq(r.report.unsupported.length, 0, 'plantuml: clean subset has no unsupported lines');

  // activation → thin state; note → infoBox; autonumber → option
  r = conv([
    '@startuml', 'autonumber', 'A -> B : go', 'activate B', 'B -> A : done', 'deactivate B',
    'note over A : hello\\nworld', '@enduml',
  ]);
  eq(r.model.options, { graph: { autonumber: true } }, 'plantuml: autonumber → options.graph.autonumber');
  eq(r.model.states.length, 1, 'plantuml: activate/deactivate → one state');
  eq([r.model.states[0].lane, r.model.states[0].width], ['B', 10], 'plantuml: activation is a thin bar on the target lane');
  ok(r.model.states[0].toTime > r.model.states[0].fromTime, 'plantuml: activation has positive duration');
  eq(r.model.infoBoxes[0].lane, 'A', 'plantuml: note over → infoBox on the lane');
  ok(/hello\|world$/.test(r.model.infoBoxes[0].text), 'plantuml: note \\n becomes | line break');
  ok(!!r.model.infoBoxes[0].background, 'plantuml: note gets a background fill (PlantUML yellow)');
  eq(r.model.infoBoxes[0].tether, false, 'plantuml: note has no leader line (tether: false)');

  // formatConfig places the infoBox background in canonical order (before text)
  const ibtxt = M.formatConfig({ infoBoxes: [{ text: 'hi', background: 'yellow', time: 2, lane: 'A' }] });
  ok(ibtxt.indexOf("{ lane: 'A', time: 2, background: 'yellow', text: 'hi' }") >= 0,
     'formatConfig orders infoBox keys as lane, time, background, text');

  // alt/else → two stacked frames sharing a boundary (no gap)
  r = conv([
    '@startuml', 'A -> B : x', 'alt ok', 'A -> B : y', 'else no', 'A -> B : z', 'end', '@enduml',
  ]);
  eq(r.model.frames.length, 2, 'plantuml: alt/else → two frames');
  eq(r.model.frames[0].label, 'alt [ok]', 'plantuml: alt frame label carries the guard');
  eq(r.model.frames[1].label, 'else [no]', 'plantuml: else frame label');
  ok(Math.abs(r.model.frames[0].toTime - r.model.frames[1].fromTime) < 1e-9, 'plantuml: if/else frames stack seamlessly (shared boundary)');

  // nested fragments → a child frame sits entirely inside its parent (inset
  // side margins + inset outer time boundaries), alt/else still seamless. (#plantuml)
  r = conv([
    '@startuml', 'actor U', 'boundary W', 'control S', 'database D',
    'U -> W : go', 'W -> S : submit',
    'alt ok', '  loop items', '    S -> D : reserve', '  end', '  S -> W : done',
    'else bad', '  S -> W : fail', 'end', '@enduml',
  ]);
  eq(r.model.lanes, ['U', 'W', 'S', 'D'], 'plantuml: actor/boundary/control/database all become lanes');
  const parent = r.model.frames.filter((f) => /^alt/.test(f.label))[0];
  const child = r.model.frames.filter((f) => /^loop/.test(f.label))[0];
  ok(parent && child, 'plantuml: nested alt + loop both emitted');
  ok(child.fromTime > parent.fromTime && child.toTime < parent.toTime, 'plantuml: child frame is inside the parent in time');
  ok(child.lMargin < 40 && child.rMargin < 40, 'plantuml: child frame side margins are inset from the default');
  const elseF = r.model.frames.filter((f) => /^else/.test(f.label))[0];
  ok(Math.abs(parent.toTime - elseF.fromTime) < 1e-9, 'plantuml: alt/else still stack seamlessly under nesting');

  // a frame always keeps positive headroom around its messages, even deeply nested
  const msgTimes = (r.model.messages || []).map((m) => m.fromTime);
  r.model.frames.forEach((f) => {
    const inside = msgTimes.filter((t) => t > f.fromTime - 1e-9 && t < f.toTime + 1e-9);
    inside.forEach((t) => ok(t > f.fromTime + 1e-6 && t < f.toTime - 1e-6, 'plantuml: message t=' + t + ' sits strictly inside frame ' + f.label));
  });

  // 'group' shows its label directly; alt/loop prefix the operator
  r = conv(['@startuml', 'A -> B : x', 'group My own label', 'A -> B : y', 'end', '@enduml']);
  eq(r.model.frames[0].label, 'My own label', 'plantuml: group label shown directly (no operator/brackets)');

  // Long labels widen the imported lane spacing so arrows can host them; short
  // labels keep the default (no options emitted at all). (#lane-spacing)
  r = conv(['@startuml', 'A -> B : This is an extremely long message label that will not fit at all', '@enduml']);
  ok(r.model.options && r.model.options.graph.laneSpacing > 250, 'plantuml: long labels set options.graph.laneSpacing');
  ok(r.report.notes.some((n) => /lane spacing widened/.test(n)), 'plantuml: widened spacing is reported');
  r = conv(['@startuml', 'A -> B : short', '@enduml']);
  ok(!r.model.options, 'plantuml: short labels keep the default spacing (no options emitted)');
  // a long label spanning several lanes has that many gaps to live in
  r = conv(['@startuml', 'A -> B : x', 'B -> C : x', 'C -> D : x',
            'A -> D : long-ish label across three whole gaps here', '@enduml']);
  ok(!r.model.options, 'plantuml: a spanning label divides its width across the spanned gaps');

  // Delay ('...text...') → a time gap labelled with the text; a bare '...' is a
  // label-less gap; a '|||' spacer adds blank space but no gap. (#time-gap)
  r = conv(['@startuml', 'A -> B : req', '...3 weeks later...', 'B -> A : ack', '@enduml']);
  eq((r.model.timeGaps || []).length, 1, 'plantuml: delay becomes a time gap');
  eq(r.model.timeGaps[0].label, '3 weeks later', 'plantuml: delay text becomes the gap label');
  ok(r.model.timeGaps[0].fromTime < r.model.timeGaps[0].toTime, 'plantuml: the gap has a positive window');
  ok(r.model.messages[1].fromTime > r.model.timeGaps[0].toTime, 'plantuml: the message after a delay comes after the gap');
  ok(!(r.report.unsupported || []).some((u) => /^\.\.\./.test(u.line)), 'plantuml: a delay is no longer reported unsupported');
  r = conv(['@startuml', 'A -> B : x', '...', 'A -> B : y', '@enduml']);
  ok((r.model.timeGaps || []).length === 1 && r.model.timeGaps[0].label == null, 'plantuml: a bare ... is a label-less gap');
  r = conv(['@startuml', 'A -> B : x', '|||', 'A -> B : y', '@enduml']);
  ok(!(r.model.timeGaps || []).length, 'plantuml: a ||| spacer adds space but no gap');
  ok(r.model.messages[1].fromTime > r.model.messages[0].toTime + 1, 'plantuml: the spacer leaves a blank row');

  // Activation shorthand semantics: '++' activates the TARGET, '--' deactivates
  // the SOURCE — including on a reverse arrow, where the shorthand is written
  // after the sender's name ('A <- B --'). (#plantuml)
  r = conv(['@startuml', 'S -> P ++ : req', 'S <- P -- : fail', 'S -> O : next', '@enduml']);
  eq(r.model.states.length, 1, 'plantuml: ++/-- opens and closes exactly one activation');
  eq([r.model.states[0].lane, r.model.states[0].fromTime, r.model.states[0].toTime], ['P', 1, 2],
     'plantuml: -- on a reverse arrow closes the SOURCE (P) at the reply row, not at the end');
  r = conv(['@startuml', 'A -> B ++ : go', 'B -> A -- : done', '@enduml']);
  eq([r.model.states[0].lane, r.model.states[0].toTime], ['B', 2],
     'plantuml: forward -- deactivates the sender (B), closing at the reply');
  // combined '--++' (PlantUML chain shorthand) must not corrupt the name
  r = conv(['@startuml', 'A -> B ++ : a', 'B -> C --++ : b', '@enduml']);
  eq(r.model.lanes, ['A', 'B', 'C'], 'plantuml: --++ combo leaves the participant name clean');
  eq(r.model.states.map((s) => s.lane), ['B', 'C'], 'plantuml: --++ closes sender B in-line; C closes at EOF cleanup');

  // 'partition' → a group-like frame; targetless 'note left/right' attaches to
  // the last participant (must not be dropped). (#plantuml)
  r = conv(['@startuml', 'partition p1', 'b -> c: m', 'c --> b: OK', 'note right: R', 'end',
            'partition p2', 'a -> b: m', 'note left: L', 'end', '@enduml']);
  eq(r.model.frames.map((f) => f.label), ['partition [p1]', 'partition [p2]'], 'plantuml: partition → frame labeled operator-style, like PlantUML');
  eq(r.model.infoBoxes.length, 2, 'plantuml: targetless note left/right is kept (not dropped)');
  eq(r.model.infoBoxes[0].lane, 'c', 'plantuml: note right anchors to the RIGHTMOST participant of the last message');
  ok(/^<95,0>/.test(r.model.infoBoxes[0].text), 'plantuml: note right sits on the right side');
  ok(/^<-95,0>/.test(r.model.infoBoxes[1].text), 'plantuml: note left sits on the left side');

  // box → laneGroup (multiple boxes), \n in participant names, spanning notes
  r = conv([
    '@startuml', 'box "Front"', 'participant "Web\\nUI" as W', 'end box',
    'box "Back"', 'participant "Order\\nSvc" as O', 'participant DB', 'end box',
    'W -> O : go', 'note over W, O : hop\\nover', 'note over W, O, DB : span three', '@enduml',
  ]);
  eq(r.model.lanes, ['Web|UI', 'Order|Svc', 'DB'], 'plantuml: \\n in a participant name → | line break');
  eq(r.model.laneGroups, [{ label: 'Front', lanes: ['Web|UI'] }, { label: 'Back', lanes: ['Order|Svc', 'DB'] }],
     'plantuml: multiple box blocks → multiple lane groups');
  ok(/^<125,0>hop\|over$/.test(r.model.infoBoxes[0].text), 'plantuml: note over two lanes is centered between them (125px)');
  ok(/^<250,0>span three$/.test(r.model.infoBoxes[1].text), 'plantuml: note over three lanes centers further out (250px)');
  eq(r.model.infoBoxes[0].lane, 'Web|UI', 'plantuml: spanning note anchors on the leftmost lane');

  // never-fail: garbage lines are reported, not thrown
  r = conv(['@startuml', 'this is not valid puml', 'A -> B', '@enduml']);
  ok(r.report.unsupported.length >= 1, 'plantuml: unrecognised lines go to the report');
  eq(r.model.messages.length, 1, 'plantuml: valid lines still convert around the garbage');

  // output round-trips through the canonical formatter and re-parses
  const big = conv([
    '@startuml', 'title Round trip', 'participant A', 'participant B',
    'A -> B : hi', 'alt c', 'B -> A : yes', 'else', 'B -> A : no', 'end', '@enduml',
  ]);
  const formatted = M.formatConfig(big.model);
  ok(parses(formatted, 'plantuml: formatted import is valid JSON5'), 'plantuml: import → formatConfig round-trips');
}

// ---------------------------------------------------------------------------
section('Boundary messages — snapEndpointPure / guardInversion + serialization (#boundary-msg)');
{
  const snap = M.snapEndpointPure, guard = M.guardInversion;
  // Fallback: no containing boxes -> the endpoint stays at the lane center.
  eq(snap(100, 200, []), 100, 'boundary: no boxes -> lane center');
  // Single boundary box (centered on lane 100, width 40 -> edges 80..120): the
  // endpoint snaps to whichever edge faces the OTHER end.
  const b = { x: 80, w: 40, attach: 'boundary' };
  eq(snap(100, 200, [b]), 120, 'boundary: other end on the right -> right edge');
  eq(snap(100, 0, [b]), 80, 'boundary: other end on the left -> left edge');
  // A 'center' box is transparent to the walk -> passes through to the center.
  eq(snap(100, 200, [{ x: 80, w: 40, attach: 'center' }]), 100, 'boundary: center box -> pass through');
  // Nested: outer 'center' + inner 'boundary' -> the inner edge, and the walk is
  // widest-first regardless of the array order it is handed.
  const outerC = { x: 70, w: 60, attach: 'center' }, innerB = { x: 85, w: 30, attach: 'boundary' };
  eq(snap(100, 200, [outerC, innerB]), 115, 'boundary: outer center passes through to inner boundary edge');
  eq(snap(100, 200, [innerB, outerC]), 115, 'boundary: walk is widest-first regardless of array order');
  // Nested: the outermost 'boundary' short-circuits before any inner box.
  const outerB = { x: 70, w: 60, attach: 'boundary' };
  eq(snap(100, 200, [outerB, innerB]), 130, 'boundary: outermost boundary wins (short-circuit)');

  // Inversion guard.
  eq(guard(100, 300, 120, 280), [120, 280], 'guard: a valid (shortened) snap is kept');
  eq(guard(100, 300, 320, 280), [100, 300], 'guard: a reversed arrow reverts both ends to centers');
  eq(guard(100, 130, 118, 122), [100, 130], 'guard: a collapsed arrow reverts to centers');
  eq(guard(300, 100, 280, 120), [280, 120], 'guard: a right-to-left arrow is kept when direction is preserved');

  // Serialization: `attach` sits between `width` and `fromTime` in the state key
  // order, and both the per-state field and the global option round-trip.
  const so = M.SECTION_KEY_ORDER.states;
  ok(so.indexOf('attach') > so.indexOf('width') && so.indexOf('attach') < so.indexOf('fromTime'),
     'serialization: attach is ordered after width, before fromTime');
  const model = {
    options: { graph: { messageAttach: 'boundary' } },
    lanes: ['A', 'B'],
    messages: [{ path: 'A->B', fromTime: 0, toTime: 1 }],
    states: [{ lane: 'B', label: 'busy', attach: 'boundary', fromTime: 0, toTime: 2 }],
  };
  const out = M.formatConfig(model);
  ok(parses(out, 'boundary: formatConfig output is valid JSON5'), 'serialization: formatConfig stays valid with attach + messageAttach');
  const rt = JSON5.parse(out);
  eq(rt.states[0].attach, 'boundary', 'serialization: per-state attach round-trips');
  eq(rt.options.graph.messageAttach, 'boundary', 'serialization: global messageAttach round-trips');
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
if (fail) { console.error('\nFAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
console.log('All green.');
