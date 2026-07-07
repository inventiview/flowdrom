/*
 * Flowdrom graphical editor layer.
 *   Phase 0/1: select + edit existing elements.
 *
 * Interaction model:
 *   - The canvas looks IDENTICAL to a normal render until you click. No handles
 *     or chrome are drawn at rest.
 *   - Click a location -> popup menu. If several items overlap that point
 *     (e.g. a state and a message endpoint), the menu first lets you pick which
 *     one; with a single item it goes straight to that item's actions.
 *   - Item actions: "Drag" (reveals only that item's handles) and
 *     "Go to JSON definition" (selects the matching JSON5 in the editor).
 *
 * Loaded ONLY by index.html — never by the headless engine or the VS Code
 * extension. All editor chrome (menu, selection box, drag handles) lives
 * OUTSIDE the diagram <svg>, so exportSVG() output is never affected.
 */
(function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const SNAP_TIME = 0.1; // grid snap for times; all time edits snap to this
  // Frame (interaction-scope) default side margins, px — MUST match main.js
  // FRAME_DEFAULT_{L,R}_MARGIN so the editor's geometry agrees with the render.
  // No vertical margin: top/bottom sit exactly on fromTime/toTime. (#frames)
  const FRAME_L_MARGIN = 40, FRAME_R_MARGIN = 40;
  const DRAGGABLE = { message: true, state: true, infoBox: true, lane: true, frame: true };
  const DELETABLE = { message: true, state: true, infoBox: true, legend: true, laneGroup: true, frame: true };
  const HAS_COLOR = { message: true, legend: true, state: true }; // have a color field
  const HAS_STYLE = { message: true, legend: true };               // have solid/dashed
  const TEXTABLE = { message: true, state: true, infoBox: true, legend: true, title: true, laneGroup: true, frame: true };
  const PALETTE = ['black', 'red', 'blue', 'green', 'purple', 'orange', 'teal', 'brown', 'gray', 'deeppink', 'goldenrod', 'seagreen'];
  // states render a pastel background keyed off these named colors (engine getPastelColor)
  const STATE_PALETTE = ['yellow', 'red', 'blue', 'green', 'orange', 'cyan', 'purple', 'pink'];
  // entities configurable via the options block (global text styling)
  const OPTION_ENTITIES = ['title', 'lane', 'subLane', 'laneGroup', 'message', 'state', 'info', 'legend', 'legendTitle', 'time', 'frame'];

  const SECTION_BY_KIND = {
    lane: 'lanes', message: 'messages', state: 'states',
    infoBox: 'infoBoxes', laneGroup: 'laneGroups', legend: 'legend', frame: 'frames',
  };

  function getEditor() {
    if (typeof window !== 'undefined' && window.codeMirrorEditor) return window.codeMirrorEditor;
    if (typeof codeMirrorEditor !== 'undefined') return codeMirrorEditor; // eslint-disable-line no-undef
    return null;
  }
  function getJSON5() {
    return (typeof window !== 'undefined' && window.JSON5) || (typeof JSON5 !== 'undefined' ? JSON5 : null); // eslint-disable-line no-undef
  }
  // Semantic message-path info via the engine's parsePath (a global from
  // main.js, which always loads first in the browser). Null when the engine
  // isn't present (headless text-helper tests) or the path has no arrow.
  // (#self-message)
  function pathInfo(msg) {
    if (typeof parsePath !== 'function') return null; // eslint-disable-line no-undef
    return parsePath(msg && msg.path); // eslint-disable-line no-undef
  }

  // Measure rendered text width for a given CSS font shorthand (cached canvas
  // context). Used to grow the edit popover to fit the text as it's typed.
  function measureTextWidth(text, font) {
    const ctx = measureTextWidth._ctx || (measureTextWidth._ctx = document.createElement('canvas').getContext('2d'));
    if (!ctx) return (text || '').length * 8; // canvas unavailable: rough fallback
    ctx.font = font;
    return ctx.measureText(text || '').width;
  }

  // ========================================================================
  // Pure text helpers (exported for unit testing — no DOM dependency).
  // ========================================================================

  // Find a TOP-LEVEL (depth-1) `key:` and return the index of the first char of
  // its value. Depth-aware (a nested `lanes:` inside a laneGroup is ignored) and
  // accepts both unquoted (lanes:) and quoted ("lanes":/'lanes':) keys — the
  // latter is what JSON5.stringify / strict JSON produce. Returns -1 if absent.
  function findTopLevelValue(text, key) {
    if (text == null) return -1;
    const afterColon = (j) => { while (j < text.length && /\s/.test(text[j])) j++; if (text[j] !== ':') return -1; j++; while (j < text.length && /\s/.test(text[j])) j++; return j; };
    let depth = 0, inStr = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'") {
        if (depth === 1) { // a quoted token at object level may be a key
          let j = i + 1, s = '';
          while (j < text.length) { const d = text[j]; if (d === '\\') { s += text[j + 1] || ''; j += 2; continue; } if (d === c) break; s += d; j++; }
          if (s === key) { const v = afterColon(j + 1); if (v >= 0) return v; }
          i = j; continue; // skip the string (it was a value, or a non-matching key)
        }
        inStr = c; continue;
      }
      if (c === '{' || c === '[') { depth++; continue; }
      if (c === '}' || c === ']') { depth--; continue; }
      if (depth === 1 && c === key[0]) {
        const prev = text[i - 1];
        if (prev && /[A-Za-z0-9_]/.test(prev)) continue;
        if (text.slice(i, i + key.length) === key && !/[A-Za-z0-9_]/.test(text[i + key.length] || '')) {
          const v = afterColon(i + key.length); if (v >= 0) return v;
        }
      }
    }
    return -1;
  }

  function locateArrayElement(text, key, index) {
    if (text == null) return null;
    const v = findTopLevelValue(text, key);
    if (v < 0 || text[v] !== '[') return null;
    let i = v + 1;
    let depth = 0, inStr = null, elemStart = -1, count = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") { if (elemStart === -1 && depth === 0) elemStart = i; inStr = c; continue; }
      if (c === '{' || c === '[') { if (elemStart === -1 && depth === 0) elemStart = i; depth++; continue; }
      if (c === '}' || c === ']') {
        if (depth === 0) { if (elemStart !== -1 && count === index) return { start: elemStart, end: i }; return null; }
        depth--;
        if (depth === 0) { if (count === index) return { start: elemStart, end: i + 1 }; count++; elemStart = -1; }
        continue;
      }
      if (c === ',' && depth === 0) {
        // A depth-0 comma is always a separator — consume it. When it closes a
        // pending element (scalars), return/advance; otherwise (the comma that
        // follows an object's '}') just skip it. Critically we MUST `continue`
        // so the catch-all below never mistakes this comma for element content
        // (that bug left the leading comma inside the span and broke deletes).
        if (elemStart !== -1) {
          if (count === index) return { start: elemStart, end: i };
          count++; elemStart = -1;
        }
        continue;
      }
      if (depth === 0 && elemStart === -1 && !/\s/.test(c)) elemStart = i;
    }
    return null;
  }

  function quote(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
  function numLiteral(n) { return String(parseFloat(n.toFixed(3))); }

  // A JSON5 scalar value: single/double-quoted string, number, or keyword.
  const FIELD_VALUE = "'(?:\\\\.|[^'])*'" + '|' + '"(?:\\\\.|[^"])*"' + '|' + '-?\\d+(?:\\.\\d+)?' + '|true|false|null';
  // Match a field key that may be bare, "double"- or 'single'-quoted.
  function fieldKeyRe(field) { return "(^|[^A-Za-z0-9_])([\"']?)" + field + "\\2(\\s*:\\s*)"; }
  function hasField(seg, field) { return new RegExp(fieldKeyRe(field)).test(seg); }

  function replaceFieldValue(text, span, field, newLiteral) {
    if (text == null || !span) return null;
    const seg = text.slice(span.start, span.end);
    const m = new RegExp(fieldKeyRe(field) + '(' + FIELD_VALUE + ')').exec(seg);
    if (!m) return null;
    // groups: 1=boundary, 2=open quote (''/"/'), 3=`:` spacing, 4=value
    const prefixLen = m[1].length + m[2].length + field.length + m[2].length + m[3].length;
    const valStart = span.start + m.index + prefixLen;
    const valEnd = valStart + m[4].length;
    return text.slice(0, valStart) + newLiteral + text.slice(valEnd);
  }

  function setElementFields(text, key, index, edits) {
    let out = text;
    for (const e of edits) {
      const span = locateArrayElement(out, key, index);
      if (!span) return null;
      const next = replaceFieldValue(out, span, e.field, e.literal);
      if (next == null) return null;
      out = next;
    }
    return out;
  }

  function parseInfoOffset(textValue) {
    const m = /^<(-?\d+),(-?\d+)>([\s\S]*)$/.exec(textValue || '');
    if (m) return { x: parseInt(m[1], 10), y: parseInt(m[2], 10), rest: m[3] };
    return { x: 50, y: -50, rest: textValue || '' };
  }
  function buildInfoText(x, y, rest) { return '<' + Math.round(x) + ',' + Math.round(y) + '>' + rest; }

  // Lane names may carry a horizontal-shift prefix: '>'/'<' (each = 20px, per the
  // engine's parseLaneNameOffset). Parse/build that prefix.
  function parseLanePrefix(name) {
    const r = /^(>+)([\s\S]*)$/.exec(name);
    if (r) return { clean: r[2].trim(), offsetPx: r[1].length * 20 };
    const l = /^(<+)([\s\S]*)$/.exec(name);
    if (l) return { clean: l[2].trim(), offsetPx: -l[1].length * 20 };
    return { clean: String(name).trim(), offsetPx: 0 };
  }
  function buildLaneName(clean, count) {
    if (count > 0) return '>'.repeat(count) + clean;
    if (count < 0) return '<'.repeat(-count) + clean;
    return clean;
  }
  // A message label may begin with '>'/'<' markers (position along the arrow).
  // Split markers from the visible text.
  function parseLabelMarkers(label) {
    const m = /^([<>]*)([\s\S]*)$/.exec(label || '');
    return { markers: m[1], text: m[2] };
  }
  // offsetRatio in [-0.4, 0.4] -> marker string (engine: each marker = 1/8 of arrow, capped).
  function markersFromRatio(r) {
    const c = Math.round(Math.min(Math.abs(r), 0.4) * 8);
    if (c === 0) return '';
    return (r > 0 ? '>' : '<').repeat(c);
  }
  function ratioFromMarkers(markers) {
    if (!markers) return 0;
    const sign = markers[0] === '>' ? 1 : -1;
    return sign * Math.min(markers.length / 8, 0.4);
  }

  // Insert a new "field: literal," right after the element object's '{'.
  function insertField(text, key, index, field, literal) {
    const span = locateArrayElement(text, key, index);
    if (!span) return null;
    const brace = text.slice(span.start, span.end).indexOf('{');
    if (brace < 0) return null;
    const at = span.start + brace + 1;
    return text.slice(0, at) + ' ' + field + ': ' + literal + ',' + text.slice(at);
  }
  // Replace the field if present, else insert it.
  function setOrInsertField(text, key, index, field, literal) {
    const span = locateArrayElement(text, key, index);
    if (!span) return null;
    if (hasField(text.slice(span.start, span.end), field)) return replaceFieldValue(text, span, field, literal);
    return insertField(text, key, index, field, literal);
  }

  // Replace (or insert) a top-level field like `title` (quoted-key-safe).
  function setTopField(text, field, literal) {
    if (text == null) return null;
    const v = findTopLevelValue(text, field);
    if (v >= 0) {
      const m = new RegExp('^(' + FIELD_VALUE + ')').exec(text.slice(v));
      if (!m) return null;
      return text.slice(0, v) + literal + text.slice(v + m[1].length);
    }
    const open = text.indexOf('{');
    if (open < 0) return null;
    return text.slice(0, open + 1) + '\n  ' + field + ': ' + literal + ',' + text.slice(open + 1);
  }

  // Rename a lane everywhere it's referenced. Handles the lane list (preserving
  // '>'/'<' prefixes), message paths, state/info lanes, lane-group membership,
  // and sublane composites ('old.x' / 'x.old'). Returns new text (or original).
  function renameLaneToken(token, oldClean, newClean) {
    const t = String(token == null ? '' : token).trim();
    if (t === oldClean) return newClean;
    const parts = t.split('.');
    if (parts.length === 2) {
      if (parts[0] === oldClean) return newClean + '.' + parts[1];
      if (parts[1] === oldClean) return parts[0] + '.' + newClean;
    }
    return t;
  }
  function replaceGroupLanes(out, span, arr) {
    const seg = out.slice(span.start, span.end);
    const a = locateArray(seg, 'lanes');
    if (!a) return out;
    const body = '[' + arr.map(quote).join(', ') + ']';
    return out.slice(0, span.start) + seg.slice(0, a.open) + body + seg.slice(a.close + 1) + out.slice(span.end);
  }
  function renameLane(text, oldClean, newClean) {
    const J = getJSON5(); if (!J) return null;
    let model; try { model = J.parse(text); } catch (e) { return null; }
    oldClean = String(oldClean).trim(); newClean = String(newClean).trim();
    if (!newClean || oldClean === newClean) return text;

    let out = text, changed = false;
    const newLanes = (model.lanes || []).map((raw) => {
      const pp = parseLanePrefix(raw);
      const prefix = raw.slice(0, raw.length - pp.clean.length);
      const nc = renameLaneToken(pp.clean, oldClean, newClean);
      if (nc !== pp.clean) changed = true;
      return prefix + nc;
    });
    if (!changed) return text;
    out = setLanes(out, newLanes);

    (model.messages || []).forEach((msg, i) => {
      // Paths may use '->' or '<-' (back arrow / self-message side); rename
      // through whichever separator is present and KEEP the notation. (#self-message)
      const raw = String(msg.path || '');
      const sep = raw.indexOf('->') >= 0 ? '->' : (raw.indexOf('<-') >= 0 ? '<-' : '->');
      const parts = raw.split(sep).map((s) => s.trim());
      const np = parts.map((p) => renameLaneToken(p, oldClean, newClean));
      if (np.join(sep) !== parts.join(sep)) {
        const span = locateArrayElement(out, 'messages', i);
        if (span) out = replaceFieldValue(out, span, 'path', quote(np.join(sep)));
      }
    });
    (model.states || []).forEach((st, i) => {
      const nl = renameLaneToken(st.lane, oldClean, newClean);
      if (nl !== String(st.lane).trim()) { const span = locateArrayElement(out, 'states', i); if (span) out = replaceFieldValue(out, span, 'lane', quote(nl)); }
    });
    (model.infoBoxes || []).forEach((ib, i) => {
      const nl = renameLaneToken(ib.lane, oldClean, newClean);
      if (nl !== String(ib.lane).trim()) { const span = locateArrayElement(out, 'infoBoxes', i); if (span) out = replaceFieldValue(out, span, 'lane', quote(nl)); }
    });
    (model.laneGroups || []).forEach((g, i) => {
      const nl = (g.lanes || []).map((l) => renameLaneToken(l, oldClean, newClean));
      if (JSON.stringify(nl) !== JSON.stringify(g.lanes || [])) {
        const span = locateArrayElement(out, 'laneGroups', i);
        if (span) out = replaceGroupLanes(out, span, nl);
      }
    });
    return out;
  }

  // Count references to a lane (for the delete confirmation label).
  function countLaneRefs(model, clean) {
    let n = 0;
    const hit = (t) => { const s = String(t == null ? '' : t).trim(); const p = s.split('.'); return s === clean || (p.length === 2 && (p[0] === clean || p[1] === clean)); };
    (model.messages || []).forEach((m) => { if (String(m.path || '').split(/<-|->/).map((s) => s.trim()).some(hit)) n++; });
    (model.states || []).forEach((s) => { if (hit(s.lane)) n++; });
    (model.infoBoxes || []).forEach((b) => { if (hit(b.lane)) n++; });
    (model.laneGroups || []).forEach((g) => { if ((g.lanes || []).some(hit)) n++; });
    return n;
  }

  // Delete a lane and cascade: remove the lane (and its sub-lanes), any messages
  // touching it, states/info on it, and its lane-group memberships (dropping a
  // group that becomes empty). Returns new text (or original if not found).
  function deleteLane(text, clean) {
    const J = getJSON5(); if (!J) return null;
    let model; try { model = J.parse(text); } catch (e) { return null; }
    clean = String(clean).trim();
    const removeNames = new Set();
    (model.lanes || []).forEach((raw) => {
      const c = parseLanePrefix(raw).clean, p = c.split('.');
      if (c === clean || (p.length === 2 && (p[0] === clean || p[1] === clean))) removeNames.add(c);
    });
    if (removeNames.size === 0) return text;
    const ref = (t) => removeNames.has(String(t == null ? '' : t).trim());

    let out = setLanes(text, (model.lanes || []).filter((raw) => !removeNames.has(parseLanePrefix(raw).clean)));
    const delHi = (key, idxs) => { idxs.sort((a, b) => b - a).forEach((i) => { const t = deleteArrayElement(out, key, i); if (t != null) out = t; }); };

    delHi('messages', (model.messages || []).map((m, i) => [m, i]).filter(([m]) => String(m.path || '').split(/<-|->/).map((s) => s.trim()).some(ref)).map(([, i]) => i));
    delHi('states', (model.states || []).map((s, i) => [s, i]).filter(([s]) => ref(s.lane)).map(([, i]) => i));
    delHi('infoBoxes', (model.infoBoxes || []).map((b, i) => [b, i]).filter(([b]) => ref(b.lane)).map(([, i]) => i));

    const emptyGroups = [];
    (model.laneGroups || []).forEach((g, i) => {
      const kept = (g.lanes || []).filter((l) => !ref(l));
      if (kept.length === 0) emptyGroups.push(i);
      else if (kept.length !== (g.lanes || []).length) { const span = locateArrayElement(out, 'laneGroups', i); if (span) out = replaceGroupLanes(out, span, kept); }
    });
    delHi('laneGroups', emptyGroups);
    return out;
  }

  // Locate an object-valued field's `{...}` span (for the options block).
  function locateObjectValue(text, key) {
    if (text == null) return null;
    const open = findTopLevelValue(text, key);
    if (open < 0 || text[open] !== '{') return null;
    let depth = 0, inStr = null;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'") { inStr = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return { open: open, close: i }; }
    }
    return null;
  }
  // Set options.<entity>.<field>=value (value null/''/'default' removes it).
  // Re-emits the whole options object (normalized) — acceptable for a settings block.
  function setOption(text, entity, field, value) {
    const J = getJSON5(); if (!J) return null;
    let model; try { model = J.parse(text); } catch (e) { return null; }
    const options = Object.assign({}, model.options || {});
    const e = Object.assign({}, options[entity] || {});
    if (value === null || value === '' || value === 'default' || (typeof value === 'number' && isNaN(value))) delete e[field];
    else e[field] = value;
    if (Object.keys(e).length === 0) delete options[entity]; else options[entity] = e;
    const loc = locateObjectValue(text, 'options');
    if (Object.keys(options).length === 0) {
      if (!loc) return text;
      // remove the now-empty options block (and a trailing comma if present)
      let s = loc.open, e2 = loc.close + 1;
      // back up to the 'options' key start
      const before = text.slice(0, s);
      const km = /(,?\s*)options\s*:\s*$/.exec(before);
      if (km) s = before.length - km[0].length;
      if (text[e2] === ',') e2++;
      return text.slice(0, s) + text.slice(e2);
    }
    const body = J.stringify(options, null, 2);
    if (loc) return text.slice(0, loc.open) + body + text.slice(loc.close + 1);
    const open = text.indexOf('{');
    if (open < 0) return null;
    return text.slice(0, open + 1) + '\n  options: ' + body + ',' + text.slice(open + 1);
  }

  // Distance from point to segment (diagram units), for forgiving hit-testing.
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  // --- structural edits (insert / delete array elements; lane list) ---

  // Locate an array section's bracket span: { open: index of '[', close: index of ']' }.
  function locateArray(text, key) {
    if (text == null) return null;
    const open = findTopLevelValue(text, key);
    if (open < 0 || text[open] !== '[') return null;
    let depth = 0, inStr = null;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'") { inStr = c; continue; }
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) return { open: open, close: i }; }
    }
    return null;
  }

  // Append a new element literal to an array section. If the section is missing,
  // create it right after the root object's '{'. Returns new text or null.
  function insertArrayElement(text, key, literal) {
    const arr = locateArray(text, key);
    if (!arr) {
      const open = text.indexOf('{');
      if (open < 0) return null;
      return text.slice(0, open + 1) + '\n  ' + key + ': [\n    ' + literal + '\n  ],' + text.slice(open + 1);
    }
    const inner = text.slice(arr.open + 1, arr.close);
    if (inner.trim() === '') {
      return text.slice(0, arr.open + 1) + '\n    ' + literal + '\n  ' + text.slice(arr.close);
    }
    let j = arr.close - 1;
    while (j > arr.open && /\s/.test(text[j])) j--;
    const sep = text[j] === ',' ? '' : ',';
    return text.slice(0, j + 1) + sep + '\n    ' + literal + text.slice(j + 1);
  }

  // Remove the index-th element plus one adjacent comma. Returns new text or null.
  function deleteArrayElement(text, key, index) {
    const span = locateArrayElement(text, key, index);
    if (!span) return null;
    let s = span.start, e = span.end;
    let k = e;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (text[k] === ',') { e = k + 1; }
    else { let p = s - 1; while (p >= 0 && /\s/.test(text[p])) p--; if (text[p] === ',') s = p; }
    return text.slice(0, s) + text.slice(e);
  }

  // Remove an entire top-level array-valued key (e.g. `legend: [...]`) plus one
  // adjacent comma. Returns new text or null if the key isn't found.
  function deleteTopLevelKey(text, key) {
    if (text == null) return null;
    const arr = locateArray(text, key);
    if (!arr) return null;
    let s = arr.open, e = arr.close + 1;
    // extend the start back over the `key:` (bare or quoted, with surrounding ws)
    const before = text.slice(0, s);
    const km = /(["']?)([A-Za-z0-9_$]+)\1\s*:\s*$/.exec(before);
    if (km && km[2] === key) s = before.length - km[0].length;
    // drop one adjacent comma — prefer the trailing one, else the leading one
    let k = e;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (text[k] === ',') { e = k + 1; }
    else { let p = s - 1; while (p >= 0 && /\s/.test(text[p])) p--; if (text[p] === ',') s = p; }
    return text.slice(0, s) + text.slice(e);
  }

  // Replace the lanes array with a fresh formatted list (used for add/reorder,
  // since lane order encodes horizontal position).
  function setLanes(text, lanesArray) {
    const arr = locateArray(text, 'lanes');
    if (!arr) return null;
    const body = lanesArray.map((l) => quote(l)).join(', ');
    return text.slice(0, arr.open) + '[' + body + ']' + text.slice(arr.close + 1);
  }
  function moveLane(text, from, to) {
    const J = getJSON5(); if (!J) return null;
    let model; try { model = J.parse(text); } catch (e) { return null; }
    const lanes = (model.lanes || []).slice();
    if (from < 0 || from >= lanes.length || to < 0 || to >= lanes.length) return null;
    const [item] = lanes.splice(from, 1);
    lanes.splice(to, 0, item);
    return setLanes(text, lanes);
  }

  // ========================================================================
  // Geometry (needs window.flowdromLayout from the engine).
  // ========================================================================

  function layout() { return (typeof window !== 'undefined' && window.flowdromLayout) || null; }
  function laneX(clean) { const L = layout(); if (!L) return null; const h = L.lanes.find((l) => l.clean === clean); return h ? h.x : null; }
  function nearestLaneClean(px) {
    const L = layout(); if (!L || !L.lanes.length) return null;
    let best = null, bestD = Infinity;
    for (const l of L.lanes) { const d = Math.abs(l.x - px); if (d < bestD) { bestD = d; best = l; } }
    return best ? best.clean : null;
  }
  function timeToY(t) { const L = layout(); return L.laneTop + t * L.timeStep; }
  function yToTime(y) { const L = layout(); return (y - L.laneTop) / L.timeStep; }
  // Resolve a frame's left/right margins, honoring the legacy single xMargin. (#frames)
  function frameMarginsE(frame) {
    const f = frame || {};
    const legacy = (typeof f.xMargin === 'number') ? f.xMargin : null;
    return {
      lm: (typeof f.lMargin === 'number') ? f.lMargin : (legacy != null ? legacy : FRAME_L_MARGIN),
      rm: (typeof f.rMargin === 'number') ? f.rMargin : (legacy != null ? legacy : FRAME_R_MARGIN),
    };
  }
  // Frame geometry in diagram units — mirrors main.js so hit-testing and handles
  // agree with the drawn box. Returns null if the frame references no known lane.
  // leftClean/rightClean are the frame's extreme lanes; lm/rm the resolved
  // margins (for horizontal stretch). No vertical margin. (#frames)
  function frameBox(frame) {
    const L = layout(); if (!L || !frame) return null;
    const lanesArr = (frame.lanes || []).map((n) => L.lanes.find((l) => l.clean === n)).filter(Boolean);
    if (!lanesArr.length) return null;
    const { lm, rm } = frameMarginsE(frame);
    let leftLane = lanesArr[0], rightLane = lanesArr[0];
    lanesArr.forEach((l) => { if (l.x < leftLane.x) leftLane = l; if (l.x > rightLane.x) rightLane = l; });
    const t0 = Math.min(frame.fromTime, frame.toTime), t1 = Math.max(frame.fromTime, frame.toTime);
    const x = leftLane.x - lm;
    return {
      x: x, y: timeToY(t0),
      w: (rightLane.x + rm) - x, h: (t1 - t0) * L.timeStep,
      leftX: leftLane.x, rightX: rightLane.x, leftClean: leftLane.clean, rightClean: rightLane.clean, lm: lm, rm: rm,
    };
  }
  // Main-lane clean names ordered left→right (frame horizontal span uses these). (#frames)
  function mainLanesLR() {
    const L = layout(); if (!L) return [];
    return L.lanes.filter((l) => l.clean.indexOf('.') === -1).slice().sort((a, b) => a.x - b.x).map((l) => l.clean);
  }
  // Snap to the time grid. Dividing/multiplying by 0.1 leaves binary FP noise
  // (e.g. 2.8000000000000003), so scale by the integer inverse and round the
  // result to keep clean values like 2.8.
  function snapTime(t) { const inv = Math.round(1 / SNAP_TIME); return Math.max(0, Math.round(t * inv) / inv); }

  function getContainer() { return document.getElementById('svg-container'); }
  function diagramSvg() { const c = getContainer(); return c ? c.querySelector('svg:not(.flowdrom-edit-overlay)') : null; }
  function parseModel() { const ed = getEditor(), J = getJSON5(); if (!ed || !J) return null; try { return J.parse(ed.getValue()); } catch (e) { return null; } }

  // Viewport px -> diagram user units, via the always-visible diagram svg CTM.
  function clientToDiagram(clientX, clientY) {
    const svg = diagramSvg();
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const inv = ctm.inverse();
    let p;
    if (typeof DOMPoint !== 'undefined') p = new DOMPoint(clientX, clientY);
    else { p = svg.createSVGPoint(); p.x = clientX; p.y = clientY; }
    const o = p.matrixTransform(inv);
    return { x: o.x, y: o.y };
  }

  // ========================================================================
  // Editor state.
  // ========================================================================

  let dragItem = null;      // { kind, index } currently in drag mode (handles shown)
  let menuEl = null;        // open popup menu element
  let creating = null;      // kind being drawn ('message' | 'state'), or null
  let createDrag = null;    // in-progress creation drag
  let ignoreNextClick = false; // swallow the click that ends a creation drag
  let groupSelecting = null; // Set of lane indices while building a lane group
  let groupBanner = null;    // the floating group-select confirm bar
  let groupEditIndex = null; // index of the group being edited (null = creating new)
  let selection = [];        // multi-select: [{kind,index}] toggled via ctrl+click
  let groupDrag = null;      // in-progress group time-shift drag
  let subLaneOf = null;      // { childIndex, childClean } while picking a parent lane
  let subLaneBanner = null;  // the floating "click the parent lane" prompt bar

  // ========================================================================
  // Selection box (sibling div over the container) + item labelling.
  // ========================================================================

  function selBox() {
    const container = getContainer();
    let ov = container.querySelector(':scope > .flowdrom-sel-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'flowdrom-sel-overlay';
      ov.style.cssText = 'position:absolute;pointer-events:none;border:1.5px solid var(--edit-accent);border-radius:var(--radius-xs);background:var(--edit-accent-soft);display:none;z-index:5;';
      container.appendChild(ov);
    }
    return ov;
  }
  function clearSelBox() { const c = getContainer(); const ov = c && c.querySelector(':scope > .flowdrom-sel-overlay'); if (ov) ov.style.display = 'none'; }

  // ---- multi-selection (ctrl+click) -------------------------------------
  // Only time-bearing kinds can take part in a shared time shift.
  const SHIFTABLE = { message: true, state: true, infoBox: true, frame: true };

  function toggleSelection(it) {
    const i = selection.findIndex((s) => s.kind === it.kind && s.index === it.index);
    if (i >= 0) selection.splice(i, 1); else selection.push({ kind: it.kind, index: it.index });
  }
  function clearSelection() { selection = []; renderSelectionBoxes(); }

  // One dashed box per selected item (separate from the single-item selBox).
  function renderSelectionBoxes(pixelDY) {
    const container = getContainer(); if (!container) return;
    container.querySelectorAll(':scope > .flowdrom-sel-multi').forEach((n) => n.remove());
    const dy = pixelDY || 0;
    const c = container.getBoundingClientRect(); const pad = 4;
    selection.forEach((it) => {
      const els = itemElements(it.kind, it.index);
      if (!els.length) return;
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const e of els) { const cr = e.getBoundingClientRect(); l = Math.min(l, cr.left); t = Math.min(t, cr.top); r = Math.max(r, cr.right); b = Math.max(b, cr.bottom); }
      if (!isFinite(l)) return;
      const box = document.createElement('div');
      box.className = 'flowdrom-sel-multi';
      box.style.cssText = 'position:absolute;pointer-events:none;border:1.5px solid var(--edit-accent);border-radius:var(--radius-xs);background:var(--edit-accent-soft);z-index:5;';
      box.style.left = l - c.left + container.scrollLeft - pad + 'px';
      box.style.top = t - c.top + container.scrollTop - pad + dy + 'px';
      box.style.width = r - l + 2 * pad + 'px';
      box.style.height = b - t + 2 * pad + 'px';
      container.appendChild(box);
    });
  }

  // True when (clientX,clientY) falls inside the highlight box of any selected
  // item — the grab region for starting a group drag. Uses the same bounding
  // box + padding the dashed boxes are drawn with, so for a message the whole
  // box (not just the thin arrow) is grabbable.
  function pointInSelection(clientX, clientY) {
    const pad = 4;
    return selection.some((it) => {
      const els = itemElements(it.kind, it.index);
      if (!els.length) return false;
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const e of els) { const cr = e.getBoundingClientRect(); l = Math.min(l, cr.left); t = Math.min(t, cr.top); r = Math.max(r, cr.right); b = Math.max(b, cr.bottom); }
      if (!isFinite(l)) return false;
      return clientX >= l - pad && clientX <= r + pad && clientY >= t - pad && clientY <= b + pad;
    });
  }

  // Smallest time value across the selection (the binding constraint when
  // shifting down — we never let any time go below 0).
  function selectionMinTime(model) {
    let min = Infinity;
    selection.forEach((it) => {
      try {
        if (it.kind === 'message') { const m = model.messages[it.index]; min = Math.min(min, m.fromTime, m.toTime); }
        else if (it.kind === 'state') { const s = model.states[it.index]; min = Math.min(min, s.fromTime, s.toTime != null ? s.toTime : s.fromTime); }
        else if (it.kind === 'infoBox') { min = Math.min(min, model.infoBoxes[it.index].time); }
        else if (it.kind === 'frame') { const f = model.frames[it.index]; min = Math.min(min, f.fromTime, f.toTime); }
      } catch (e) { /* ignore */ }
    });
    return isFinite(min) ? min : 0;
  }

  // Apply a single time delta to every selected (time-bearing) item.
  function commitGroupShift(dt) {
    const ed = getEditor(); const model = parseModel();
    if (!ed || !model || !dt) return;
    let text = ed.getValue();
    selection.forEach((it) => {
      if (it.kind === 'message') {
        const m = model.messages[it.index]; if (!m) return;
        text = setElementFields(text, 'messages', it.index, [
          { field: 'fromTime', literal: numLiteral(m.fromTime + dt) },
          { field: 'toTime', literal: numLiteral(m.toTime + dt) },
        ]) || text;
      } else if (it.kind === 'state') {
        const s = model.states[it.index]; if (!s) return;
        const to = (s.toTime != null ? s.toTime : s.fromTime) + dt;
        text = setOrInsertField(text, 'states', it.index, 'fromTime', numLiteral(s.fromTime + dt)) || text;
        text = setOrInsertField(text, 'states', it.index, 'toTime', numLiteral(to)) || text;
      } else if (it.kind === 'infoBox') {
        const b = model.infoBoxes[it.index]; if (!b) return;
        text = setOrInsertField(text, 'infoBoxes', it.index, 'time', numLiteral(b.time + dt)) || text;
      } else if (it.kind === 'frame') {
        const f = model.frames[it.index]; if (!f) return;
        text = setOrInsertField(text, 'frames', it.index, 'fromTime', numLiteral(f.fromTime + dt)) || text;
        text = setOrInsertField(text, 'frames', it.index, 'toTime', numLiteral(f.toTime + dt)) || text;
      }
    });
    applyText(text);
    renderSelectionBoxes(); // indices are stable across a time shift
  }

  // Floating "Δt = …" badge shown while dragging a multi-selection.
  function shiftBadge() {
    let b = document.querySelector('.flowdrom-shift-badge');
    if (!b) {
      b = document.createElement('div');
      b.className = 'flowdrom-shift-badge';
      document.body.appendChild(b);
    }
    return b;
  }
  function removeShiftBadge() { const b = document.querySelector('.flowdrom-shift-badge'); if (b) b.remove(); }

  function startGroupDrag(ev) {
    const svg = diagramSvg();
    let scale = 1;
    if (svg && svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) {
      scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    }
    groupDrag = { startClientY: ev.clientY, minTime: selectionMinTime(parseModel() || {}), moved: false, dt: 0, scale: scale };
    document.body.style.userSelect = 'none'; // block text selection during the drag (we no longer preventDefault the press) (#1)
    window.addEventListener('pointermove', onGroupDragMove, true);
    window.addEventListener('pointerup', onGroupDragUp, true);
  }
  function onGroupDragMove(ev) {
    if (!groupDrag) return;
    const startD = clientToDiagram(ev.clientX, groupDrag.startClientY);
    const curD = clientToDiagram(ev.clientX, ev.clientY);
    if (!startD || !curD) return;
    const rawDt = yToTime(curD.y) - yToTime(startD.y);
    // Group shift always snaps to the time grid (0.1).
    let dt = Math.round(rawDt / SNAP_TIME) * SNAP_TIME;
    dt = Math.max(dt, -groupDrag.minTime); // never push a time below 0
    groupDrag.dt = dt;
    if (Math.abs(ev.clientY - groupDrag.startClientY) > 3) groupDrag.moved = true;
    const L = layout();
    renderSelectionBoxes(dt * (L ? L.timeStep : 50) * groupDrag.scale);
    const b = shiftBadge();
    b.textContent = 'Δt = ' + (dt >= 0 ? '+' : '') + numLiteral(dt);
    b.style.left = (ev.clientX + 14) + 'px';
    b.style.top = (ev.clientY + 14) + 'px';
  }
  function onGroupDragUp() {
    window.removeEventListener('pointermove', onGroupDragMove, true);
    window.removeEventListener('pointerup', onGroupDragUp, true);
    document.body.style.userSelect = '';
    const d = groupDrag; groupDrag = null;
    removeShiftBadge();
    if (d && d.moved && d.dt) { ignoreNextClick = true; commitGroupShift(d.dt); }
    else { renderSelectionBoxes(); }
  }

  // ---- rubber-band selection (drag on empty canvas) ---------------------
  // Drag a rectangle over empty space to select every time-bearing item it
  // touches, instead of ctrl+clicking each one. (#4)
  let rubber = null;

  function itemsInRect(rect) {
    const out = []; const model = parseModel(); if (!model) return out;
    const sets = [['message', model.messages], ['state', model.states], ['infoBox', model.infoBoxes]];
    sets.forEach((pair) => {
      const kind = pair[0]; (pair[1] || []).forEach((_, i) => {
        const els = itemElements(kind, i); if (!els.length) return;
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (const e of els) { const c = e.getBoundingClientRect(); l = Math.min(l, c.left); t = Math.min(t, c.top); r = Math.max(r, c.right); b = Math.max(b, c.bottom); }
        if (!isFinite(l)) return;
        // Non-greedy: the item must be fully enclosed by the rectangle, not just
        // touched by it. (#4)
        if (l >= rect.left && r <= rect.right && t >= rect.top && b <= rect.bottom) out.push({ kind: kind, index: i });
      });
    });
    return out;
  }
  function startRubberBand(ev) {
    closeMenu(); exitDrag();
    const container = getContainer(); if (!container) return;
    const el = document.createElement('div');
    el.className = 'flowdrom-rubber';
    el.style.cssText = 'position:absolute;pointer-events:none;border:1px dashed var(--edit-accent);background:var(--edit-accent-soft);border-radius:var(--radius-xs);z-index:7;';
    container.appendChild(el);
    rubber = { sx: ev.clientX, sy: ev.clientY, cx: ev.clientX, cy: ev.clientY, moved: false, el: el };
    window.addEventListener('pointermove', onRubberMove, true);
    window.addEventListener('pointerup', onRubberUp, true);
    ev.preventDefault();
  }
  function onRubberMove(ev) {
    if (!rubber) return;
    rubber.cx = ev.clientX; rubber.cy = ev.clientY;
    if (Math.abs(ev.clientX - rubber.sx) > 3 || Math.abs(ev.clientY - rubber.sy) > 3) rubber.moved = true;
    const container = getContainer(); const c = container.getBoundingClientRect();
    const l = Math.min(rubber.sx, rubber.cx), t = Math.min(rubber.sy, rubber.cy);
    const r = Math.max(rubber.sx, rubber.cx), b = Math.max(rubber.sy, rubber.cy);
    rubber.el.style.left = (l - c.left + container.scrollLeft) + 'px';
    rubber.el.style.top = (t - c.top + container.scrollTop) + 'px';
    rubber.el.style.width = (r - l) + 'px';
    rubber.el.style.height = (b - t) + 'px';
  }
  function onRubberUp() {
    window.removeEventListener('pointermove', onRubberMove, true);
    window.removeEventListener('pointerup', onRubberUp, true);
    const rb = rubber; rubber = null;
    if (rb && rb.el && rb.el.parentNode) rb.el.parentNode.removeChild(rb.el);
    if (!rb) return;
    if (!rb.moved) { clearSelection(); return; } // a plain click on empty space
    const rect = { left: Math.min(rb.sx, rb.cx), top: Math.min(rb.sy, rb.cy), right: Math.max(rb.sx, rb.cx), bottom: Math.max(rb.sy, rb.cy) };
    selection = itemsInRect(rect);
    renderSelectionBoxes();
    ignoreNextClick = true; // swallow the click that ends the drag
  }

  // ---- multi-selection actions (menu on right-click inside selection) ----

  function setSelectionField(items, field, literal) {
    const ed = getEditor(); if (!ed) return;
    let text = ed.getValue();
    items.forEach((it) => { // field edits don't shift indices, so order is free
      const key = SECTION_BY_KIND[it.kind]; if (!key) return;
      const t = setOrInsertField(text, key, it.index, field, literal);
      if (t != null) text = t;
    });
    applyText(text); renderSelectionBoxes();
  }
  function deleteSelection() {
    const ed = getEditor(); if (!ed) return;
    let text = ed.getValue();
    const byKind = {};
    selection.forEach((it) => { (byKind[it.kind] = byKind[it.kind] || []).push(it.index); });
    Object.keys(byKind).forEach((kind) => {
      const key = SECTION_BY_KIND[kind]; if (!key) return;
      byKind[kind].sort((a, b) => b - a).forEach((i) => { const t = deleteArrayElement(text, key, i); if (t != null) text = t; });
    });
    clearSelection(); exitDrag(); applyText(text);
  }
  function cloneWithOffset(obj, kind, dt) {
    const c = Object.assign({}, obj); const r3 = (x) => parseFloat((x).toFixed(3));
    if (kind === 'message' || kind === 'state' || kind === 'frame') { if (c.fromTime != null) c.fromTime = r3(c.fromTime + dt); if (c.toTime != null) c.toTime = r3(c.toTime + dt); }
    else if (kind === 'infoBox') { if (c.time != null) c.time = r3(c.time + dt); }
    return c;
  }
  // Duplicate each given item one time-unit below, then select the copies so they
  // can be dragged into place (works for a single item or a multi-selection). (#2)
  function duplicateItems(items) {
    const ed = getEditor(); const model = parseModel(); const J = getJSON5();
    if (!ed || !model || !J || !items.length) return;
    const dt = 1; let text = ed.getValue(); const newSel = [];
    const arrs = { message: model.messages || [], state: model.states || [], infoBox: model.infoBoxes || [], legend: model.legend || [], frame: model.frames || [] };
    const counts = { message: arrs.message.length, state: arrs.state.length, infoBox: arrs.infoBox.length, legend: arrs.legend.length, frame: arrs.frame.length };
    items.forEach((it) => {
      const arr = arrs[it.kind]; if (!arr || !arr[it.index]) return;
      const key = SECTION_BY_KIND[it.kind]; if (!key) return;
      // Time-bearing kinds drop one time-unit below; a legend copy is identical
      // (it just appends a new row). (#4)
      const literal = J.stringify(cloneWithOffset(arr[it.index], it.kind, dt));
      const t = insertArrayElement(text, key, literal); // appends → new index = current length
      if (t != null) { text = t; newSel.push({ kind: it.kind, index: counts[it.kind] }); counts[it.kind]++; }
    });
    // Only auto-select copies that can actually be time-shifted by dragging; a
    // legend copy isn't draggable, so leave the selection clear for it. (#4)
    selection = newSel.filter((s) => SHIFTABLE[s.kind]);
    applyText(text); renderSelectionBoxes();
  }
  function duplicateSelection() { duplicateItems(selection); }
  function showSelectionColorMenu(clientX, clientY) {
    const colorable = selection.filter((s) => HAS_COLOR[s.kind]);
    if (!colorable.length) return;
    // Reuse the shared picker so a multi-selection gets the same "most used
    // colors first" section as a single item. A single-kind selection is scoped
    // to that kind (right palette + its own used colors — states get pastels);
    // a mixed selection aggregates used colors across all colorable kinds.
    const kinds = Array.from(new Set(colorable.map((s) => s.kind)));
    const kind = kinds.length === 1 ? kinds[0] : null;
    // Pre-fill Custom with the current color when the whole selection agrees.
    const model = parseModel();
    const colors = Array.from(new Set(colorable.map((s) => currentField(model, s, 'color') || '')));
    const current = colors.length === 1 ? colors[0] : '';
    showColorPicker(kind, clientX, clientY, current,
      (c) => setSelectionField(colorable, 'color', quote(c)),
      'Color ' + colorable.length + ' items:');
  }
  function showSelectionMenu(clientX, clientY) {
    const menu = buildMenu(clientX, clientY);
    addHeader(menu, selection.length + ' items selected');
    addRow(menu, '✥  Drag the box to move in time', () => { closeMenu(); }, { muted: true });
    addRow(menu, '⧉  Duplicate (below)', () => { closeMenu(); duplicateSelection(); });
    if (selection.some((s) => HAS_COLOR[s.kind])) addRow(menu, '●  Change color ▸', () => { showSelectionColorMenu(clientX, clientY); });
    const styleable = selection.filter((s) => HAS_STYLE[s.kind]);
    if (styleable.length) {
      addRow(menu, '┄  Make dashed', () => { closeMenu(); setSelectionField(styleable, 'style', quote('dashed')); });
      addRow(menu, '─  Make solid', () => { closeMenu(); setSelectionField(styleable, 'style', quote('solid')); });
    }
    addRow(menu, '✕  Delete all', () => { closeMenu(); deleteSelection(); });
  }

  function itemElements(kind, index) {
    const svg = diagramSvg();
    if (!svg) return [];
    return Array.prototype.slice.call(svg.querySelectorAll('[data-kind="' + kind + '"][data-index="' + index + '"]'));
  }

  function highlightItem(item) {
    const els = itemElements(item.kind, item.index);
    if (!els.length) { clearSelBox(); return; }
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    // Zero-size rects (empty text nodes) sit at stray anchors — never union them.
    for (const e of els) { const cr = e.getBoundingClientRect(); if (!cr.width && !cr.height) continue; l = Math.min(l, cr.left); t = Math.min(t, cr.top); r = Math.max(r, cr.right); b = Math.max(b, cr.bottom); }
    if (l === Infinity) { clearSelBox(); return; }
    const container = getContainer(); const c = container.getBoundingClientRect(); const ov = selBox(); const pad = 4;
    ov.style.left = l - c.left + container.scrollLeft - pad + 'px';
    ov.style.top = t - c.top + container.scrollTop - pad + 'px';
    ov.style.width = r - l + 2 * pad + 'px';
    ov.style.height = b - t + 2 * pad + 'px';
    ov.style.display = 'block';
  }

  // ========================================================================
  // Hover affordance — at rest, show a faint outline + pointer cursor over any
  // editable item so the canvas advertises that it is directly editable.
  // ========================================================================

  let hoverRAF = 0;

  function hoverEl() {
    const container = getContainer();
    let ov = container.querySelector(':scope > .flowdrom-hover-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'flowdrom-hover-overlay';
      ov.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:4;';
      container.appendChild(ov);
    }
    return ov;
  }
  function clearHover() {
    const c = getContainer(); if (!c) return;
    const ov = c.querySelector(':scope > .flowdrom-hover-overlay'); if (ov) ov.style.display = 'none';
    if (c.style.cursor === 'pointer') c.style.cursor = '';
  }
  function showHover(item) {
    const els = itemElements(item.kind, item.index);
    if (!els.length) { clearHover(); return; }
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    // Zero-size rects (empty text nodes) sit at stray anchors — never union them.
    for (const e of els) { const cr = e.getBoundingClientRect(); if (!cr.width && !cr.height) continue; l = Math.min(l, cr.left); t = Math.min(t, cr.top); r = Math.max(r, cr.right); b = Math.max(b, cr.bottom); }
    if (l === Infinity) { clearHover(); return; }
    const container = getContainer(); const c = container.getBoundingClientRect(); const ov = hoverEl(); const pad = 3;
    ov.style.left = l - c.left + container.scrollLeft - pad + 'px';
    ov.style.top = t - c.top + container.scrollTop - pad + 'px';
    ov.style.width = r - l + 2 * pad + 'px';
    ov.style.height = b - t + 2 * pad + 'px';
    ov.style.display = 'block';
  }
  function onCanvasHover(ev) {
    if (hoverRAF) return;
    const cx = ev.clientX, cy = ev.clientY;
    hoverRAF = requestAnimationFrame(() => {
      hoverRAF = 0;
      const container = getContainer(); if (!container) return;
      // Don't compete with an open menu, a drag, creation or group selection.
      if (menuEl || dragItem || creating || groupSelecting || groupDrag) { clearHover(); return; }
      const cands = candidatesAt(cx, cy);
      if (cands && cands.length) { container.style.cursor = 'pointer'; showHover(cands[0]); }
      else { clearHover(); }
    });
  }

  function labelFor(item, model) {
    const m = model || {};
    try {
      if (item.kind === 'message') { const x = m.messages[item.index]; return 'Message  ' + (x.path || '') + (x.label ? '  “' + String(x.label).split('|')[0] + '”' : ''); }
      if (item.kind === 'state') { const x = m.states[item.index]; return 'State  “' + (x.label || '') + '” @ ' + x.lane; }
      if (item.kind === 'infoBox') { const x = m.infoBoxes[item.index]; return 'Info @ ' + x.lane + '  t' + x.time; }
      if (item.kind === 'lane') { return 'Lane  ' + m.lanes[item.index]; }
      if (item.kind === 'laneGroup') { return 'Group  ' + m.laneGroups[item.index].label; }
      if (item.kind === 'frame') { const x = m.frames[item.index]; return 'Frame  “' + (x.label || '') + '”'; }
      if (item.kind === 'legend') { const x = m.legend[item.index]; return 'Legend  “' + (x.label || '') + '”'; }
      if (item.kind === 'legendBox') { return 'Legend (whole)  ' + ((m.legend || []).length) + ' entries'; }
      if (item.kind === 'title') { return 'Title  “' + (m.title || '') + '”'; }
    } catch (e) { /* fall through */ }
    return item.kind + '[' + item.index + ']';
  }

  // ========================================================================
  // Hit-testing: all tagged items under a viewport point (disambiguation).
  // ========================================================================

  // candidatesAt is the hot path: it re-parses the model and measures every
  // tagged SVG element. Hover calls it on each mousemove and a click calls it
  // again for the SAME point a moment later, so cache the last result keyed by
  // the viewport point. Invalidated whenever the diagram could have moved
  // (render / scroll / zoom / resize). (#1 perf)
  let candCache = null;
  function invalidateCandidates() { candCache = null; }

  function candidatesAt(clientX, clientY) {
    if (candCache && candCache.x === clientX && candCache.y === clientY) return candCache.out;
    const seen = {}; const out = [];
    const add = (kind, index) => { const id = kind + ':' + index; if (!seen[id]) { seen[id] = true; out.push({ kind: kind, index: index }); } };

    // 1) exact hits. elementsFromPoint yields leaf nodes (e.g. a state's inner
    // <rect>); the data-kind tag may live on an ancestor <g>, so climb.
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      let node = el;
      while (node && node.getAttribute) {
        const kind = node.getAttribute('data-kind');
        if (kind) { const i = parseInt(node.getAttribute('data-index'), 10); if (!isNaN(i)) add(kind, i); break; }
        node = node.parentNode;
      }
    }

    // 2) proximity for THIN targets (message arrows, lane lines), so you don't
    // have to land pixel-perfectly on the stroke.
    const L = layout(), model = parseModel(), svg = diagramSvg(), p = clientToDiagram(clientX, clientY);
    if (L && model && svg && p) {
      const vbW = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.width : null;
      const scale = (vbW ? svg.getBoundingClientRect().width / vbW : 1) || 1;
      const tolMsg = 10 / scale, tolLane = 6 / scale;
      (model.messages || []).forEach((msg, i) => {
        const pp = pathInfo(msg);
        if (!pp) return;
        const x1 = laneX(pp.from), y1 = timeToY(msg.fromTime), x2 = laneX(pp.to), y2 = timeToY(msg.toTime);
        if (x1 == null || x2 == null) return;
        if (pp.self) {
          // Self loop: test its three segments (out, far vertical, back) with
          // the same geometry the renderer uses. (#self-message)
          const dir = pp.side === 'left' ? -1 : 1;
          const gph = (model.options && model.options.graph) || {};
          const w = (gph.selfMessageWidth > 0) ? gph.selfMessageWidth : 60;
          const yb = (Math.abs(y2 - y1) < L.timeStep * 0.25) ? y1 + L.timeStep * 0.25 : y2;
          const xf = x1 + dir * w;
          if (distToSeg(p.x, p.y, x1, y1, xf, y1) <= tolMsg ||
              distToSeg(p.x, p.y, xf, y1, xf, yb) <= tolMsg ||
              distToSeg(p.x, p.y, xf, yb, x1, yb) <= tolMsg) add('message', i);
        } else if (distToSeg(p.x, p.y, x1, y1, x2, y2) <= tolMsg) add('message', i);
      });
      const top = L.laneTop, bot = L.laneTop + L.maxTime * L.timeStep;
      (L.lanes || []).forEach((ln) => { if (Math.abs(p.x - ln.x) <= tolLane && p.y >= top - tolLane && p.y <= bot + tolLane) add('lane', ln.index); });
      // Frames: hit on the BORDER (not the transparent interior, which would
      // shadow everything inside). Near any of the 4 edges = a hit; the label
      // tab is a filled shape caught by the exact-hit pass above. (#frames)
      const tolFrame = 7 / scale;
      (model.frames || []).forEach((frame, i) => {
        const fb = frameBox(frame); if (!fb) return;
        const nearV = (p.y >= fb.y - tolFrame && p.y <= fb.y + fb.h + tolFrame);
        const nearH = (p.x >= fb.x - tolFrame && p.x <= fb.x + fb.w + tolFrame);
        const onLeft = Math.abs(p.x - fb.x) <= tolFrame, onRight = Math.abs(p.x - (fb.x + fb.w)) <= tolFrame;
        const onTop = Math.abs(p.y - fb.y) <= tolFrame, onBot = Math.abs(p.y - (fb.y + fb.h)) <= tolFrame;
        if ((nearV && (onLeft || onRight)) || (nearH && (onTop || onBot))) add('frame', i);
      });
    }

    // 3) bounding-box proximity for small / thin boxed items whose strokes are
    //    hard to land on exactly (legend rows + their swatch lines, states,
    //    info boxes, titles, group labels). Union each item's tagged elements
    //    and expand by a forgiving margin. Diagonal items (messages) and lane
    //    lines are excluded — they have their own geometric proximity above.
    const BBOX_KINDS = { legend: 1, legendBox: 1, state: 1, infoBox: 1, title: 1, laneGroup: 1 };
    const TOL_PX = 9;
    const groups = {};
    if (svg) {
      svg.querySelectorAll('[data-kind]').forEach((el) => {
        const kind = el.getAttribute('data-kind'); if (!BBOX_KINDS[kind]) return;
        const i = parseInt(el.getAttribute('data-index'), 10); if (isNaN(i)) return;
        const r = el.getBoundingClientRect(); const id = kind + ':' + i;
        const g = groups[id] || (groups[id] = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity, kind: kind, i: i });
        g.l = Math.min(g.l, r.left); g.t = Math.min(g.t, r.top); g.r = Math.max(g.r, r.right); g.b = Math.max(g.b, r.bottom);
      });
      Object.keys(groups).forEach((id) => {
        const g = groups[id];
        if (clientX >= g.l - TOL_PX && clientX <= g.r + TOL_PX && clientY >= g.t - TOL_PX && clientY <= g.b + TOL_PX) add(g.kind, g.i);
      });
    }

    // Among overlapping states (nested activation bars), prefer the SMALLER
    // one: a thin bar inside a wide 'busy' state is the harder target and
    // nearly always the intended one — otherwise the container's exact hit
    // outranks the bar whenever the pointer is merely NEAR it. Reorders only
    // the state entries, in place, by ascending bbox area. (#activation)
    const stateSlots = [];
    out.forEach((c, idx) => { if (c.kind === 'state') stateSlots.push(idx); });
    if (stateSlots.length > 1) {
      const area = (c) => { const g = groups['state:' + c.index]; return g ? (g.r - g.l) * (g.b - g.t) : Infinity; };
      const sorted = stateSlots.map((idx) => out[idx]).sort((a, b) => area(a) - area(b));
      stateSlots.forEach((slot, k) => { out[slot] = sorted[k]; });
    }

    // Container kinds (the whole-legend box) should rank below the individual
    // items they enclose, so hover/click target the specific item first.
    const CONTAINER = { legendBox: 1 };
    out.sort((a, b) => (CONTAINER[a.kind] ? 1 : 0) - (CONTAINER[b.kind] ? 1 : 0));
    candCache = { x: clientX, y: clientY, out: out };
    return out;
  }

  // ========================================================================
  // Popup menu.
  // ========================================================================

  function closeMenu() { if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl); menuEl = null; }

  function buildMenu(x, y) {
    closeMenu();
    const el = document.createElement('div');
    el.className = 'flowdrom-menu';
    document.body.appendChild(el);
    menuEl = el;
    // Position now; clamp after it has a size.
    el.style.left = x + 'px'; el.style.top = y + 'px';
    requestAnimationFrame(() => {
      if (!menuEl) return;
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth) el.style.left = Math.max(0, window.innerWidth - r.width - 4) + 'px';
      if (r.bottom > window.innerHeight) el.style.top = Math.max(0, window.innerHeight - r.height - 4) + 'px';
    });
    return el;
  }
  function addHeader(menu, text) {
    const h = document.createElement('div');
    h.textContent = text;
    h.className = 'flowdrom-menu-header';
    menu.appendChild(h);
  }
  // Build a menu row with an aligned icon gutter, a label, and (when the label
  // ends in "▸") a right-aligned submenu chevron. Pass opts.swatch = color to
  // render a color chip in the gutter instead of a glyph.
  function addRow(menu, text, onClick, opts) {
    opts = opts || {};
    const row = document.createElement('div');
    row.className = 'flowdrom-menu-row' + (opts.muted ? ' muted' : '');

    let icon = '', label = text, submenu = false;
    // Only a single leading symbol (non-word, non-space) counts as an icon, so
    // multi-word labels like 'Message  CA0->HN' are never split into the gutter.
    const m = /^([^\w\s])\s{2,}([\s\S]*)$/.exec(text);
    if (m) { icon = m[1]; label = m[2]; }
    if (/\s▸\s*$/.test(label)) { submenu = true; label = label.replace(/\s▸\s*$/, ''); }

    const ic = document.createElement('span');
    ic.className = 'flowdrom-menu-ic' + (opts.swatch ? ' chip' : '');
    if (opts.swatch) ic.style.background = opts.swatch; else ic.textContent = icon;
    const lb = document.createElement('span');
    lb.className = 'flowdrom-menu-lbl';
    lb.textContent = label;
    row.appendChild(ic);
    row.appendChild(lb);
    if (submenu) { const ch = document.createElement('span'); ch.className = 'flowdrom-menu-chev'; ch.textContent = '›'; row.appendChild(ch); }

    row.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    menu.appendChild(row);
    return row;
  }

  // Actions for the clicked item (no disambiguation picker — the hover
  // highlight already shows which item a click will act on).
  function showActions(item, clientX, clientY) {
    const model = parseModel();
    highlightItem(item);
    const menu = buildMenu(clientX, clientY);
    addHeader(menu, labelFor(item, model));

    // The legend as a whole (its box/title) — only action is removing it entirely.
    if (item.kind === 'legendBox') {
      addRow(menu, '⟶  Go to JSON definition', () => { closeMenu(); gotoLegend(); });
      addRow(menu, '✕  Delete entire legend', () => { closeMenu(); deleteLegend(); });
      return;
    }

    if (item.kind === 'lane') {
      addRow(menu, '✥  Drag', () => { closeMenu(); enterDrag(item); });
      addRow(menu, '✎  Rename…', () => { renameLanePrompt(item, clientX, clientY); });
      const laneClean = parseLanePrefix(model.lanes[item.index]).clean;
      const isMedium = laneClean.startsWith('_') && laneClean.endsWith('_') && laneClean.length > 1;
      const isSub = laneClean.includes('.');
      if (isMedium || isSub) {
        addRow(menu, '▮  Make primary lane', () => { closeMenu(); makeLanePrimary(item); });
      } else {
        addRow(menu, '⌹  Make sub-lane of…', () => { closeMenu(); startSubLaneSelect(item); });
        addRow(menu, '▦  Make medium lane', () => { closeMenu(); convertLane(item, 'medium'); });
      }
    } else if (DRAGGABLE[item.kind]) {
      addRow(menu, '✥  Drag', () => { closeMenu(); enterDrag(item); });
    }

    if (SHIFTABLE[item.kind] || item.kind === 'legend') addRow(menu, '⧉  Duplicate', () => { closeMenu(); duplicateItems([item]); });

    if (TEXTABLE[item.kind]) {
      const label = hasText(item, model) ? '✎  Edit text…' : '✎  Add text…';
      addRow(menu, label, () => { editText(item, clientX, clientY); });
    }
    if (HAS_COLOR[item.kind]) addRow(menu, '●  Change color ▸', () => { showColorMenu(item, clientX, clientY); });
    if (item.kind === 'state') {
      const w = currentField(model, item, 'width');
      addRow(menu, '↔  Width… ' + (typeof w === 'number' ? '(' + w + 'px)' : '(auto)'),
        () => { setStateWidth(item, clientX, clientY); });
    }
    if (item.kind === 'frame') {
      const fr = (model.frames || [])[item.index] || {};
      const lg = (typeof fr.xMargin === 'number') ? fr.xMargin : null;
      const lm = (typeof fr.lMargin === 'number') ? fr.lMargin : (lg != null ? lg : FRAME_L_MARGIN);
      const rm = (typeof fr.rMargin === 'number') ? fr.rMargin : (lg != null ? lg : FRAME_R_MARGIN);
      addRow(menu, '●  Background… ' + (fr.background ? '(' + fr.background + ')' : '(none)'), () => { setBackground(item, clientX, clientY); });
      addRow(menu, '↤  Left margin… (' + lm + 'px)', () => { setFrameMargin(item, 'lMargin', clientX, clientY); });
      addRow(menu, '↦  Right margin… (' + rm + 'px)', () => { setFrameMargin(item, 'rMargin', clientX, clientY); });
    }
    if (item.kind === 'infoBox') {
      const ib = (model.infoBoxes || [])[item.index] || {};
      addRow(menu, '●  Background… ' + (ib.background ? '(' + ib.background + ')' : '(none)'), () => { setBackground(item, clientX, clientY); });
    }
    if (HAS_STYLE[item.kind]) {
      const style = (currentField(model, item, 'style') === 'dashed') ? 'solid' : 'dashed';
      addRow(menu, '┄  Make ' + style, () => { closeMenu(); setItemField(item, 'style', quote(style)); });
    }
    if (item.kind === 'laneGroup') addRow(menu, '☷  Edit members…', () => { closeMenu(); startGroupSelect(item.index); });
    if (item.kind !== 'title') addRow(menu, '⟶  Go to JSON definition', () => { closeMenu(); gotoDefinition(item); });
    if (DELETABLE[item.kind]) addRow(menu, '✕  Delete', () => { closeMenu(); deleteItem(item); });
    if (item.kind === 'lane') {
      const refs = countLaneRefs(model, parseLanePrefix(model.lanes[item.index]).clean);
      addRow(menu, '✕  Delete lane' + (refs ? ' (+ ' + refs + ' refs)' : ''), () => { closeMenu(); deleteLaneAction(item); });
    }
  }

  function deleteLaneAction(item) {
    const ed = getEditor(); const model = parseModel();
    if (!ed || !model) return;
    const text = deleteLane(ed.getValue(), parseLanePrefix(model.lanes[item.index]).clean);
    if (text != null) { exitDrag(); applyText(text); }
  }
  function convertLane(item, mode) {
    const ed = getEditor(); const model = parseModel();
    if (!ed || !model) return;
    const clean = parseLanePrefix(model.lanes[item.index]).clean;
    let nn = clean;
    if (mode === 'medium') nn = '_' + clean.replace(/^_+|_+$/g, '') + '_';
    const text = renameLane(ed.getValue(), clean, nn);
    if (text != null) applyText(text);
  }
  // Revert a sub-lane or medium lane back to a primary lane: drop the parent
  // (Parent.Sub → Sub) or the medium underscores (_X_ → X). renameLane cascades
  // the change to every reference. (lane menu)
  function makeLanePrimary(item) {
    const ed = getEditor(); const model = parseModel();
    if (!ed || !model) return;
    const clean = parseLanePrefix(model.lanes[item.index]).clean;
    let nn = clean;
    if (clean.includes('.')) {
      const parts = clean.split('.');
      const mains = new Set((model.lanes || []).map((l) => parseLanePrefix(l).clean).filter((c) => !c.includes('.')));
      if (mains.has(parts[0])) nn = parts.slice(1).join('.');   // Parent.Sub → Sub
      else if (mains.has(parts[1])) nn = parts[0];              // legacy Sub.Parent → Sub
      else nn = parts.slice(1).join('.') || parts[0];           // fallback: drop first segment
    } else if (clean.startsWith('_') && clean.endsWith('_')) {
      nn = clean.replace(/^_+|_+$/g, '');                       // _X_ → X
    }
    if (nn && nn !== clean) { const text = renameLane(ed.getValue(), clean, nn); if (text != null) applyText(text); }
  }
  // Pick-a-parent-lane mode for "Make sub-lane of…": after choosing the action on
  // a lane, the next lane you click becomes its parent — more direct than typing
  // the parent's name. Esc / right-click / clicking empty space cancels. (#6)
  function startSubLaneSelect(item) {
    exitDrag(); cancelCreating(); endGroupSelect();
    const model = parseModel(); if (!model) return;
    const childClean = parseLanePrefix(model.lanes[item.index]).clean;
    subLaneOf = { childIndex: item.index, childClean: childClean };
    const c = getContainer(); if (c) c.style.cursor = 'crosshair';
    showSubLaneBanner(childClean);
  }
  function showSubLaneBanner(childClean) {
    endSubLaneBanner();
    const b = document.createElement('div');
    b.className = 'flowdrom-group-banner';
    const span = document.createElement('span');
    span.textContent = 'Click the parent lane for “' + childClean + '”';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel'; cancel.className = 'btn';
    cancel.addEventListener('click', endSubLaneSelect);
    b.appendChild(span); b.appendChild(cancel);
    document.body.appendChild(b);
    subLaneBanner = b;
  }
  function endSubLaneBanner() { if (subLaneBanner && subLaneBanner.parentNode) subLaneBanner.parentNode.removeChild(subLaneBanner); subLaneBanner = null; }
  function endSubLaneSelect() {
    subLaneOf = null;
    const c = getContainer(); if (c && c.style.cursor === 'crosshair') c.style.cursor = '';
    endSubLaneBanner();
  }
  // Convert the pending child into a sub-lane of the clicked parent. Only a main
  // lane (no '.') can be a parent, so we never create a 3-part composite name.
  function applySubLaneParent(parentIndex) {
    if (!subLaneOf) return;
    const childIndex = subLaneOf.childIndex, childClean = subLaneOf.childClean;
    endSubLaneSelect();
    if (parentIndex === childIndex) return;
    const ed = getEditor(); const model = parseModel();
    if (!ed || !model) return;
    const parentClean = parseLanePrefix(model.lanes[parentIndex]).clean;
    if (!parentClean || parentClean.includes('.') || parentClean === childClean) return;
    const text = renameLane(ed.getValue(), childClean, parentClean + '.' + childClean);
    if (text != null) applyText(text);
  }

  function currentField(model, item, field) {
    try {
      if (item.kind === 'message') return model.messages[item.index][field];
      if (item.kind === 'legend') return model.legend[item.index][field];
      if (item.kind === 'state') return model.states[item.index][field];
    } catch (e) { /* ignore */ }
    return undefined;
  }
  function setItemField(item, field, literal) {
    const ed = getEditor(); if (!ed) return;
    const key = SECTION_BY_KIND[item.kind]; if (!key) return;
    const text = setOrInsertField(ed.getValue(), key, item.index, field, literal);
    if (text != null) applyText(text);
  }

  // Colors already used by a given element kind, most-frequent first — so the
  // picker can offer "reuse a color you already have" scoped to what you're
  // colouring (state colours when colouring a state, etc.). With no kind it
  // aggregates across all colourable kinds.
  function usedColors(model, kind) {
    const counts = new Map();
    const bump = (c) => { if (c && typeof c === 'string') counts.set(c, (counts.get(c) || 0) + 1); };
    if (model) {
      const sources = { message: model.messages, legend: model.legend, state: model.states };
      const lists = kind ? [sources[kind]] : [model.messages, model.legend, model.states];
      lists.forEach((arr) => (arr || []).forEach((e) => bump(e.color)));
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  }
  const USED_LABEL = { message: 'Used by messages:', state: 'Used by states:', legend: 'Used by legend:' };

  // Reusable color picker menu. `kind` selects the right palette (states use the
  // pastel-keyed STATE_PALETTE; null aggregates used colors across all kinds);
  // `current` pre-fills the Custom field; `onPick` receives the chosen color
  // string (raw, unquoted); `title` adds a context header (e.g. the selection
  // count). Shared by "Change color" (single + multi-selection) and the
  // add-element flow so colour input is consistent everywhere. (#2)
  function showColorPicker(kind, clientX, clientY, current, onPick, title) {
    const model = parseModel();
    const base = (kind === 'state' ? STATE_PALETTE : PALETTE);
    const menu = buildMenu(clientX, clientY);
    if (title) addHeader(menu, title);
    const swatch = (c) => { addRow(menu, c, () => { closeMenu(); onPick(c); }, { swatch: c }); };

    // 1) colors already used by this kind (top), 2) the rest of the palette, 3) custom.
    const used = usedColors(model, kind);
    if (used.length) {
      addHeader(menu, USED_LABEL[kind] || 'Used in diagram:');
      used.forEach(swatch);
      addHeader(menu, 'Palette:');
    } else {
      addHeader(menu, 'Color:');
    }
    base.filter((c) => used.indexOf(c) === -1).forEach(swatch);

    addRow(menu, 'Custom…', () => {
      showTextInput(clientX, clientY, current || '', (v) => { if (v && v.trim()) onPick(v.trim()); }, 'Custom color');
    });
  }
  function showColorMenu(item, clientX, clientY) {
    const model = parseModel();
    showColorPicker(item.kind, clientX, clientY, currentField(model, item, 'color') || '',
      (c) => setItemField(item, 'color', quote(c)));
  }

  // Reusable line-style picker (solid / dashed) — a selection, never free text,
  // so style input matches the color picker. `onPick` gets 'solid' | 'dashed'. (#2)
  function showStylePicker(clientX, clientY, onPick) {
    const menu = buildMenu(clientX, clientY);
    addHeader(menu, 'Line style:');
    addRow(menu, '─  Solid', () => { closeMenu(); onPick('solid'); });
    addRow(menu, '┄  Dashed', () => { closeMenu(); onPick('dashed'); });
  }

  // Prompt for a state's fixed width (activation-style bar). Pre-filled with the
  // current value; a number commits `width`, while empty (or non-numeric) input
  // clears the field entirely — back to automatic text-based sizing — by
  // rewriting the element without it (applyText re-canonizes the result). (#activation)
  function setStateWidth(item, clientX, clientY) {
    const model = parseModel(); const ed = getEditor(); const J = getJSON5();
    if (!model || !ed || !J) return;
    const st = (model.states || [])[item.index]; if (!st) return;
    const cur = (typeof st.width === 'number') ? String(st.width) : '';
    showTextInput(clientX, clientY, cur, (v) => {
      const n = parseFloat(v);
      const text = ed.getValue();
      if (v != null && String(v).trim() !== '' && isFinite(n) && n > 0) {
        const t = setOrInsertField(text, 'states', item.index, 'width', numLiteral(n));
        if (t != null) applyText(t);
      } else if (typeof st.width === 'number') {
        const obj = Object.assign({}, st); delete obj.width;
        const span = locateArrayElement(text, 'states', item.index); if (!span) return;
        applyText(text.slice(0, span.start) + J.stringify(obj) + text.slice(span.end));
      }
    }, 'State width in px (empty = auto)', false);
  }

  // Prompt for a frame's lMargin / rMargin. A number commits the field; empty (or
  // non-numeric) clears it back to the default. (#frames)
  function setFrameMargin(item, field, clientX, clientY) {
    const model = parseModel(); const ed = getEditor(); const J = getJSON5();
    if (!model || !ed || !J) return;
    const fr = (model.frames || [])[item.index]; if (!fr) return;
    const cur = (typeof fr[field] === 'number') ? String(fr[field]) : '';
    const def = field === 'lMargin' ? FRAME_L_MARGIN : FRAME_R_MARGIN;
    showTextInput(clientX, clientY, cur, (v) => {
      const n = parseFloat(v);
      const text = ed.getValue();
      if (v != null && String(v).trim() !== '' && isFinite(n) && n >= 0) {
        const t = setOrInsertField(text, 'frames', item.index, field, numLiteral(n));
        if (t != null) applyText(t);
      } else if (typeof fr[field] === 'number') {
        const obj = Object.assign({}, fr); delete obj[field];
        const span = locateArrayElement(text, 'frames', item.index); if (!span) return;
        applyText(text.slice(0, span.start) + J.stringify(obj) + text.slice(span.end));
      }
    }, field + ' in px (empty = default ' + def + ')', false);
  }
  // Background-color picker for any item with a `background` field (frame,
  // infoBox). Picking a color sets it; Custom → "none" (or empty) clears it. (#frames)
  function setBackground(item, clientX, clientY) {
    const model = parseModel(); const ed = getEditor(); const J = getJSON5();
    if (!model || !ed || !J) return;
    const key = SECTION_BY_KIND[item.kind]; if (!key) return;
    const obj0 = (model[key] || [])[item.index]; if (!obj0) return;
    const title = (item.kind === 'infoBox' ? 'Info box' : 'Frame') + ' background (Custom → "none" to clear):';
    showColorPicker(null, clientX, clientY, obj0.background || '', (c) => {
      const text = ed.getValue();
      if (c && String(c).trim() && String(c).trim().toLowerCase() !== 'none') {
        const t = setOrInsertField(text, key, item.index, 'background', quote(String(c).trim()));
        if (t != null) applyText(t);
      } else if (obj0.background != null) {
        const obj = Object.assign({}, obj0); delete obj.background;
        const span = locateArrayElement(text, key, item.index); if (!span) return;
        applyText(text.slice(0, span.start) + J.stringify(obj) + text.slice(span.end));
      }
    }, title);
  }

  function renameLanePrompt(item, clientX, clientY) {
    const model = parseModel(); const ed = getEditor();
    if (!model || !ed) return;
    const pp = parseLanePrefix(model.lanes[item.index]);
    showTextInput(clientX, clientY, pp.clean, (v) => {
      const nv = (v || '').trim(); if (!nv) return;
      const text = renameLane(ed.getValue(), pp.clean, nv);
      if (text != null) applyText(text);
    }, 'Rename lane', true);
  }

  function deleteItem(item) {
    const key = SECTION_BY_KIND[item.kind];
    const ed = getEditor();
    if (!key || !ed) return;
    const text = deleteArrayElement(ed.getValue(), key, item.index);
    if (text == null) return;
    exitDrag();
    applyText(text);
  }

  // Remove the whole legend section (the box/title selection).
  function deleteLegend() {
    const ed = getEditor();
    if (!ed) return;
    const text = deleteTopLevelKey(ed.getValue(), 'legend');
    if (text == null) return;
    exitDrag();
    applyText(text);
  }
  function gotoLegend() {
    const ed = getEditor();
    if (!ed) return;
    const arr = locateArray(ed.getValue(), 'legend');
    if (!arr) return;
    const from = ed.posFromIndex(arr.open), to = ed.posFromIndex(arr.close + 1);
    ed.setSelection(from, to);
    ed.scrollIntoView({ from: from, to: to }, 60);
    ed.focus();
  }

  function gotoDefinition(item) {
    const key = SECTION_BY_KIND[item.kind];
    const ed = getEditor();
    if (!key || !ed) return;
    const span = locateArrayElement(ed.getValue(), key, item.index);
    if (!span) return;
    const from = ed.posFromIndex(span.start), to = ed.posFromIndex(span.end);
    ed.setSelection(from, to);
    ed.scrollIntoView({ from: from, to: to }, 60);
    ed.focus();
  }

  // Reusable inline text popover: a small captioned card with an input.
  // Commits on Enter/blur, cancels on Escape. `label` is an optional caption.
  // When `multiline` is set, the popover uses a textarea and the diagram's '|'
  // line-break convention is shown as real newlines. Enter (or the Save button /
  // clicking away) saves; Alt+Enter inserts a line break. The value is converted
  // back to '|' for the model, so callers keep passing/receiving '|'-encoded
  // text. The popover width fits the longest line. (#12)
  // `opts.checkbox` adds a labelled check mark row (e.g. "Vertical text") whose
  // state is passed to onCommit as the second argument. (#activation)
  function showTextInput(clientX, clientY, initial, onCommit, label, multiline, opts) {
    closeMenu();
    const pop = document.createElement('div');
    pop.className = 'flowdrom-editpop';
    pop.style.left = clientX + 'px';
    pop.style.top = clientY + 'px';

    const cap = document.createElement('div');
    cap.className = 'flowdrom-editpop-cap';
    cap.textContent = label || 'Edit';
    pop.appendChild(cap);

    const inp = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) inp.type = 'text';
    inp.value = multiline ? String(initial || '').replace(/\|/g, '\n') : (initial || '');
    inp.className = 'flowdrom-textedit';
    if (multiline) {
      // Start at exactly the number of displayed lines (1 for new text).
      inp.rows = Math.min(12, Math.max(1, inp.value.split('\n').length));
      inp.style.resize = 'vertical';
      inp.wrap = 'off'; // lines break only on Enter; long lines scroll, not soft-wrap
    }
    pop.appendChild(inp);

    // Optional check mark row (e.g. "Vertical text" for states). mousedown is
    // prevented so ticking it doesn't blur the input (which would commit-close);
    // the click still toggles the box — same trick as the footer buttons.
    let cb = null;
    if (opts && opts.checkbox) {
      const cbRow = document.createElement('label');
      cbRow.className = 'flowdrom-editpop-check';
      cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!opts.checked;
      const cbTxt = document.createElement('span');
      cbTxt.textContent = opts.checkbox;
      cbRow.appendChild(cb); cbRow.appendChild(cbTxt);
      cbRow.addEventListener('mousedown', (e) => e.preventDefault());
      pop.appendChild(cbRow);
    }

    // Footer: short hint + explicit Cancel/Save buttons, so multi-line edits have
    // an obvious save target instead of relying on a key chord. (#12)
    const footer = document.createElement('div');
    footer.className = 'flowdrom-editpop-foot';
    const hint = document.createElement('span');
    hint.className = 'flowdrom-editpop-hint';
    hint.textContent = multiline ? 'Enter = save · Alt+Enter = new line' : 'Enter = save';
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'btn'; cancelBtn.textContent = 'Cancel';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'btn btn--primary'; saveBtn.textContent = 'Save';
    footer.appendChild(hint); footer.appendChild(spacer); footer.appendChild(cancelBtn); footer.appendChild(saveBtn);
    pop.appendChild(footer);

    document.body.appendChild(pop);

    // Grow the box to fit the typed text, per line, so it mirrors how the text
    // will be displayed — it widens as you type and only wraps when you press
    // Enter (which starts a new line). (#12)
    const csInp = getComputedStyle(inp);
    const fontCss = (csInp.font && csInp.font.trim())
      ? csInp.font
      : (csInp.fontStyle + ' ' + csInp.fontWeight + ' ' + csInp.fontSize + ' ' + csInp.fontFamily);
    function autosize() {
      const ls = inp.value.split('\n');
      // Rows first (and independent of measurement) so the height always tracks
      // the exact number of displayed lines, even if width sizing is skipped.
      if (multiline) inp.rows = Math.min(12, Math.max(1, ls.length));
      let w = measureTextWidth(label || '', fontCss); // never narrower than the caption
      for (const ln of ls) w = Math.max(w, measureTextWidth(ln, fontCss));
      pop.style.width = Math.min(680, Math.max(280, Math.ceil(w) + 48)) + 'px';
      // Re-clamp horizontally if growth pushed the box past the viewport edge.
      const r = pop.getBoundingClientRect();
      if (r.right > window.innerWidth) pop.style.left = Math.max(8, window.innerWidth - r.width - 8) + 'px';
    }
    autosize();
    inp.addEventListener('input', autosize);

    // Keep the popover within the viewport.
    requestAnimationFrame(() => {
      const r = pop.getBoundingClientRect();
      if (r.right > window.innerWidth) pop.style.left = Math.max(8, window.innerWidth - r.width - 8) + 'px';
      if (r.bottom > window.innerHeight) pop.style.top = Math.max(8, window.innerHeight - r.height - 8) + 'px';
    });

    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      const v = multiline ? inp.value.replace(/\n/g, '|') : inp.value;
      const checked = cb ? cb.checked : undefined;
      if (pop.parentNode) pop.parentNode.removeChild(pop);
      if (commit) onCommit(v, checked);
    };
    inp.addEventListener('keydown', (e) => {
      // A lone Alt would otherwise move focus to the browser menu bar (blurring
      // the field); suppress its default so focus stays put. Alt+Enter etc. still
      // work (those arrive as the Enter keydown with e.altKey).
      if (e.key === 'Alt') { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Enter') {
        if (multiline && e.altKey) { // Alt+Enter inserts a line break
          e.preventDefault();
          const s = inp.selectionStart, en = inp.selectionEnd, val = inp.value;
          inp.value = val.slice(0, s) + '\n' + val.slice(en);
          inp.selectionStart = inp.selectionEnd = s + 1;
          autosize();
        } else { e.preventDefault(); finish(true); } // Enter saves
      } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation(); // don't let Escape reach the global handler
    });
    // Some browsers toggle the menu bar on the Alt keyup; suppress that too.
    inp.addEventListener('keyup', (e) => { if (e.key === 'Alt') { e.preventDefault(); e.stopPropagation(); } });
    inp.addEventListener('blur', () => {
      // Defer and verify: tapping Alt (or any browser chrome — menu bar, devtools,
      // alt-tab) blurs the field without the user meaning to commit. Only save
      // when focus truly moved elsewhere in the page; if the chrome stole it,
      // restore focus and stay open.
      setTimeout(() => {
        if (done) return;
        if (!document.hasFocus()) { try { inp.focus(); } catch (_) {} return; }
        finish(true);
      }, 0);
    });
    // Keep the input focused on button mousedown so the blur-save doesn't fire
    // before the click; act on click.
    [cancelBtn, saveBtn].forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); finish(false); });
    saveBtn.addEventListener('click', (e) => { e.stopPropagation(); finish(true); });
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }

  // Edit/add the text of an item, preserving any position markers/offsets.
  function editText(item, clientX, clientY) {
    const model = parseModel(); const ed = getEditor();
    if (!model || !ed) return;
    const key = SECTION_BY_KIND[item.kind];
    const commit = (mk) => (text) => { if (text != null) applyText(text); };
    if (item.kind === 'message' || item.kind === 'legend') {
      const arr = item.kind === 'message' ? model.messages : model.legend;
      const msg = arr[item.index] || {};
      const pp = item.kind === 'message' ? pathInfo(msg) : null;
      if (pp && pp.self) {
        // Self message: '>'/'<' slide markers don't apply; a leading '^' flips
        // the on-loop label to horizontal-upright. Surface that as a check mark,
        // stripped for editing and re-added per the box. (#self-message)
        const raw = String(msg.label || '').replace(/^[<>]+/, '');
        const wasFlipped = raw.charAt(0) === '^';
        showTextInput(clientX, clientY, wasFlipped ? raw.slice(1) : raw,
          (v, flip) => commit()(setOrInsertField(ed.getValue(), key, item.index, 'label', quote((flip ? '^' : '') + v))),
          'Message label', true, { checkbox: 'Horizontal label (upright)', checked: wasFlipped });
      } else {
        const pm = parseLabelMarkers(msg.label || '');
        showTextInput(clientX, clientY, pm.text, (v) => commit()(setOrInsertField(ed.getValue(), key, item.index, 'label', quote(pm.markers + v))), item.kind === 'legend' ? 'Legend label' : 'Message label', true);
      }
    } else if (item.kind === 'state') {
      // The '^' vertical-text modifier surfaces as a check mark, not a literal
      // character to remember: strip it for editing, re-add per the box. (#activation)
      const rawLabel = (model.states[item.index] || {}).label || '';
      const wasVertical = rawLabel.charAt(0) === '^';
      showTextInput(clientX, clientY, wasVertical ? rawLabel.slice(1) : rawLabel,
        (v, vert) => commit()(setOrInsertField(ed.getValue(), key, item.index, 'label', quote((vert ? '^' : '') + v))),
        'State label', true, { checkbox: 'Vertical text (reads downward)', checked: wasVertical });
    } else if (item.kind === 'laneGroup') {
      showTextInput(clientX, clientY, (model.laneGroups[item.index] || {}).label || '', (v) => commit()(setOrInsertField(ed.getValue(), key, item.index, 'label', quote(v))), 'Group name', true);
    } else if (item.kind === 'frame') {
      showTextInput(clientX, clientY, (model.frames[item.index] || {}).label || '', (v) => commit()(setOrInsertField(ed.getValue(), key, item.index, 'label', quote(v))), 'Frame label (e.g. loop, alt, opt)', true);
    } else if (item.kind === 'infoBox') {
      const off = parseInfoOffset((model.infoBoxes[item.index] || {}).text || '');
      showTextInput(clientX, clientY, off.rest, (v) => commit()(setOrInsertField(ed.getValue(), key, item.index, 'text', quote(buildInfoText(off.x, off.y, v)))), 'Info box text', true);
    } else if (item.kind === 'title') {
      showTextInput(clientX, clientY, model.title || '', (v) => commit()(setTopField(ed.getValue(), 'title', quote(v))), 'Diagram title', true);
    }
  }
  // Does the item currently have non-empty text?
  function hasText(item, model) {
    try {
      if (item.kind === 'message') return !!parseLabelMarkers(model.messages[item.index].label || '').text;
      if (item.kind === 'legend') return !!parseLabelMarkers(model.legend[item.index].label || '').text;
      if (item.kind === 'state') return !!(model.states[item.index].label || '');
      if (item.kind === 'laneGroup') return !!(model.laneGroups[item.index].label || '');
      if (item.kind === 'frame') return !!(model.frames[item.index].label || '');
      if (item.kind === 'infoBox') return !!parseInfoOffset(model.infoBoxes[item.index].text || '').rest;
      if (item.kind === 'title') return !!(model.title || '');
    } catch (e) { /* ignore */ }
    return false;
  }

  // ========================================================================
  // Overlay svg with drag handles (only for the item in drag mode).
  // ========================================================================

  function overlayEl() {
    const container = getContainer();
    let ov = container.querySelector(':scope > svg.flowdrom-edit-overlay');
    if (!ov) {
      ov = document.createElementNS(SVGNS, 'svg');
      ov.setAttribute('class', 'flowdrom-edit-overlay');
      ov.style.cssText = 'position:absolute;pointer-events:none;z-index:6;overflow:visible;';
      container.appendChild(ov); // after diagram svg => export-safe
    }
    return ov;
  }

  function rebuildOverlay() {
    const container = getContainer();
    const svg = diagramSvg();
    if (!container || !svg) return;
    const ov = overlayEl();
    while (ov.firstChild) ov.removeChild(ov.firstChild);

    if (!dragItem && !creating && !groupSelecting) { ov.style.display = 'none'; return; } // clean canvas at rest
    ov.style.display = '';

    const L = layout();
    const model = parseModel();
    if (!L || !model) return;

    const vb = svg.getAttribute('viewBox');
    if (!vb) return;
    const vbWidth = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.width : parseFloat(vb.split(/\s+/)[2]);
    const sRect = svg.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    ov.style.left = sRect.left - cRect.left + container.scrollLeft + 'px';
    ov.style.top = sRect.top - cRect.top + container.scrollTop + 'px';
    ov.style.width = sRect.width + 'px';
    ov.style.height = sRect.height + 'px';
    ov.setAttribute('viewBox', vb);
    ov.setAttribute('preserveAspectRatio', svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet');

    const scale = (vbWidth ? sRect.width / vbWidth : 1) || 1;
    const r = 7 / scale;

    const addHandle = (cx, cy, data, stroke) => {
      if (cx == null || cy == null || isNaN(cx) || isNaN(cy)) return;
      const h = document.createElementNS(SVGNS, 'circle');
      h.setAttribute('cx', cx); h.setAttribute('cy', cy); h.setAttribute('r', r);
      h.setAttribute('fill', '#fff'); h.setAttribute('stroke', stroke || '#0071e3'); h.setAttribute('stroke-width', 2 / scale);
      h.style.pointerEvents = 'all'; h.style.cursor = 'move';
      for (const k in data) h.setAttribute(k, data[k]);
      ov.appendChild(h);
    };

    if (groupSelecting) {
      groupSelecting.forEach((idx) => {
        const ln = L.lanes[idx]; if (!ln) return;
        const band = document.createElementNS(SVGNS, 'rect');
        band.setAttribute('x', ln.x - 12); band.setAttribute('y', L.laneTop - 30);
        band.setAttribute('width', 24); band.setAttribute('height', L.maxTime * L.timeStep + 40);
        band.setAttribute('fill', 'rgba(0,113,227,0.14)'); band.setAttribute('stroke', '#0071e3'); band.setAttribute('stroke-dasharray', '3,3');
        ov.appendChild(band);
      });
    }

    if (!dragItem) return; // creation / group-select mode: overlay positioned, no handles

    if (dragItem.kind === 'message') {
      const msg = (model.messages || [])[dragItem.index];
      if (msg) {
        const pp = pathInfo(msg) || { from: '', to: '', self: false };
        const x1 = laneX(pp.from), y1 = timeToY(msg.fromTime), x2 = laneX(pp.to), y2 = timeToY(msg.toTime);
        addHandle(x1, y1, { 'data-h': 'msg', 'data-i': dragItem.index, 'data-end': 'from' });
        addHandle(x2, y2, { 'data-h': 'msg', 'data-i': dragItem.index, 'data-end': 'to' });
        // label-position handle (orange), only when the message has visible text
        // (self-message labels sit fixed beside the loop — no slide handle)
        const pm = parseLabelMarkers(msg.label || '');
        if (pm.text && x1 != null && x2 != null && !pp.self) {
          const len = Math.hypot(x2 - x1, y2 - y1) || 1;
          const ratio = ratioFromMarkers(pm.markers);
          const lx = (x1 + x2) / 2 + ratio * (x2 - x1), ly = (y1 + y2) / 2 + ratio * (y2 - y1);
          addHandle(lx, ly, { 'data-h': 'msglabel', 'data-i': dragItem.index }, '#0071e3');
        }
      }
    } else if (dragItem.kind === 'state') {
      const st = (model.states || [])[dragItem.index];
      if (st) {
        const x = laneX(st.lane);
        const to = st.toTime != null ? st.toTime : st.fromTime;
        addHandle(x, timeToY(st.fromTime), { 'data-h': 'state', 'data-i': dragItem.index, 'data-end': 'from' }, '#0071e3');
        addHandle(x, timeToY((st.fromTime + to) / 2), { 'data-h': 'state', 'data-i': dragItem.index, 'data-end': 'move' });
        addHandle(x, timeToY(to), { 'data-h': 'state', 'data-i': dragItem.index, 'data-end': 'to' }, '#0071e3');
      }
    } else if (dragItem.kind === 'infoBox') {
      const info = (model.infoBoxes || [])[dragItem.index];
      if (info) {
        const x = laneX(info.lane); const off = parseInfoOffset(info.text);
        addHandle(x + off.x, timeToY(info.time) + off.y, { 'data-h': 'info', 'data-i': dragItem.index });        // box (offset)
        addHandle(x, timeToY(info.time), { 'data-h': 'infoanchor', 'data-i': dragItem.index }, '#0071e3');        // anchor (lane/time)
      }
    } else if (dragItem.kind === 'lane') {
      const ln = L.lanes[dragItem.index];
      if (ln) addHandle(ln.x, L.laneTop - 25, { 'data-h': 'lane', 'data-i': dragItem.index, 'data-mode': dragItem.mode || 'reorder' });
    } else if (dragItem.kind === 'frame') {
      const frame = (model.frames || [])[dragItem.index];
      const fb = frame && frameBox(frame);
      if (fb) {
        const midX = fb.x + fb.w / 2, midY = fb.y + fb.h / 2;
        // Edge handles resize time (top/bottom) and lane span (left/right);
        // the center handle moves the whole frame in time. (#frames)
        addHandle(midX, fb.y, { 'data-h': 'frame', 'data-i': dragItem.index, 'data-end': 'top' }, '#0071e3');
        addHandle(midX, fb.y + fb.h, { 'data-h': 'frame', 'data-i': dragItem.index, 'data-end': 'bottom' }, '#0071e3');
        addHandle(fb.x, midY, { 'data-h': 'frame', 'data-i': dragItem.index, 'data-end': 'left' }, '#0071e3');
        addHandle(fb.x + fb.w, midY, { 'data-h': 'frame', 'data-i': dragItem.index, 'data-end': 'right' }, '#0071e3');
        addHandle(midX, midY, { 'data-h': 'frame', 'data-i': dragItem.index, 'data-end': 'move' });
      }
    }
  }

  function enterDrag(item, mode) {
    dragItem = { kind: item.kind, index: item.index, mode: mode };
    rebuildOverlay();
    highlightItem(item);
  }
  function exitDrag() { dragItem = null; rebuildOverlay(); clearSelBox(); }

  // ========================================================================
  // Dragging the revealed handles.
  // ========================================================================

  let drag = null;

  function pointerToDiagram(ov, ev) {
    const ctm = ov.getScreenCTM();
    if (!ctm) return null;
    const inv = ctm.inverse();
    let p;
    if (typeof DOMPoint !== 'undefined') p = new DOMPoint(ev.clientX, ev.clientY);
    else { p = ov.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; }
    const out = p.matrixTransform(inv);
    return { x: out.x, y: out.y };
  }

  function onHandleDown(ev) {
    const h = ev.target;
    if (!h.getAttribute || !h.getAttribute('data-h')) return;
    ev.preventDefault(); ev.stopPropagation();
    drag = { ov: overlayEl(), handle: h, kind: h.getAttribute('data-h'), index: parseInt(h.getAttribute('data-i'), 10), end: h.getAttribute('data-end'), mode: h.getAttribute('data-mode') };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  }

  function onMove(ev) {
    if (!drag) return;
    const p = pointerToDiagram(drag.ov, ev);
    if (!p) return;
    if (drag.kind === 'msg') {
      const t = snapTime(yToTime(p.y));
      const lane = nearestLaneClean(p.x);
      const y = timeToY(t), x = laneX(lane);
      drag.handle.setAttribute('cy', y); drag.handle.setAttribute('cx', x);
      drag.preview = { t: t, lane: lane };
      const line = diagramSvg().querySelector('line[data-kind="message"][data-index="' + drag.index + '"][data-role="line"]');
      if (line) { if (drag.end === 'from') { line.setAttribute('x1', x); line.setAttribute('y1', y); } else { line.setAttribute('x2', x); line.setAttribute('y2', y); } }
    } else if (drag.kind === 'state') {
      const st = parseModel().states[drag.index];
      const lane = nearestLaneClean(p.x), pt = yToTime(p.y);
      let fromT = st.fromTime, toT = (st.toTime != null ? st.toTime : st.fromTime);
      if (drag.end === 'from') fromT = snapTime(pt);
      else if (drag.end === 'to') toT = snapTime(pt);
      else { const mid = (st.fromTime + toT) / 2, dur = toT - st.fromTime; fromT = Math.max(0, snapTime(st.fromTime + (pt - mid))); toT = fromT + dur; }
      fromT = Math.max(0, fromT); toT = Math.max(0, toT);
      drag.preview = { lane: lane, fromTime: fromT, toTime: toT };
      rebuildStatePreview(drag.index, drag.preview); // live box + all handles
    } else if (drag.kind === 'info') {
      drag.handle.setAttribute('cx', p.x); drag.handle.setAttribute('cy', p.y);
      drag.preview = { px: p.x, py: p.y };
    } else if (drag.kind === 'infoanchor') {
      const lane = nearestLaneClean(p.x), t = snapTime(yToTime(p.y));
      drag.handle.setAttribute('cx', laneX(lane)); drag.handle.setAttribute('cy', timeToY(t));
      drag.preview = { lane: lane, time: t };
    } else if (drag.kind === 'msglabel') {
      const model = parseModel();
      const msg = model && model.messages ? model.messages[drag.index] : null;
      if (msg) {
        const pp = pathInfo(msg) || { from: '', to: '' };
        const x1 = laneX(pp.from), y1 = timeToY(msg.fromTime), x2 = laneX(pp.to), y2 = timeToY(msg.toTime);
        const dx = x2 - x1, dy = y2 - y1, len2 = (dx * dx + dy * dy) || 1;
        const t = ((p.x - x1) * dx + (p.y - y1) * dy) / len2; // param along the arrow
        const ratio = Math.max(-0.4, Math.min(0.4, t - 0.5));
        drag.handle.setAttribute('cx', (x1 + x2) / 2 + ratio * dx);
        drag.handle.setAttribute('cy', (y1 + y2) / 2 + ratio * dy);
        drag.preview = { ratio: ratio };
      }
    } else if (drag.kind === 'lane') {
      drag.handle.setAttribute('cx', p.x);
      drag.preview = { x: p.x };
    } else if (drag.kind === 'frame') {
      const model = parseModel();
      const frame = model && model.frames ? model.frames[drag.index] : null;
      if (frame) {
        const f0 = Math.min(frame.fromTime, frame.toTime), f1 = Math.max(frame.fromTime, frame.toTime);
        const prev = {};
        if (drag.end === 'top') { prev.fromTime = Math.min(snapTime(yToTime(p.y)), f1); }
        else if (drag.end === 'bottom') { prev.toTime = Math.max(snapTime(yToTime(p.y)), f0); }
        else if (drag.end === 'move') {
          const dur = f1 - f0; const nf = Math.max(0, snapTime(f0 + (yToTime(p.y) - (f0 + f1) / 2)));
          prev.fromTime = nf; prev.toTime = nf + dur;
        } else if (drag.end === 'left' || drag.end === 'right') {
          // Adjust the side MARGIN continuously; once the pointer crosses an
          // adjacent lane, that lane joins/leaves the span and the margin is
          // recomputed relative to the new boundary lane. (#frames)
          const fb0 = frameBox(frame); const order = mainLanesLR();
          const xOf = (c) => { const l = layout().lanes.find((z) => z.clean === c); return l ? l.x : 0; };
          const xs = order.map(xOf);
          if (drag.end === 'left') {
            const rightIdx = order.indexOf(fb0.rightClean);
            const px = Math.min(p.x, (fb0.rightX + fb0.rm) - 12); // don't cross the right edge
            let i = 0; while (i < order.length && xs[i] < px) i++; // first lane at/after px
            i = Math.min(i, rightIdx);
            prev.lanes = order.slice(i, rightIdx + 1);
            prev.lMargin = Math.round(xs[i] - px);
          } else {
            const leftIdx = order.indexOf(fb0.leftClean);
            const px = Math.max(p.x, (fb0.leftX - fb0.lm) + 12);
            let i = order.length - 1; while (i >= 0 && xs[i] > px) i--; // last lane at/before px
            i = Math.max(i, leftIdx);
            prev.lanes = order.slice(leftIdx, i + 1);
            prev.rMargin = Math.round(px - xs[i]);
          }
        }
        drag.preview = prev;
        rebuildFramePreview(drag.index, prev);
      }
    }
  }

  // Live-update the drawn frame box + its handles as it's dragged, without a full
  // re-render (which would reparse/rebuild everything). (#frames)
  function rebuildFramePreview(index, prev) {
    const model = parseModel(); if (!model) return;
    const orig = frameBox(model.frames[index]);
    const merged = Object.assign({}, model.frames[index], prev);
    const fb = frameBox(merged); if (!fb) return;
    const svg = diagramSvg();
    if (svg) {
      const box = svg.querySelector('rect[data-kind="frame"][data-index="' + index + '"][data-role="box"]');
      if (box) { box.setAttribute('x', fb.x); box.setAttribute('y', fb.y); box.setAttribute('width', fb.w); box.setAttribute('height', fb.h); }
      // The label tab sits at the frame's top-left corner; translate it (and the
      // label) by the corner's delta so they track the box during the drag.
      if (orig) {
        const dx = fb.x - orig.x, dy = fb.y - orig.y, tr = 'translate(' + dx + ',' + dy + ')';
        svg.querySelectorAll('[data-kind="frame"][data-index="' + index + '"][data-role="tab"], [data-kind="frame"][data-index="' + index + '"][data-role="label"]')
          .forEach((el) => el.setAttribute('transform', tr));
      }
    }
    // Reposition the overlay handles to the new box.
    const ov = overlayEl(); const midX = fb.x + fb.w / 2, midY = fb.y + fb.h / 2;
    const set = (end, cx, cy) => { const h = ov.querySelector('circle[data-h="frame"][data-end="' + end + '"]'); if (h) { h.setAttribute('cx', cx); h.setAttribute('cy', cy); } };
    set('top', midX, fb.y); set('bottom', midX, fb.y + fb.h); set('left', fb.x, midY); set('right', fb.x + fb.w, midY); set('move', midX, midY);
  }

  // Live-update the drawn state box (rect + label) and its handles as it's
  // dragged — the same "boundaries follow the pointer" feel as the frame drag.
  // Mirrors main.js's box geometry (min height from the label, even growth, the
  // from==to case, and vertical-label rotation); the exact result snaps in on the
  // release re-render. (#state-live-drag)
  function rebuildStatePreview(index, prev) {
    const model = parseModel(); if (!model) return;
    const st = model.states[index]; if (!st) return;
    const svg = diagramSvg(); if (!svg) return;
    const g = svg.querySelector('g[data-kind="state"][data-index="' + index + '"]'); if (!g) return;
    const rect = g.querySelector('rect'), txt = g.querySelector('text');
    const x = laneX(prev.lane);
    const from = Math.min(prev.fromTime, prev.toTime), to = Math.max(prev.fromTime, prev.toTime);
    const vertical = String(st.label || '').charAt(0) === '^';
    const b0 = txt ? txt.getBBox() : null;
    const textH = b0 ? (vertical ? b0.width : b0.height) : 0;
    const padY = 4;
    let rectY, rectH;
    if (prev.fromTime === prev.toTime) { rectY = timeToY(prev.fromTime); rectH = textH + 2 * padY; }
    else {
      const boxTop = timeToY(from), boxH = timeToY(to) - timeToY(from);
      rectH = Math.max(boxH, textH + 2 * padY);
      rectY = boxTop - (rectH > boxH ? (rectH - boxH) / 2 : 0);
    }
    const centerY = rectY + rectH / 2;
    if (rect) {
      const w = parseFloat(rect.getAttribute('width')) || 50;
      rect.setAttribute('x', x - w / 2); rect.setAttribute('y', rectY); rect.setAttribute('height', rectH);
    }
    if (txt) {
      txt.setAttribute('x', x);
      txt.querySelectorAll('tspan').forEach((ts) => ts.setAttribute('x', x));
      const curY = parseFloat(txt.getAttribute('y')) || 0;
      txt.setAttribute('y', curY + (centerY - (b0.y + b0.height / 2)));
      if (vertical) txt.setAttribute('transform', 'rotate(90 ' + x + ' ' + centerY + ')');
    }
    const ov = overlayEl();
    const setH = (end, cy) => { const h = ov.querySelector('circle[data-h="state"][data-end="' + end + '"]'); if (h) { h.setAttribute('cx', x); h.setAttribute('cy', cy); } };
    setH('from', timeToY(prev.fromTime)); setH('to', timeToY(prev.toTime)); setH('move', timeToY((prev.fromTime + prev.toTime) / 2));
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    const d = drag; drag = null;
    if (!d || !d.preview) { rebuildOverlay(); return; }
    commitDrag(d);
  }

  function commitDrag(d) {
    const ed = getEditor(); const model = parseModel();
    if (!ed || !model) return;
    let text = ed.getValue();
    if (d.kind === 'msg') {
      const msg = (model.messages || [])[d.index]; if (!msg) return;
      const pp = pathInfo(msg) || { from: '', to: '', side: 'right' };
      let from = pp.from, to = pp.to;
      if (d.end === 'from') from = d.preview.lane; else to = d.preview.lane;
      // Rebuild in semantic order; keep the '<-' notation when the result is a
      // self message written (or dropped) as left-handed. (#self-message)
      const newPath = (from === to && pp.side === 'left') ? (to + '<-' + from) : (from + '->' + to);
      text = setElementFields(text, 'messages', d.index, [
        { field: 'path', literal: quote(newPath) },
        { field: d.end === 'from' ? 'fromTime' : 'toTime', literal: numLiteral(d.preview.t) },
      ]);
    } else if (d.kind === 'state') {
      const st = (model.states || [])[d.index]; if (!st) return;
      text = setOrInsertField(text, 'states', d.index, 'lane', quote(d.preview.lane));
      if (text != null) text = setOrInsertField(text, 'states', d.index, 'fromTime', numLiteral(d.preview.fromTime));
      if (text != null) text = setOrInsertField(text, 'states', d.index, 'toTime', numLiteral(d.preview.toTime));
    } else if (d.kind === 'info') {
      const info = (model.infoBoxes || [])[d.index]; if (!info) return;
      const x = laneX(info.lane); const anchorY = timeToY(info.time); const off = parseInfoOffset(info.text);
      const span = locateArrayElement(text, 'infoBoxes', d.index); if (!span) return;
      text = replaceFieldValue(text, span, 'text', quote(buildInfoText(d.preview.px - x, d.preview.py - anchorY, off.rest)));
    } else if (d.kind === 'msglabel') {
      const msg = (model.messages || [])[d.index]; if (!msg) return;
      const pm = parseLabelMarkers(msg.label || '');
      text = setOrInsertField(text, 'messages', d.index, 'label', quote(markersFromRatio(d.preview.ratio) + pm.text));
    } else if (d.kind === 'infoanchor') {
      // Re-anchor the tether ONLY — the box keeps its absolute canvas position.
      // The <x,y> offset is anchor-relative, so re-express it from the new
      // anchor; without this the whole box rides along with the tether. Box and
      // tether move independently, like a message's two endpoints.
      const info = (model.infoBoxes || [])[d.index]; if (!info) return;
      const ox = laneX(info.lane), nx = laneX(d.preview.lane);
      if (ox != null && nx != null) {
        const off = parseInfoOffset(info.text);
        const bx = ox + off.x, by = timeToY(info.time) + off.y; // box position today
        const span = locateArrayElement(text, 'infoBoxes', d.index); if (!span) return;
        text = replaceFieldValue(text, span, 'text',
          quote(buildInfoText(bx - nx, by - timeToY(d.preview.time), off.rest)));
      }
      if (text != null) text = setOrInsertField(text, 'infoBoxes', d.index, 'lane', quote(d.preview.lane));
      if (text != null) text = setOrInsertField(text, 'infoBoxes', d.index, 'time', numLiteral(d.preview.time));
    } else if (d.kind === 'frame') {
      // Rewrite the whole element as one JSON5 object: the per-field helpers
      // can't replace the array-valued `lanes` (FIELD_VALUE matches scalars
      // only), and applyText re-canonizes the result anyway. (#frames)
      const frame = (model.frames || [])[d.index]; const J = getJSON5();
      if (!frame || !J) { rebuildOverlay(); return; }
      const pv = d.preview || {};
      const merged = Object.assign({}, frame);
      delete merged.xMargin; delete merged.yMargin; // retire the legacy keys on any edit
      if (pv.fromTime != null) merged.fromTime = pv.fromTime;
      if (pv.toTime != null) merged.toTime = pv.toTime;
      if (pv.lanes) merged.lanes = pv.lanes;
      // Snap both boundaries to the 0.1 grid (cleans up any legacy off-grid value
      // and the move handler's from+duration FP noise). (#frames)
      const snap01 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
      merged.fromTime = snap01(merged.fromTime); merged.toTime = snap01(merged.toTime);
      if (pv.lMargin != null) merged.lMargin = pv.lMargin;
      if (pv.rMargin != null) merged.rMargin = pv.rMargin;
      const span = locateArrayElement(text, 'frames', d.index);
      if (!span) { rebuildOverlay(); return; }
      text = text.slice(0, span.start) + J.stringify(merged) + text.slice(span.end);
    } else if (d.kind === 'lane') {
      const L = layout(); if (!L) return;
      const dropX = d.preview.x;
      const self = L.lanes.find((l) => l.index === d.index); if (!self) { exitDrag(); return; }
      const clean = parseLanePrefix(model.lanes[d.index]).clean;
      // Slot = number of OTHER lanes whose natural x is left of a given x.
      const slotsLeftOf = (x) => L.lanes.reduce((n, l) => n + (l.index !== d.index && l.x < x ? 1 : 0), 0);
      const curSlot = slotsLeftOf(self.x);
      const target = slotsLeftOf(dropX);

      if (target === curSlot) {
        // Not crossing another lane → fine-tune only: set the '>'/'<' nudge
        // (each = 20px) from the lane's natural x so it lands under the drop.
        const pp = parseLanePrefix(model.lanes[d.index]);
        const count = Math.round((dropX - (self.x - pp.offsetPx)) / 20);
        const lanes = model.lanes.slice();
        lanes[d.index] = buildLaneName(clean, count);
        text = setLanes(text, lanes);
        if (text != null) applyText(text);
        exitDrag();
        return;
      }

      // Crossing → reorder with the nudge cleared, then re-measure the lane's new
      // natural position and re-apply the residual nudge so it stays under the
      // drop point. applyText() re-renders synchronously, so layout() is fresh.
      const lanes0 = model.lanes.slice();
      lanes0[d.index] = clean;
      let t = setLanes(text, lanes0);
      if (t != null) t = moveLane(t, d.index, target);
      if (t == null) { exitDrag(); return; }
      applyText(t);

      const L2 = layout();
      const moved = L2 && L2.lanes.find((l) => l.clean === clean);
      if (L2 && moved) {
        const count = Math.round((dropX - moved.x) / 20);
        if (count !== 0) {
          const model2 = parseModel();
          const idx2 = (model2 && model2.lanes) ? model2.lanes.findIndex((n) => parseLanePrefix(n).clean === clean) : -1;
          if (idx2 >= 0) {
            const lanes2 = model2.lanes.slice();
            lanes2[idx2] = buildLaneName(clean, count);
            const t2 = setLanes(getEditor().getValue(), lanes2);
            if (t2 != null) applyText(t2);
          }
        }
      }
      exitDrag();
      return;
    }
    if (text == null) { rebuildOverlay(); return; }
    applyText(text);
  }

  function applyText(text) {
    const ed = getEditor();
    // Re-emit in canonical guide-style order so every graphical edit produces
    // tidy, ordered JSON (and a compact options block). Fall back to the raw
    // text if it can't be parsed/formatted — never break the editor.
    let out = text;
    try {
      const J = getJSON5();
      if (J && typeof window !== 'undefined' && typeof window.formatConfig === 'function') {
        out = window.formatConfig(J.parse(text));
      }
    } catch (e) { out = text; }
    if (ed) ed.setValue(out);
    const ta = document.getElementById('input');
    if (ta) ta.value = out;
    if (typeof window.renderGraph === 'function') window.renderGraph();
  }

  // ========================================================================
  // Auto-arrange (#auto-arrange): rewrite the model so a normal render looks
  // tidy, WITHOUT changing the order of anything in time. The only operation on
  // the time axis is a monotonic remap (a < b → a' < b', a == b → a' == b'),
  // which provably preserves every ordering/causal relation. Phase 1 (here)
  // evens out the spacing; Phase 2 (collision-aware spreading via
  // window.flowdromMeasure) layers on top in autoArrange().
  // ========================================================================

  // Every distinct time value used anywhere in the model, ascending. Gridding ALL of
  // them (message endpoints, state starts AND ends, info boxes) onto an even integer
  // scale is a monotonic remap, so it strictly preserves the order of every event —
  // the core safety invariant. State durations scale with the grid.
  function arrangeTimeAnchors(model) {
    const s = new Set();
    (model.messages || []).forEach((m) => { if (typeof m.fromTime === 'number') s.add(m.fromTime); if (typeof m.toTime === 'number') s.add(m.toTime); });
    (model.states || []).forEach((st) => { if (typeof st.fromTime === 'number') s.add(st.fromTime); if (typeof st.toTime === 'number') s.add(st.toTime); });
    (model.infoBoxes || []).forEach((b) => { if (typeof b.time === 'number') s.add(b.time); });
    return Array.from(s).sort((a, b) => a - b);
  }
  // Even spacing: map the k-th distinct time onto integer rank k. Order- and
  // equality-preserving by construction.
  function evenTimeMap(anchors) {
    const map = new Map();
    anchors.forEach((v, i) => map.set(v, i));
    return map;
  }
  // Frames are NOT grid anchors (they must not perturb message/state spacing),
  // but they should track the remap so they keep scoping the same events. Map a
  // frame boundary by interpolating between the surrounding anchors' targets;
  // exact anchor values pass straight through. Pure; unit-tested. (#frames)
  function interpTime(v, anchors, valueMap) {
    if (typeof v !== 'number') return v;
    if (valueMap.has(v)) return valueMap.get(v);
    if (!anchors.length) return v;
    const first = anchors[0], last = anchors[anchors.length - 1];
    if (v <= first) return valueMap.get(first) - (first - v);
    if (v >= last) return valueMap.get(last) + (v - last);
    let i = 0; while (i < anchors.length - 1 && anchors[i + 1] < v) i++;
    const lo = anchors[i], hi = anchors[i + 1], rl = valueMap.get(lo), rh = valueMap.get(hi);
    return rl + (rh - rl) * (v - lo) / (hi - lo);
  }
  // Return a deep copy of the model with every time value passed through the map.
  function remapModelTimes(model, valueMap) {
    const out = JSON.parse(JSON.stringify(model));
    const rt = (v) => (typeof v === 'number' && valueMap.has(v)) ? valueMap.get(v) : v;
    (out.messages || []).forEach((m) => { if (typeof m.fromTime === 'number') m.fromTime = rt(m.fromTime); if (typeof m.toTime === 'number') m.toTime = rt(m.toTime); });
    (out.states || []).forEach((st) => { if (typeof st.fromTime === 'number') st.fromTime = rt(st.fromTime); if (typeof st.toTime === 'number') st.toTime = rt(st.toTime); });
    (out.infoBoxes || []).forEach((b) => { if (typeof b.time === 'number') b.time = rt(b.time); });
    if (out.frames && out.frames.length) {
      const anchors = Array.from(valueMap.keys()).sort((a, b) => a - b);
      // Snap the interpolated boundaries to the 0.1 grid — interpolation yields
      // arbitrary fractions (e.g. 10.0333…) that would otherwise leak into the
      // model. (#frames)
      const snap = (v) => (typeof v === 'number' ? Math.round(interpTime(v, anchors, valueMap) * 10) / 10 : v);
      out.frames.forEach((f) => { f.fromTime = snap(f.fromTime); f.toTime = snap(f.toTime); });
    }
    return out;
  }
  // Phase 1, end to end: even, order-preserving re-timing of every event (durations
  // scale with the grid), then push any same-lane states that overlap in time to be
  // back-to-back — they were meant to run consecutively. sequentializeStates is
  // defined below; both are hoisted, so the forward reference is fine.
  function autoArrangeTimes(model) {
    return sequentializeStates(remapModelTimes(model, evenTimeMap(arrangeTimeAnchors(model))));
  }

  // ---- Phase 2: collision-aware cleanup (browser-only; uses flowdromMeasure) ----
  // Every transform below is GUARDED by a measured overlap score: a candidate is
  // kept only if it strictly reduces total label/box overlap. So Arrange can only
  // improve or no-op — it can never make the diagram worse than the input.
  //
  // HARD INVARIANT (same as Phase 1): the relative order — including ties — of
  // every ORDER EVENT (message fromTime/toTime, state fromTime/toTime) is
  // preserved. Two events at the same time are a GLUE POINT (message end feeding
  // a state start, chained arrows, …) and stay glued. This holds because every
  // timing transform is either (a) a global monotonic shift applied uniformly to
  // ALL time fields (insertGapAtTime), or (b) a single-endpoint move that is
  // forbidden at glue points and confined strictly between the neighbouring
  // event times (Pass D). Lane shifting (Pass L) never touches time at all.

  // Axis-aligned overlap test (+ optional margin) and overlap area. Boxes are
  // { x, y, w, h }. Pure; unit-tested.
  function boxesOverlap(a, b, gap) {
    gap = gap || 0;
    return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
  }
  function boxOverlapArea(a, b) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (ox > 0 && oy > 0) ? ox * oy : 0;
  }

  // Insert `delta` time units at `atTime`: every later time value shifts down —
  // message endpoints, BOTH state boundaries, info boxes — one uniform monotonic
  // rule (v > atTime → v + delta). Order, ties and glue points are preserved BY
  // CONSTRUCTION. A state straddling the gap stretches (its end shifts, its start
  // stays): the old "rigid state" rule kept the duration but let shifted messages
  // pass an unshifted state end, breaking order and tearing glue points — the
  // stronger guarantee wins. Pure; unit-tested. (#auto-arrange P2)
  function insertGapAtTime(model, atTime, delta) {
    const out = JSON.parse(JSON.stringify(model));
    const sh = (v) => (typeof v === 'number' && v > atTime + 1e-9) ? Math.round((v + delta) * 10) / 10 : v;
    (out.messages || []).forEach((m) => { m.fromTime = sh(m.fromTime); m.toTime = sh(m.toTime); });
    (out.states || []).forEach((st) => { st.fromTime = sh(st.fromTime); st.toTime = sh(st.toTime); });
    (out.infoBoxes || []).forEach((b) => { b.time = sh(b.time); });
    (out.frames || []).forEach((f) => { f.fromTime = sh(f.fromTime); f.toTime = sh(f.toTime); });
    return out;
  }

  // States that PARTIALLY overlap in time on the same lane (a data error
  // re-timing can't fix while keeping order). Full containment is NOT reported:
  // a state fully inside another is an intentional sub-state / nested activation
  // bar and renders on top of its container. Returns [[i,j], …]. Pure;
  // unit-tested. (#activation)
  function overlappingStatePairs(model) {
    const byLane = {}, pairs = [];
    (model.states || []).forEach((s, i) => { (byLane[s.lane] = byLane[s.lane] || []).push({ i: i, from: s.fromTime, to: (s.toTime != null ? s.toTime : s.fromTime) }); });
    Object.keys(byLane).forEach((lane) => {
      const arr = byLane[lane].slice().sort((a, b) => a.from - b.from);
      for (let k = 1; k < arr.length; k++) {
        let contained = false, partial = null;
        for (let j = 0; j < k; j++) {
          if (arr[k].from >= arr[j].from - 1e-9 && arr[k].to <= arr[j].to + 1e-9) { contained = true; break; }
          if (arr[k].from < arr[j].to - 1e-9) partial = j;
        }
        if (!contained && partial != null) pairs.push([arr[partial].i, arr[k].i]);
      }
    });
    return pairs;
  }
  // Opt-in fix: push PARTIALLY-overlapping same-lane states to be back-to-back
  // (preserving each lane's order + durations). Fully-contained states are
  // intentional nesting (sub-state / activation bar) and are left in place.
  // Changes timing — relaxes the order invariant for states. Pure; unit-tested.
  // (#activation)
  function sequentializeStates(model) {
    const out = JSON.parse(JSON.stringify(model));
    const byLane = {};
    (out.states || []).forEach((s, i) => { (byLane[s.lane] = byLane[s.lane] || []).push(i); });
    Object.keys(byLane).forEach((lane) => {
      const idxs = byLane[lane].sort((a, b) => out.states[a].fromTime - out.states[b].fromTime);
      if (!idxs.length) return;
      // Running envelope of the lane's occupied range so far: containment is
      // judged against it (an inner state may follow another inner state), and
      // partial overlappers are pushed past its end.
      let envFrom = out.states[idxs[0]].fromTime;
      let envTo = (out.states[idxs[0]].toTime != null ? out.states[idxs[0]].toTime : out.states[idxs[0]].fromTime);
      for (let k = 1; k < idxs.length; k++) {
        const cur = out.states[idxs[k]];
        const curTo = (cur.toTime != null ? cur.toTime : cur.fromTime);
        if (cur.fromTime >= envFrom - 1e-9 && curTo <= envTo + 1e-9) continue; // nested: keep
        if (cur.fromTime < envTo) {
          const dur = curTo - cur.fromTime;
          cur.fromTime = Math.round(envTo * 10) / 10;
          if (cur.toTime != null) cur.toTime = Math.round((envTo + dur) * 10) / 10;
        }
        envFrom = cur.fromTime;
        envTo = Math.max(envTo, (cur.toTime != null ? cur.toTime : cur.fromTime));
      }
    });
    return out;
  }

  // Reduce measured boxes to one collision item per labelled element (message
  // LABEL only; whole state / info box) with its pixel box + time extent.
  function collisionItems(model, boxes) {
    const byId = new Map();
    (boxes || []).forEach((bx) => {
      const take = bx.kind === 'message' ? (bx.role === 'label') : (bx.kind === 'state' || bx.kind === 'infoBox');
      if (!take) return;
      const id = bx.kind + ':' + bx.index, e = byId.get(id);
      if (!e) byId.set(id, { kind: bx.kind, index: bx.index, x: bx.x, y: bx.y, r: bx.x + bx.w, b: bx.y + bx.h });
      else { e.x = Math.min(e.x, bx.x); e.y = Math.min(e.y, bx.y); e.r = Math.max(e.r, bx.x + bx.w); e.b = Math.max(e.b, bx.y + bx.h); }
    });
    const out = [];
    byId.forEach((e) => {
      let tT = 0, tB = 0;
      if (e.kind === 'message') { const m = (model.messages || [])[e.index] || {}; tT = Math.min(m.fromTime || 0, m.toTime || 0); tB = Math.max(m.fromTime || 0, m.toTime || 0); }
      else if (e.kind === 'state') { const s = (model.states || [])[e.index] || {}; tT = s.fromTime || 0; tB = (s.toTime != null ? s.toTime : s.fromTime) || 0; }
      else { const ib = (model.infoBoxes || [])[e.index] || {}; tT = tB = ib.time || 0; }
      out.push({ kind: e.kind, index: e.index, box: { x: e.x, y: e.y, w: e.r - e.x, h: e.b - e.y }, repTime: (tT + tB) / 2 });
    });
    return out;
  }
  function totalOverlap(items) {
    let s = 0;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) s += boxOverlapArea(items[i].box, items[j].box);
    return s;
  }

  // Pass A — push apart vertical overlaps between DIFFERENT-time elements by
  // inserting a local time gap between them. Greedy, strictly improving, guarded.
  function spreadDifferentTimes(model, measure) {
    const MARGIN = 6, CAP = 40;
    let cur = model, m = measure(cur), ts = (m.layout && m.layout.timeStep) || 50;
    let items = collisionItems(cur, m.boxes), score = totalOverlap(items);
    for (let it = 0; it < CAP && score > 0; it++) {
      let best = null;
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j];
        if (Math.abs(A.repTime - B.repTime) < 0.05) continue; // same time → Pass B
        if (!boxesOverlap(A.box, B.box, MARGIN)) continue;
        const oy = Math.min(A.box.y + A.box.h, B.box.y + B.box.h) - Math.max(A.box.y, B.box.y);
        if (oy > 0 && (!best || oy > best.oy)) best = { A: A, B: B, oy: oy };
      }
      if (!best) break;
      const T = (best.A.repTime + best.B.repTime) / 2;
      const delta = Math.max(0.1, Math.round(((best.oy + MARGIN) / ts) * 10) / 10);
      const cand = insertGapAtTime(cur, T, delta);
      const cm = measure(cand), ci = collisionItems(cand, cm.boxes), cs = totalOverlap(ci);
      if (cs < score - 1e-6) { cur = cand; items = ci; score = cs; ts = (cm.layout && cm.layout.timeStep) || ts; }
      else break;
    }
    return cur;
  }

  // Add `chars` steps of '>' horizontal shift (20px each — the documented lane
  // prefix convention) to every lane whose CLEAN name is listed in `names`.
  // Existing '<'/'>' prefixes are netted and re-emitted normalized, so repeated
  // application accumulates instead of producing mixed '><' prefixes. Everything
  // else references lanes by clean name, so this is purely visual. Pure; unit-tested.
  function shiftLanes(lanes, names, chars) {
    return (lanes || []).map((raw) => {
      const m = /^([<>]*)([\s\S]*)$/.exec(String(raw == null ? '' : raw));
      if (names.indexOf(m[2].trim()) === -1) return raw;
      let net = chars;
      for (let i = 0; i < m[1].length; i++) net += (m[1][i] === '>' ? 1 : -1);
      return (net > 0 ? '>'.repeat(net) : net < 0 ? '<'.repeat(-net) : '') + m[2];
    });
  }

  // Pass L — widen the horizontal gap between two adjacent MAIN lanes when
  // colliding items sit on opposite sides of that gap (wide same-time labels, a
  // state box under a neighbour's label, …). The widening lives in the model
  // itself, as '>' shifts on every main lane right of the gap (sub-lanes follow
  // their parent's x automatically), so it survives canonize/undo like any
  // hand-written prefix. Timing is never touched, so event order is trivially
  // preserved. Greedy + guarded: kept only if measured overlap strictly drops.
  function widenLaneGaps(model, measure) {
    const MARGIN = 6, PX_PER_SHIFT = 20, MAX_SHIFTS = 12, CAP = 8;
    let cur = model, m = measure(cur);
    let items = collisionItems(cur, m.boxes), score = totalOverlap(items);
    for (let it = 0; it < CAP && score > 0; it++) {
      const mains = ((m.layout && m.layout.lanes) || []).filter(l => l.clean.indexOf('.') === -1)
        .slice().sort((a, b) => a.x - b.x);
      if (mains.length < 2) break;
      let best = null;
      for (let g = 1; g < mains.length; g++) {
        const boundary = (mains[g - 1].x + mains[g].x) / 2;
        // The widest colliding pair whose centers straddle this gap decides how
        // much room the gap is missing.
        let need = 0;
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
          const A = items[i].box, B = items[j].box;
          if (!boxesOverlap(A, B, MARGIN)) continue;
          if (((A.x + A.w / 2) - boundary) * ((B.x + B.w / 2) - boundary) >= 0) continue;
          const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
          need = Math.max(need, ox + MARGIN);
        }
        if (need <= 0) continue;
        const chars = Math.min(MAX_SHIFTS, Math.max(1, Math.ceil(need / PX_PER_SHIFT)));
        const names = mains.filter(l => l.x >= mains[g].x - 1e-6).map(l => l.clean);
        const cand = JSON.parse(JSON.stringify(cur));
        cand.lanes = shiftLanes(cand.lanes, names, chars);
        const cm = measure(cand), ci = collisionItems(cand, cm.boxes), cs = totalOverlap(ci);
        if (cs < score - 1e-6 && (!best || cs < best.cs)) best = { cand, cs, cm, ci };
      }
      if (!best) break;
      cur = best.cand; m = best.cm; items = best.ci; score = best.cs;
    }
    return cur;
  }

  // Pass B — same-time message labels: slide each along its arrow (>/< markers) in
  // opposite directions. Guarded: kept only if it reduces overlap.
  function slideSameTimeLabels(model, measure) {
    const MARGIN = 6, CAP = 30;
    let cur = model, m = measure(cur), score = totalOverlap(collisionItems(cur, m.boxes));
    for (let it = 0; it < CAP; it++) {
      const msgs = collisionItems(cur, m.boxes).filter((x) => x.kind === 'message');
      let pair = null;
      for (let i = 0; i < msgs.length && !pair; i++) for (let j = i + 1; j < msgs.length; j++) {
        if (Math.abs(msgs[i].repTime - msgs[j].repTime) < 0.05 && boxesOverlap(msgs[i].box, msgs[j].box, MARGIN)) { pair = [msgs[i].index, msgs[j].index]; break; }
      }
      if (!pair) break;
      const cand = JSON.parse(JSON.stringify(cur));
      const set = (idx, ratio) => { const msg = cand.messages && cand.messages[idx]; if (msg) msg.label = markersFromRatio(ratio) + parseLabelMarkers(msg.label || '').text; };
      set(pair[0], -0.25); set(pair[1], 0.25);
      const cm = measure(cand), cs = totalOverlap(collisionItems(cand, cm.boxes));
      if (cs < score - 1e-6) { cur = cand; m = cm; score = cs; } else break;
    }
    return cur;
  }

  // Pass C — slide message labels away from overlapping state/infoBox items.
  // Tries all four >/< offsets and keeps the best strictly-improving candidate.
  function slideMsgStateLabels(model, measure) {
    const MARGIN = 6, CAP = 20;
    let cur = model, m = measure(cur), score = totalOverlap(collisionItems(cur, m.boxes));
    for (let it = 0; it < CAP && score > 0; it++) {
      const allItems = collisionItems(cur, m.boxes);
      const msgs = allItems.filter((x) => x.kind === 'message');
      const fixed = allItems.filter((x) => x.kind !== 'message');
      let best = null;
      for (const msg of msgs) {
        for (const fix of fixed) {
          if (!boxesOverlap(msg.box, fix.box, MARGIN)) continue;
          for (const ratio of [-0.25, 0.25, -0.5, 0.5]) {
            const cand = JSON.parse(JSON.stringify(cur));
            const msgObj = cand.messages && cand.messages[msg.index];
            if (!msgObj) continue;
            msgObj.label = markersFromRatio(ratio) + parseLabelMarkers(msgObj.label || '').text;
            const cm = measure(cand), cs = totalOverlap(collisionItems(cand, cm.boxes));
            if (cs < score - 1e-6 && (!best || cs < best.cs)) best = { cand, cs, cm };
          }
        }
      }
      if (!best) break;
      cur = best.cand; m = best.cm; score = best.cs;
    }
    return cur;
  }

  // Geometry helpers shared by Pass D and the unfixable-crossing reporter.
  function _getLaneX(layoutLanes, cleanName) {
    const lo = (layoutLanes || []).find(l => l.clean === cleanName);
    return lo != null ? lo.x : null;
  }
  function _segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(d) < 1e-10) return false;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
    const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  function _lineInBox(x1, y1, x2, y2, b) {
    const inB = (px, py) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
    if (inB(x1, y1) || inB(x2, y2)) return true;
    return _segIntersect(x1, y1, x2, y2, b.x, b.y, b.x + b.w, b.y) ||
           _segIntersect(x1, y1, x2, y2, b.x + b.w, b.y, b.x + b.w, b.y + b.h) ||
           _segIntersect(x1, y1, x2, y2, b.x, b.y + b.h, b.x + b.w, b.y + b.h) ||
           _segIntersect(x1, y1, x2, y2, b.x, b.y, b.x, b.y + b.h);
  }
  // Multiset of every order-relevant event time: message from/to and state
  // from/to — the events whose relative order Arrange must never change. Info
  // boxes are annotations and deliberately excluded. Sorted ascending. Pure.
  function orderEventTimes(model) {
    const ts = [];
    (model.messages || []).forEach((m) => { if (typeof m.fromTime === 'number') ts.push(m.fromTime); if (typeof m.toTime === 'number') ts.push(m.toTime); });
    (model.states || []).forEach((s) => { if (typeof s.fromTime === 'number') ts.push(s.fromTime); if (typeof s.toTime === 'number') ts.push(s.toTime); });
    return ts.sort((a, b) => a - b);
  }
  // A time is a GLUE POINT when more than one order event sits on it: a state
  // starting at a message's end, chained arrows, a horizontal message's own two
  // ends, … Glued events must move together or not at all — nudging one would
  // tear the connection — so Pass D skips them entirely. Pure; unit-tested.
  function isGluedTime(times, t) {
    let n = 0;
    for (let i = 0; i < times.length; i++) { if (Math.abs(times[i] - t) < 1e-6 && ++n > 1) return true; }
    return false;
  }
  function _crossingScore(mdl, meas) {
    const { layout, boxes } = meas;
    if (!layout || !boxes) return 0;
    const { laneTop, timeStep } = layout;
    const stateBoxes = boxes.filter(b => b.kind === 'state');
    let score = 0;
    (mdl.messages || []).forEach(msg => {
      const pp = pathInfo(msg);
      if (!pp || pp.self) return; // self loops hug their own lane — crossing logic N/A (#self-message)
      const x1 = _getLaneX(layout.lanes, pp.from), x2 = _getLaneX(layout.lanes, pp.to);
      if (x1 == null || x2 == null) return;
      const y1 = laneTop + (msg.fromTime || 0) * timeStep;
      const y2 = laneTop + (msg.toTime || 0) * timeStep;
      stateBoxes.forEach(sb => {
        if (_lineInBox(x1, y1, x2, y2, { x: sb.x, y: sb.y, w: sb.w, h: sb.h })) score++;
      });
    });
    return score;
  }

  // Pass D — nudge message endpoints to prevent the arrow body crossing a state box.
  // Uses exact pixel coordinates from the layout for a proper line-segment-vs-rectangle
  // test, so it catches both same-lane endpoint crossings AND middle-of-line crossings
  // through intermediate lanes. ORDER-SAFE by construction: an endpoint moves only
  // strictly within the open interval between its neighbouring order events (it can
  // never pass or land on another event), and glue points are never touched — which
  // also keeps horizontal messages (fromTime == toTime) horizontal.
  function nudgeToAvoidLineCrossings(model, measure) {
    const FRACTIONS = [0.35, 0.65], CAP = 20;
    let cur = model, m = measure(cur), sc = _crossingScore(cur, m);
    if (sc === 0) return cur;

    for (let it = 0; it < CAP && sc > 0; it++) {
      const { layout, boxes } = m;
      if (!layout || !boxes) break;
      const { laneTop, timeStep } = layout;
      const stateBoxes = boxes.filter(b => b.kind === 'state');
      const times = orderEventTimes(cur);
      let best = null;

      (cur.messages || []).forEach((msg, i) => {
        const pp = pathInfo(msg);
        if (!pp || pp.self) return; // self loops can't be nudged off their lane (#self-message)
        const x1 = _getLaneX(layout.lanes, pp.from), x2 = _getLaneX(layout.lanes, pp.to);
        if (x1 == null || x2 == null) return;
        const y1 = laneTop + (msg.fromTime || 0) * timeStep;
        const y2 = laneTop + (msg.toTime || 0) * timeStep;
        if (!stateBoxes.some(sb => _lineInBox(x1, y1, x2, y2, { x: sb.x, y: sb.y, w: sb.w, h: sb.h }))) return;

        for (const [field, t] of [['fromTime', msg.fromTime || 0], ['toTime', msg.toTime || 0]]) {
          if (isGluedTime(times, t)) continue; // shared with another event — never tear a glue point
          // Strict-order window: nearest order events below/above this endpoint.
          let prev = -Infinity, next = Infinity;
          for (const v of times) { if (v < t - 1e-6 && v > prev) prev = v; if (v > t + 1e-6 && v < next) next = v; }
          // Candidate moves: fractions of the way toward each neighbour (one grid
          // unit of headroom at the extremes), never reaching the neighbour.
          const up = (next === Infinity ? 1 : next - t), down = (prev === -Infinity ? 1 : t - prev);
          for (const f of FRACTIONS) {
            for (const nt0 of [t + f * up, t - f * down]) {
              const nt = Math.round(nt0 * 100) / 100;
              if (!(nt > prev + 1e-6 && nt < next - 1e-6)) continue; // rounding must not reach a neighbour
              const cand = JSON.parse(JSON.stringify(cur));
              cand.messages[i][field] = nt;
              const cm = measure(cand), cs = _crossingScore(cand, cm);
              if (cs < sc && (!best || cs < best.cs)) best = { cand, cs, cm };
            }
          }
        }
      });
      if (!best) break;
      cur = best.cand; m = best.cm; sc = best.cs;
    }
    return cur;
  }

  // Count remaining line-body crossings for the toast report.
  // Only counts pure middle crossings (neither message endpoint is inside the state
  // box) — excludes arrows that naturally start/end at a state boundary on their own
  // lane, which are expected causal patterns and not visual problems.
  function remainingLineCrossings(model, measure) {
    try {
      const meas = measure(model);
      const { layout, boxes } = meas;
      if (!layout || !boxes) return 0;
      const { laneTop, timeStep } = layout;
      const stateBoxes = boxes.filter(b => b.kind === 'state');
      let count = 0;
      (model.messages || []).forEach(msg => {
        const pp = pathInfo(msg);
        if (!pp || pp.self) return; // self loops are never counted as crossings (#self-message)
        const x1 = _getLaneX(layout.lanes, pp.from), x2 = _getLaneX(layout.lanes, pp.to);
        if (x1 == null || x2 == null) return;
        const y1 = laneTop + (msg.fromTime || 0) * timeStep;
        const y2 = laneTop + (msg.toTime || 0) * timeStep;
        stateBoxes.forEach(sb => {
          const b = { x: sb.x, y: sb.y, w: sb.w, h: sb.h };
          if (!_lineInBox(x1, y1, x2, y2, b)) return;
          const inB = (px, py) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
          if (!inB(x1, y1) && !inB(x2, y2)) count++;
        });
      });
      return count;
    } catch (e) { return 0; }
  }

  // Run passes in order: vertical gap-spread (A) → lane gap-widen (L) →
  // endpoint-nudge (D) → label slides (B, C). Geometry passes run before the
  // cosmetic label markers. Every timing transform is monotonic and glue-aware,
  // so event order is preserved end to end (see the Phase 2 header).
  function collisionSpread(model, measure) {
    const p1 = spreadDifferentTimes(model, measure);
    const p2 = widenLaneGaps(p1, measure);
    const p3 = nudgeToAvoidLineCrossings(p2, measure);
    const p4 = slideSameTimeLabels(p3, measure);
    return slideMsgStateLabels(p4, measure);
  }

  // Brief non-blocking status toast (bottom-center), auto-dismissed.
  function arrangeToast(text) {
    let t = document.querySelector('.flowdrom-toast');
    if (!t) { t = document.createElement('div'); t.className = 'flowdrom-toast'; document.body.appendChild(t); }
    t.textContent = text; t.style.opacity = '1';
    clearTimeout(arrangeToast._t);
    arrangeToast._t = setTimeout(() => { t.style.opacity = '0'; }, 4000);
  }
  // Only a SUBSTANTIAL 2D overlap counts as a real collision worth reporting — at
  // least a quarter of the smaller box covered — so a few pixels of padding/graze
  // between adjacent labels doesn't raise a false alarm.
  function significantOverlap(a, b) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox <= 0 || oy <= 0) return false;
    const minArea = Math.min(a.w * a.h, b.w * b.h);
    return minArea > 0 && (ox * oy) >= 0.25 * minArea;
  }
  function significantOverlaps(model, measure) {
    const items = collisionItems(model, measure(model).boxes), out = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      if (significantOverlap(items[i].box, items[j].box)) out.push(items[i].kind + '[' + items[i].index + '] ↔ ' + items[j].kind + '[' + items[j].index + ']');
    }
    return out;
  }

  // Tidiness score for picking between candidate arrangements: total label/box
  // overlap area dominates, line crossings break ties. Lower is better.
  function arrangeScore(model, measure) {
    try { const meas = measure(model); return totalOverlap(collisionItems(model, meas.boxes)) * 1000 + _crossingScore(model, meas); }
    catch (e) { return Infinity; }
  }

  // Sanity check on a measurement: some environments return garbage from off-screen
  // getBBox (non-finite values, or a single text element measured wider than the
  // whole diagram). Acting on that produces phantom collisions and bad nudges, so we
  // detect it and skip Phase 2 entirely, keeping the pure Phase 1 result instead.
  function measurementSane(meas) {
    if (!meas || !meas.boxes || !meas.layout) return false;
    const lanes = meas.layout.lanes || [];
    const maxX = lanes.reduce((m, l) => Math.max(m, l.x || 0), meas.layout.startX || 0);
    const widthBound = (maxX + (meas.layout.laneSpacing || 250)) * 1.5; // generous
    for (let i = 0; i < meas.boxes.length; i++) {
      const b = meas.boxes[i];
      if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) return false;
      if (b.w > widthBound) return false; // no real label/box is this wide
    }
    return true;
  }

  // The Arrange button: Phase 1 even re-timing (durations preserved, overlapping
  // states kept adjacent) + the guarded Phase 2 collision cleanup, iterated to a
  // stable fixed point. Phase 2 emits fractional times that the next re-grid snaps
  // back, which can make two near-equal layouts alternate; we collect the distinct
  // results and deterministically keep the tidiest, so pressing Arrange again is a
  // no-op. One undoable edit. Falls back to Phase 1 only without measurement.
  function autoArrange() {
    const ed = getEditor(); const model = parseModel(); const J = getJSON5();
    if (!ed || !model || !J) return;
    // Use measurement only if it's trustworthy. Probe once on the gridded model; if
    // getBBox is returning garbage, fall back to the pure Phase 1 result (which needs
    // no measurement) rather than spreading on bad data. (#arrange-robust)
    const rawMeasure = (typeof window !== 'undefined') ? window.flowdromMeasure : null;
    let measure = null;
    if (typeof rawMeasure === 'function') {
      try { if (measurementSane(rawMeasure(autoArrangeTimes(model)))) measure = rawMeasure; } catch (e) { measure = null; }
    }
    let candidate;
    if (typeof measure === 'function') {
      const cands = new Map();
      let cur = model;
      for (let i = 0; i < 8; i++) {
        let next;
        try { next = collisionSpread(autoArrangeTimes(cur), measure); } catch (e) { next = autoArrangeTimes(cur); }
        const key = stableStr(next);
        if (cands.has(key)) break;        // converged or entered a cycle
        cands.set(key, next);
        cur = next;
      }
      let best = null;
      cands.forEach((m, k) => { const s = arrangeScore(m, measure); if (!best || s < best.s || (s === best.s && k < best.k)) best = { m: m, s: s, k: k }; });
      candidate = best ? best.m : autoArrangeTimes(model);
    } else {
      candidate = autoArrangeTimes(model);
    }
    const changed = stableStr(candidate) !== stableStr(model);
    applyText(J.stringify(candidate));
    if (typeof measure === 'function') {
      try {
        const sig = significantOverlaps(candidate, measure);
        const lc = remainingLineCrossings(candidate, measure);
        const prefix = changed ? 'Arranged' : 'Already tidy';
        if (sig.length || lc) {
          const parts = [];
          if (sig.length) parts.push(sig.length + ' label overlap(s)');
          if (lc) parts.push(lc + ' line crossing(s) through a state (order/glue-constrained — not moved)');
          arrangeToast(prefix + ' — ' + parts.join('; ') + '.');
          if (sig.length) console.warn('Arrange — remaining label overlaps:', sig);
          if (lc) console.warn('Arrange — unfixable line crossings (order/glue constraints):', lc);
        } else {
          arrangeToast(changed ? 'Arranged.' : 'Already tidy — nothing to change.');
        }
      } catch (e) { /* ignore */ }
    } else {
      // Phase 1 only (no reliable measurement): times/order tidied, collisions not.
      arrangeToast(changed ? 'Arranged (spacing only).' : 'Already tidy — nothing to change.');
    }
  }
  if (typeof window !== 'undefined') window.flowdromArrange = autoArrange;

  // Undo/redo for graphical edits. Each graphical edit calls ed.setValue with a
  // non-coalescing "setValue" origin, so CodeMirror's own history already records
  // one step per edit. We drive it through here so undo/redo also work from the
  // canvas (toolbar buttons + keyboard), always re-render the diagram, and clear
  // any transient editor UI (open menu, drag handles, selection). (#7)
  function doUndoRedo(kind) {
    const ed = getEditor(); if (!ed) return;
    closeMenu(); exitDrag(); cancelCreating(); endGroupSelect(); endSubLaneSelect(); clearSelection();
    if (kind === 'redo') ed.redo(); else ed.undo();
    const ta = document.getElementById('input'); if (ta) ta.value = ed.getValue();
    if (typeof window !== 'undefined' && typeof window.renderGraph === 'function') window.renderGraph();
  }
  if (typeof window !== 'undefined') {
    window.flowdromUndo = function () { doUndoRedo('undo'); };
    window.flowdromRedo = function () { doUndoRedo('redo'); };
  }

  // Guided "New": walk through title → lanes, each pre-filled with a default, so a
  // fresh diagram starts usable (lanes already drawn) instead of blank. Enter/Save
  // advances; Esc/Cancel at any step aborts without touching the current diagram. (#3)
  function buildNewDiagram(title, lanes) {
    keepLoadedStyling = false; keptSignature = null; // a fresh graph should pick up persistent styling
    zoomUserSet = false; canvasZoom = 1; // a fresh diagram returns to auto-fit (#3)
    const ed = getEditor(); const J = getJSON5(); if (!ed || !J) return;
    const model = { title: title || 'Untitled', lanes: lanes || [], messages: [] };
    let text;
    try { text = (typeof window !== 'undefined' && typeof window.formatConfig === 'function') ? window.formatConfig(model) : J.stringify(model, null, 2); }
    catch (e) { text = J.stringify(model, null, 2); }
    ed.setValue(text);
    const ta = document.getElementById('input'); if (ta) ta.value = text;
    if (typeof window !== 'undefined' && typeof window.renderGraph === 'function') window.renderGraph();
  }
  function guidedNewDiagram() {
    closeMenu(); exitDrag(); cancelCreating(); endGroupSelect(); endSubLaneSelect(); clearSelection();
    const cx = Math.max(8, Math.round((typeof window !== 'undefined' ? window.innerWidth : 600) / 2) - 150);
    const cy = 90;
    showTextInput(cx, cy, 'Untitled', (title) => {
      const t = (title || '').trim() || 'Untitled';
      showTextInput(cx, cy, 'Client, Server', (lanesStr) => {
        const lanes = String(lanesStr || '').split(',').map((s) => s.trim()).filter(Boolean);
        buildNewDiagram(t, lanes);
      }, 'Lane names (comma-separated)');
    }, 'New diagram title');
  }
  if (typeof window !== 'undefined') window.flowdromNewDiagram = guidedNewDiagram;

  // ========================================================================
  // Canvas zoom — Ctrl/Cmd + wheel scales the diagram SVG itself, so the canvas
  // zooms like the rest of the page (which the browser already zooms on the text
  // editor and toolbar) instead of triggering a full-page browser zoom. The
  // viewBox is left untouched, so the engine's hit-testing / handle geometry
  // (which derive scale from the rendered size vs. viewBox) keep working. (#3)
  // ========================================================================
  let canvasZoom = 1;
  let zoomUserSet = false; // until the user wheels, keep auto-fitting to the container width
  let lastFitWidth = -1;   // container width at the last auto-fit (for the resize loop guard)
  // Intrinsic (zoom = 1) diagram size from the viewBox (the renderer keeps it fixed).
  function diagramBaseSize(svg) {
    const vb = svg.getAttribute('viewBox');
    if (vb) { const p = vb.split(/[\s,]+/).map(parseFloat); if (p.length === 4 && p[2] > 0 && p[3] > 0) return { w: p[2], h: p[3] }; }
    const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
    if (w > 0 && h > 0) { svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); return { w: w, h: h }; }
    return null;
  }
  function applyCanvasZoom() {
    const svg = diagramSvg(); if (!svg) return;
    const container = getContainer(); if (!container) return;
    const b = diagramBaseSize(svg); if (!b) return;
    // Until the user explicitly zooms, fit-to-width (shrink only) like the SVG's
    // built-in max-width:100% did — so the default view is unchanged.
    if (!zoomUserSet) {
      const avail = container.clientWidth - 8;
      canvasZoom = avail > 0 ? Math.min(1, avail / b.w) : 1;
      lastFitWidth = container.clientWidth; // remember what we fitted to (loop guard)
    }
    // The injected SVG carries inline `max-width:100%; height:auto`, which clamps
    // it to the container and blocks zoom-in. Override that, then size the viewport
    // by the width/height ATTRIBUTES (so the fixed viewBox scales the drawing and
    // the bigger box gives the container scrollable overflow). (#3)
    svg.style.maxWidth = 'none';
    svg.style.removeProperty('zoom');
    svg.setAttribute('width', b.w * canvasZoom);
    svg.setAttribute('height', b.h * canvasZoom);
  }
  function onCanvasWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return; // plain wheel = normal scroll
    e.preventDefault(); // stop the browser's page zoom; we zoom the canvas instead
    const container = getContainer(); if (!container) return;
    if (!zoomUserSet) { applyCanvasZoom(); zoomUserSet = true; } // lock in the current fitted scale as the start point
    const prev = canvasZoom;
    const next = Math.min(8, Math.max(0.05, prev * Math.exp(-e.deltaY * 0.0015)));
    if (next === prev) return;
    canvasZoom = next;
    // Keep the diagram point under the cursor anchored while zooming.
    const rect = container.getBoundingClientRect();
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    const ratio = next / prev;
    applyCanvasZoom();
    container.scrollLeft = (container.scrollLeft + ox) * ratio - ox;
    container.scrollTop = (container.scrollTop + oy) * ratio - oy;
    invalidateCandidates();
    rebuildOverlay();
    if (dragItem) highlightItem(dragItem);
    clearHover();
  }
  // Return to auto-fit: drop manual-zoom mode so the diagram fits the canvas now
  // and keeps re-fitting as the canvas/boundary is resized. (#3)
  function fitCanvas() {
    zoomUserSet = false;
    applyCanvasZoom();
    invalidateCandidates();
    rebuildOverlay();
    if (dragItem) highlightItem(dragItem);
    clearHover();
  }
  if (typeof window !== 'undefined') window.flowdromFitCanvas = fitCanvas;

  // ========================================================================
  // Wiring.
  // ========================================================================

  function onCanvasClick(e) {
    if (ignoreNextClick) { ignoreNextClick = false; return; } // click that ended a draw
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-h')) return; // handle drag, not a select
    if (groupSelecting) { // toggle lane membership
      const lane = candidatesAt(e.clientX, e.clientY).find((c) => c.kind === 'lane');
      if (lane) { if (groupSelecting.has(lane.index)) groupSelecting.delete(lane.index); else groupSelecting.add(lane.index); rebuildOverlay(); updateGroupBanner(); }
      return;
    }
    if (subLaneOf) { // pick a parent lane (or cancel on a non-lane click)
      const lane = candidatesAt(e.clientX, e.clientY).find((c) => c.kind === 'lane');
      if (lane) applySubLaneParent(lane.index); else endSubLaneSelect();
      return;
    }
    if (creating) return; // a draw gesture is pending; ignore plain clicks

    // Ctrl/Cmd+click: build a multi-selection of time-bearing items (to shift
    // them together later). Does not open a menu.
    if (e.ctrlKey || e.metaKey) {
      const cands = candidatesAt(e.clientX, e.clientY);
      const top = cands.find((c) => SHIFTABLE[c.kind]);
      if (top) { closeMenu(); exitDrag(); toggleSelection(top); renderSelectionBoxes(); }
      return;
    }

    const candidates = candidatesAt(e.clientX, e.clientY);
    if (candidates.length) {
      closeMenu();
      clearSelection(); // a plain click moves on from any multi-selection
      // No disambiguation picker: act on the top candidate (the same item the
      // hover highlight indicates). Overlap is resolved by hovering first.
      showActions(candidates[0], e.clientX, e.clientY);
      return;
    }
    // Empty space (left click): dismiss any menu / selection. Add is on right-click.
    closeMenu();
    exitDrag();
    clearSelection();
  }

  // Double-click = the item's most common single action, skipping the menu: edit
  // text for labelled items, rename for a lane. Falls back to the menu when there
  // is no obvious default. (#8)
  function primaryAction(item, clientX, clientY) {
    if (item.kind === 'lane') { renameLanePrompt(item, clientX, clientY); return; }
    if (TEXTABLE[item.kind]) { editText(item, clientX, clientY); return; }
    showActions(item, clientX, clientY);
  }
  // Double-click detection at the document level (capture). We can't rely on the
  // native dblclick event or per-click counts here: the first click opens the
  // actions menu *under the cursor*, so the second press lands on the menu (a
  // body overlay), where neither the canvas handlers nor a matching-target
  // dblclick ever fire. A document-capture handler sees that press regardless,
  // and elementsFromPoint still finds the item beneath the menu. (#1)
  const DBLCLICK_MS = 400, DBLCLICK_PX = 6;
  let lastTap = { t: 0, x: -1, y: -1 };
  function onDocPointerDownDbl(e) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || creating || groupSelecting || subLaneOf) { lastTap.t = 0; return; }
    // Presses inside the text-edit popover (or the styling panel) belong to
    // their inputs — caret placement, native double-click word selection —
    // and must never be hijacked as a canvas double-click on the diagram item
    // that happens to sit UNDER the popover. Menus stay visible to this
    // detector on purpose (see the comment above). (#editpop-dblclick)
    if (e.target && e.target.closest &&
        e.target.closest('.flowdrom-editpop, .flowdrom-options-panel')) { lastTap.t = 0; return; }
    const container = getContainer(); if (!container) { lastTap.t = 0; return; }
    const r = container.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { lastTap.t = 0; return; }
    const cands = candidatesAt(e.clientX, e.clientY); // finds the item even under an open menu
    const item = cands.length ? cands[0] : null;
    const now = Date.now();
    const near = Math.abs(e.clientX - lastTap.x) <= DBLCLICK_PX && Math.abs(e.clientY - lastTap.y) <= DBLCLICK_PX;
    if (item && lastTap.t && (now - lastTap.t) <= DBLCLICK_MS && near) {
      // Second press of a double-click: run the primary action and stop the press
      // from reaching the menu (or the canvas press handler). (#1)
      e.preventDefault(); e.stopPropagation();
      lastTap.t = 0;
      closeMenu();
      clearSelection();
      ignoreNextClick = true; // swallow the trailing click
      primaryAction(item, e.clientX, e.clientY);
      return;
    }
    lastTap = { t: item ? now : 0, x: e.clientX, y: e.clientY };
  }

  // ---- creation ----

  function showCreateMenu(clientX, clientY) {
    const menu = buildMenu(clientX, clientY);
    addHeader(menu, 'Add element:');
    addRow(menu, '+  Message (drag to draw)', () => { closeMenu(); startCreating('message'); });
    addRow(menu, '+  State (drag to draw)', () => { closeMenu(); startCreating('state'); });
    addRow(menu, '+  Info box (click a lane)', () => { closeMenu(); startCreating('infoBox'); });
    addRow(menu, '+  Frame (drag across lanes)', () => { closeMenu(); startCreating('frame'); });
    addRow(menu, '+  Lane here', () => { closeMenu(); addLaneAt(clientX, clientY); });
    addRow(menu, '+  Legend entry', () => { closeMenu(); addLegendEntry(clientX, clientY); });
    addRow(menu, '+  Lane group (select lanes)', () => { closeMenu(); startGroupSelect(); });
    addRow(menu, '⚙  Styling…', () => { closeMenu(); showOptionsPanel(); });
  }

  // ---- persistent text styling (saved in localStorage, applied to every graph) ----
  const TEXT_STYLE_KEY = 'flowdrom:textStyling';
  function getPersistentStyle() { try { const s = localStorage.getItem(TEXT_STYLE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function isStylePersistent() { return getPersistentStyle() != null; }
  function savePersistentStyle(opts) { try { localStorage.setItem(TEXT_STYLE_KEY, JSON.stringify(opts || {})); } catch (e) { /* private mode etc. */ } }
  function clearPersistentStyle() { try { localStorage.removeItem(TEXT_STYLE_KEY); } catch (e) { /* ignore */ } }
  function currentOptions() { const m = parseModel(); return (m && m.options) ? m.options : {}; }

  // Order-independent structural compare (the options block may be emitted in any
  // key order), used to know when the current graph is already in sync.
  function stableStr(o) {
    if (o == null) return 'null';
    if (typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(stableStr).join(',') + ']';
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableStr(o[k])).join(',') + '}';
  }
  function optionsEqual(a, b) { return stableStr(a || {}) === stableStr(b || {}); }

  // Replace / insert / remove the whole top-level `options` object.
  function setOptionsObject(text, options) {
    const J = getJSON5(); if (!J) return text;
    const loc = locateObjectValue(text, 'options');
    const has = options && Object.keys(options).length > 0;
    if (!has) {
      if (!loc) return text;
      let s = loc.open, e2 = loc.close + 1;
      const before = text.slice(0, s);
      const km = /(,?\s*)options\s*:\s*$/.exec(before);
      if (km) s = before.length - km[0].length;
      if (text[e2] === ',') e2++;
      return text.slice(0, s) + text.slice(e2);
    }
    const body = J.stringify(options, null, 2);
    if (loc) return text.slice(0, loc.open) + body + text.slice(loc.close + 1);
    const open = text.indexOf('{'); if (open < 0) return text;
    return text.slice(0, open + 1) + '\n  options: ' + body + ',' + text.slice(open + 1);
  }

  // When persistence is on, stamp the saved options onto whatever graph is
  // rendered, so every graph (new, loaded, pasted) uses it. Driven from the
  // render hook; the re-entrancy guard + equality check prevent a render loop.
  let plantingStyle = false;
  let keepLoadedStyling = false; // set when the user opts to keep a graph's own styling over the saved one
  let keptSignature = null;      // signature of the kept options, so Render doesn't re-prompt for the same styling
  function applyPersistentStyling() {
    if (plantingStyle || keepLoadedStyling) return;
    const opts = getPersistentStyle(); if (!opts) return; // off
    const ed = getEditor(); const J = getJSON5(); if (!ed || !J) return;
    let model; try { model = J.parse(ed.getValue()); } catch (e) { return; }
    if (optionsEqual(model.options, opts)) return; // already in sync
    const text = setOptionsObject(ed.getValue(), opts);
    if (text == null || text === ed.getValue()) return;
    plantingStyle = true;
    try { applyText(text); } finally { plantingStyle = false; }
  }

  // Commit a styling edit. While persistent, update the saved preference *first*
  // so the render hook keeps the change instead of reverting to the old setting.
  function commitStyle(text) {
    if (text == null) return;
    if (isStylePersistent()) { try { savePersistentStyle((getJSON5().parse(text).options) || {}); } catch (e) { /* ignore */ } }
    applyText(text);
  }

  // When persistence is on and the current graph (just loaded, or hand-edited in
  // the JSON panel) carries its own, different styling, ask which should win
  // before rendering — otherwise persistence stamps over it. `force` re-asks even
  // for styling previously kept (used on an explicit Load); the Render button
  // passes force=false so it doesn't re-prompt for the same styling each time.
  function resolveStyleConflict(force) {
    const persisted = getPersistentStyle();
    if (!persisted) { keepLoadedStyling = false; keptSignature = null; return; } // persistence off
    const model = parseModel();
    const loadedOpts = (model && model.options) || {};
    // Conflict = applying persistence would change the look. A graph with *no*
    // options still has an effective (default) styling, so empty-vs-saved counts
    // as a conflict too — only skip when it already matches the saved styling.
    if (optionsEqual(loadedOpts, persisted)) { keepLoadedStyling = false; keptSignature = null; return; }
    const sig = stableStr(loadedOpts);
    if (!force && keepLoadedStyling && sig === keptSignature) return; // already chose to keep this exact styling
    const keepIt = (typeof window !== 'undefined' && typeof window.confirm === 'function')
      ? window.confirm('This diagram\'s text styling differs from your saved styling.\nOK = keep the diagram\'s · Cancel = use your saved')
      : false;
    keepLoadedStyling = keepIt;
    keptSignature = keepIt ? sig : null;
  }
  if (typeof window !== 'undefined') {
    window.flowdromBeforeLoadRender = function () { resolveStyleConflict(true); };  // Load SVG: always re-evaluate
    window.flowdromRender = function () { resolveStyleConflict(false); if (typeof window.renderGraph === 'function') window.renderGraph(); };
  }

  // Global text styling panel — edits the options.<entity>.{textSize,textColor}.
  function showOptionsPanel() {
    const ed = getEditor(); if (!ed) return;
    const existing = document.querySelector('.flowdrom-options-panel'); if (existing) existing.remove();
    const opts = (parseModel() || {}).options || {};
    const panel = document.createElement('div');
    panel.className = 'flowdrom-options-panel';
    const h = document.createElement('div'); h.textContent = 'Styling'; h.style.cssText = 'font-weight:600;margin-bottom:8px;font-size:15px;'; panel.appendChild(h);
    // Persist toggle (panel-level): when on, ALL of this styling — text AND graph —
    // is saved and stamped onto every graph.
    const persist = document.createElement('label');
    persist.style.cssText = 'display:flex;align-items:center;gap:7px;margin-bottom:12px;font-size:13px;cursor:pointer;';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = isStylePersistent();
    const cbl = document.createElement('span'); cbl.textContent = 'Make persistent (apply this styling to every graph)';
    persist.appendChild(cb); persist.appendChild(cbl);
    cb.addEventListener('change', () => { if (cb.checked) savePersistentStyle(currentOptions()); else clearPersistentStyle(); });
    panel.appendChild(persist);
    const th = document.createElement('div'); th.textContent = 'Text styling (blank = default)'; th.style.cssText = 'font-weight:600;margin-bottom:8px;font-size:13px;color:var(--text-secondary);'; panel.appendChild(th);
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:auto 70px 110px;gap:6px 10px;align-items:center;'; panel.appendChild(grid);
    const hdr = (t) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'color:var(--text-tertiary);font-size:11px;'; return d; };
    grid.appendChild(hdr('Entity')); grid.appendChild(hdr('Size')); grid.appendChild(hdr('Color'));
    OPTION_ENTITIES.forEach((ent) => {
      const cur = opts[ent] || {};
      const name = document.createElement('div'); name.textContent = ent;
      const size = document.createElement('input'); size.type = 'number'; size.placeholder = 'default'; size.className = 'opt-size'; size.setAttribute('data-ent', ent); size.style.width = '60px';
      if (typeof cur.textSize === 'number') size.value = cur.textSize;
      const color = document.createElement('input'); color.type = 'text'; color.placeholder = 'default'; color.className = 'opt-color'; color.setAttribute('data-ent', ent); color.style.width = '100px';
      if (cur.textColor && cur.textColor !== 'default') color.value = cur.textColor;
      size.addEventListener('change', () => { const v = size.value.trim() === '' ? null : parseFloat(size.value); commitStyle(setOption(ed.getValue(), ent, 'textSize', v)); });
      color.addEventListener('change', () => { const v = color.value.trim() === '' ? null : color.value.trim(); commitStyle(setOption(ed.getValue(), ent, 'textColor', v)); });
      grid.appendChild(name); grid.appendChild(size); grid.appendChild(color);
    });

    // ---- Graph styling: repeated lane labels (declarative options.graph.*) ----
    const graph = opts.graph || {};
    const gsh = document.createElement('div');
    gsh.textContent = 'Graph styling';
    gsh.style.cssText = 'font-weight:600;margin:16px 0 8px;font-size:13px;color:var(--text-secondary);';
    panel.appendChild(gsh);

    // Feature 1 — repeated lane labels: toggle + its two sub-options grouped
    // together (they configure one feature), boxed and indented.
    const repeatBox = document.createElement('div');
    repeatBox.style.cssText = 'border:0.5px solid var(--separator);border-radius:var(--radius-sm);padding:8px 10px;margin-bottom:10px;';
    const rl = document.createElement('label');
    rl.style.cssText = 'display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer;font-weight:500;';
    const rcb = document.createElement('input'); rcb.type = 'checkbox'; rcb.checked = !!graph.repeatLaneLabels;
    const rlbl = document.createElement('span'); rlbl.textContent = 'Repeat lane labels down the page';
    rl.appendChild(rcb); rl.appendChild(rlbl); repeatBox.appendChild(rl);
    rcb.addEventListener('change', () => { commitStyle(setOption(ed.getValue(), 'graph', 'repeatLaneLabels', rcb.checked ? true : null)); });

    const ggrid = document.createElement('div');
    ggrid.style.cssText = 'display:grid;grid-template-columns:auto 90px;gap:6px 10px;align-items:center;font-size:13px;margin:8px 0 0 26px;';
    const grow = (labelText, inputEl) => { const d = document.createElement('div'); d.textContent = labelText; ggrid.appendChild(d); ggrid.appendChild(inputEl); };
    const interval = document.createElement('input'); interval.type = 'number'; interval.min = '0.1'; interval.step = '0.1'; interval.placeholder = '5'; interval.style.width = '80px';
    if (typeof graph.laneLabelInterval === 'number') interval.value = graph.laneLabelInterval;
    interval.addEventListener('change', () => { const v = interval.value.trim() === '' ? null : parseFloat(interval.value); commitStyle(setOption(ed.getValue(), 'graph', 'laneLabelInterval', v)); });
    const opacity = document.createElement('input'); opacity.type = 'number'; opacity.min = '0'; opacity.max = '1'; opacity.step = '0.05'; opacity.placeholder = '0.5'; opacity.style.width = '80px';
    if (typeof graph.opacity === 'number') opacity.value = graph.opacity;
    opacity.addEventListener('change', () => { let v = opacity.value.trim() === '' ? null : parseFloat(opacity.value); if (v != null) v = Math.max(0, Math.min(1, v)); commitStyle(setOption(ed.getValue(), 'graph', 'opacity', v)); });
    const styleSel = document.createElement('select'); styleSel.style.width = '88px';
    [['outline', 'Outline'], ['white', 'White'], ['solid', 'Solid']].forEach(([val, txt]) => {
      const o = document.createElement('option'); o.value = val; o.textContent = txt; styleSel.appendChild(o);
    });
    styleSel.value = (['outline', 'white', 'solid'].indexOf(graph.labelStyle) >= 0) ? graph.labelStyle : 'outline';
    styleSel.addEventListener('change', () => { commitStyle(setOption(ed.getValue(), 'graph', 'labelStyle', styleSel.value === 'outline' ? null : styleSel.value)); });
    grow('Repeat every (time)', interval);
    grow('Label opacity (0–1)', opacity);
    grow('Label style', styleSel);
    repeatBox.appendChild(ggrid);
    panel.appendChild(repeatBox);

    // Feature 2 — uniform state widths (independent toggle).
    const usw = document.createElement('label');
    usw.style.cssText = 'display:flex;align-items:center;gap:7px;margin-bottom:8px;font-size:13px;cursor:pointer;';
    const ucb = document.createElement('input'); ucb.type = 'checkbox'; ucb.checked = !!graph.uniformStateWidth;
    const ulbl = document.createElement('span'); ulbl.textContent = 'Align state widths per lane (match the widest)';
    usw.appendChild(ucb); usw.appendChild(ulbl); panel.appendChild(usw);
    ucb.addEventListener('change', () => { commitStyle(setOption(ed.getValue(), 'graph', 'uniformStateWidth', ucb.checked ? true : null)); });

    // Feature 3 — self-message loop distance from the lane, px (blank = 45). (#self-message)
    const smw = document.createElement('div');
    smw.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px;';
    const smwLbl = document.createElement('span'); smwLbl.textContent = 'Self-message distance from lane (px)';
    const smwIn = document.createElement('input'); smwIn.type = 'number'; smwIn.min = '10'; smwIn.step = '5'; smwIn.placeholder = '60'; smwIn.style.width = '80px';
    if (typeof graph.selfMessageWidth === 'number') smwIn.value = graph.selfMessageWidth;
    smwIn.addEventListener('change', () => { const v = smwIn.value.trim() === '' ? null : parseFloat(smwIn.value); commitStyle(setOption(ed.getValue(), 'graph', 'selfMessageWidth', v)); });
    smw.appendChild(smwLbl); smw.appendChild(smwIn); panel.appendChild(smw);

    // Feature 3b — lane-to-lane distance, px (blank = 250). The PlantUML importer
    // sets this when long message labels need the room. (#lane-spacing)
    const lsp = document.createElement('div');
    lsp.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px;';
    const lspLbl = document.createElement('span'); lspLbl.textContent = 'Lane spacing (px)';
    const lspIn = document.createElement('input'); lspIn.type = 'number'; lspIn.min = '80'; lspIn.step = '10'; lspIn.placeholder = '250'; lspIn.style.width = '80px';
    if (typeof graph.laneSpacing === 'number') lspIn.value = graph.laneSpacing;
    lspIn.addEventListener('change', () => { const v = lspIn.value.trim() === '' ? null : parseFloat(lspIn.value); commitStyle(setOption(ed.getValue(), 'graph', 'laneSpacing', v)); });
    lsp.appendChild(lspLbl); lsp.appendChild(lspIn); panel.appendChild(lsp);

    // Feature 4 — autonumber messages (by fromTime, then order). (#autonumber)
    const an = document.createElement('label');
    an.style.cssText = 'display:flex;align-items:center;gap:7px;margin-bottom:8px;font-size:13px;cursor:pointer;';
    const acb = document.createElement('input'); acb.type = 'checkbox'; acb.checked = !!graph.autonumber;
    const albl = document.createElement('span'); albl.textContent = 'Number messages (by time, then order)';
    an.appendChild(acb); an.appendChild(albl); panel.appendChild(an);
    acb.addEventListener('change', () => { commitStyle(setOption(ed.getValue(), 'graph', 'autonumber', acb.checked ? true : null)); });

    const close = document.createElement('button'); close.textContent = 'Close'; close.className = 'btn'; close.style.marginTop = '10px'; close.addEventListener('click', () => panel.remove());
    panel.appendChild(close);
    document.body.appendChild(panel);
  }

  function addLegendEntry(clientX, clientY) {
    createWithPrompts('legend', {}, [
      { key: 'label', label: 'Legend label', def: 'legend', multiline: true },
      { key: 'color', label: 'Color', def: 'black', type: 'color' },
      { key: 'style', label: 'Style', def: 'solid', type: 'style' },
    ], clientX, clientY);
  }

  // ---- lane-group multi-select ----

  function showGroupBanner() {
    const b = document.createElement('div');
    b.className = 'flowdrom-group-banner';
    const span = document.createElement('span');
    span.innerHTML = 'Click lanes to group (<b class="cnt">0</b> selected)';
    const mk = (txt, cls, fn) => { const x = document.createElement('button'); x.textContent = txt; x.className = cls; x.addEventListener('click', fn); return x; };
    b.appendChild(span);
    b.appendChild(mk(groupEditIndex != null ? 'Save' : 'Create', 'btn btn--primary', () => createGroupFromSelection(window.innerWidth / 2, 130)));
    b.appendChild(mk('Cancel', 'btn', () => endGroupSelect()));
    document.body.appendChild(b);
    groupBanner = b;
  }
  function updateGroupBanner() { if (groupBanner) { const c = groupBanner.querySelector('.cnt'); if (c) c.textContent = groupSelecting ? groupSelecting.size : 0; } }
  function startGroupSelect(editIndex) {
    exitDrag(); creating = null; endSubLaneSelect();
    groupSelecting = new Set();
    groupEditIndex = (typeof editIndex === 'number') ? editIndex : null;
    if (groupEditIndex != null) {
      const model = parseModel(), L = layout();
      const g = model && model.laneGroups ? model.laneGroups[groupEditIndex] : null;
      if (g && L) (g.lanes || []).forEach((cl) => { const i = L.lanes.findIndex((l) => l.clean === cl); if (i >= 0) groupSelecting.add(i); });
    }
    showGroupBanner(); rebuildOverlay(); updateGroupBanner();
  }
  function endGroupSelect() { groupSelecting = null; groupEditIndex = null; if (groupBanner && groupBanner.parentNode) groupBanner.parentNode.removeChild(groupBanner); groupBanner = null; rebuildOverlay(); }
  function createGroupFromSelection(clientX, clientY) {
    const sel = groupSelecting, editIdx = groupEditIndex;
    if (!sel || sel.size === 0) { endGroupSelect(); return; }
    const model = parseModel(); const ed = getEditor();
    const cleans = Array.from(sel).sort((a, b) => a - b).map((i) => parseLanePrefix(model.lanes[i]).clean);
    endGroupSelect();
    if (editIdx != null) { // update membership of an existing group
      const span = locateArrayElement(ed.getValue(), 'laneGroups', editIdx);
      if (span) { const t = replaceGroupLanes(ed.getValue(), span, cleans); if (t != null) applyText(t); }
      return;
    }
    showTextInput(clientX, clientY, 'Group', (v) => {
      const label = (v || '').trim() || 'Group';
      const lit = '{ label: ' + quote(label) + ', lanes: [' + cleans.map(quote).join(', ') + '] }';
      const text = insertArrayElement(ed.getValue(), 'laneGroups', lit);
      if (text != null) applyText(text);
    }, 'Group name', true);
  }

  function startCreating(kind) {
    endSubLaneSelect();
    creating = kind;
    const c = getContainer();
    if (c) c.style.cursor = 'crosshair';
    rebuildOverlay(); // positions overlay so the rubber-band has a coordinate system
  }
  function cancelCreating() {
    creating = null; createDrag = null;
    const c = getContainer();
    if (c) c.style.cursor = '';
    rebuildOverlay();
  }

  // Self-message loop path in diagram units — mirrors the engine's geometry in
  // main.js so the creation ghost matches the rendered result. dir = +1 right /
  // -1 left; w = bulge px. (#self-message)
  function selfLoopPath(lx, y1, y2, dir, w) {
    const ts = (layout() && layout().timeStep) || 50;
    let yb = y2;
    if (Math.abs(yb - y1) < ts * 0.25) yb = y1 + ts * 0.25;
    const xf = lx + dir * w;
    const rr = Math.min(8, w / 2, Math.abs(yb - y1) / 2);
    return 'M ' + lx + ' ' + y1 +
      ' L ' + (xf - dir * rr) + ' ' + y1 +
      ' Q ' + xf + ' ' + y1 + ' ' + xf + ' ' + (y1 + rr) +
      ' L ' + xf + ' ' + (yb - rr) +
      ' Q ' + xf + ' ' + yb + ' ' + (xf - dir * rr) + ' ' + yb +
      ' L ' + lx + ' ' + yb;
  }

  function onCreateDown(ev) {
    const ov = overlayEl();
    const p = pointerToDiagram(ov, ev);
    if (!p) return;
    ev.preventDefault(); ev.stopPropagation();
    // Snapshot the self-message loop width once (options don't change mid-drag).
    const gph = ((parseModel() || {}).options || {}).graph || {};
    const selfW = (gph.selfMessageWidth > 0) ? gph.selfMessageWidth : 60;
    createDrag = { ov: ov, kind: creating, start: p, cur: p, ghost: null, selfW: selfW };
    window.addEventListener('pointermove', onCreateMove, true);
    window.addEventListener('pointerup', onCreateUp, true);
  }

  function onCreateMove(ev) {
    if (!createDrag) return;
    const p = pointerToDiagram(createDrag.ov, ev);
    if (!p) return;
    createDrag.cur = p;
    const ov = createDrag.ov;
    if (createDrag.ghost) ov.removeChild(createDrag.ghost);
    if (createDrag.kind === 'message') {
      const startLane = nearestLaneClean(createDrag.start.x), curLane = nearestLaneClean(p.x);
      const y1 = timeToY(snapTime(yToTime(createDrag.start.y))), y2 = timeToY(snapTime(yToTime(p.y)));
      let g;
      if (startLane != null && startLane === curLane) {
        // Same lane → self message: preview the loop on the side of the pointer.
        const lx = laneX(startLane);
        const dir = p.x >= lx ? 1 : -1;
        g = document.createElementNS(SVGNS, 'path');
        g.setAttribute('d', selfLoopPath(lx, y1, y2, dir, createDrag.selfW));
        g.setAttribute('fill', 'none');
      } else {
        g = document.createElementNS(SVGNS, 'line');
        g.setAttribute('x1', laneX(startLane)); g.setAttribute('y1', y1);
        g.setAttribute('x2', laneX(curLane)); g.setAttribute('y2', y2);
      }
      g.setAttribute('stroke', '#0071e3'); g.setAttribute('stroke-width', 2); g.setAttribute('stroke-dasharray', '5,4');
      ov.appendChild(g); createDrag.ghost = g;
    } else if (createDrag.kind === 'state') {
      const x = laneX(nearestLaneClean(createDrag.start.x));
      const t0 = snapTime(yToTime(createDrag.start.y)), t1 = snapTime(yToTime(p.y));
      const yTop = timeToY(Math.min(t0, t1)), yBot = timeToY(Math.max(t0, t1));
      const g = document.createElementNS(SVGNS, 'rect');
      g.setAttribute('x', x - 25); g.setAttribute('y', yTop); g.setAttribute('width', 50); g.setAttribute('height', Math.max(2, yBot - yTop));
      g.setAttribute('fill', 'rgba(0,113,227,0.12)'); g.setAttribute('stroke', '#0071e3'); g.setAttribute('stroke-dasharray', '4,3');
      ov.appendChild(g); createDrag.ghost = g;
    } else if (createDrag.kind === 'infoBox') {
      const x = laneX(nearestLaneClean(p.x)), y = timeToY(snapTime(yToTime(p.y)));
      const g = document.createElementNS(SVGNS, 'circle');
      g.setAttribute('cx', x); g.setAttribute('cy', y); g.setAttribute('r', 6);
      g.setAttribute('fill', 'rgba(46,139,87,0.3)'); g.setAttribute('stroke', '#2e8b57');
      ov.appendChild(g); createDrag.ghost = g;
    } else if (createDrag.kind === 'frame') {
      // Preview the frame over the lane span start↔pointer and the time span,
      // with the default side margins; vertical edges sit exactly on the snapped
      // times (no vertical margin). (#frames)
      const xa = laneX(nearestLaneClean(createDrag.start.x)), xb = laneX(nearestLaneClean(p.x));
      const t0 = snapTime(yToTime(createDrag.start.y)), t1 = snapTime(yToTime(p.y));
      const left = Math.min(xa, xb) - FRAME_L_MARGIN, right = Math.max(xa, xb) + FRAME_R_MARGIN;
      const yTop = timeToY(Math.min(t0, t1)), yBot = timeToY(Math.max(t0, t1));
      const g = document.createElementNS(SVGNS, 'rect');
      g.setAttribute('x', left); g.setAttribute('y', yTop); g.setAttribute('width', Math.max(2, right - left)); g.setAttribute('height', Math.max(2, yBot - yTop));
      g.setAttribute('rx', '2'); g.setAttribute('fill', 'rgba(0,113,227,0.06)'); g.setAttribute('stroke', '#0071e3'); g.setAttribute('stroke-dasharray', '4,3');
      ov.appendChild(g); createDrag.ghost = g;
    }
  }

  // Create a new element immediately from its geometry + field defaults (so it
  // appears on the canvas at once), then prompt for each field in sequence — each
  // pre-filled with its default and applied live, so the element updates after
  // every Enter. A field left at its default is skipped (no edit), so accepting
  // defaults doesn't pile up undo steps. `geom` holds the fixed fields
  // (path/lane/times); `fields` is { key, label, def, omitIfEmpty, multiline,
  // numeric, checkbox }: `numeric` commits a number literal (empty = skip, so a
  // plain Enter keeps the automatic behavior), `checkbox` adds the vertical-text
  // check mark whose tick prefixes the committed value with '^'. (#activation)
  // Esc/Cancel just stops prompting — the element drawn so far stays. (add-element prompts)
  function createWithPrompts(kind, geom, fields, clientX, clientY) {
    const J = getJSON5(); const ed = getEditor(); if (!J || !ed) return;
    const key = SECTION_BY_KIND[kind]; if (!key) return;
    const model = parseModel();
    const index = (model && model[key]) ? model[key].length : 0; // append target
    const obj = Object.assign({}, geom);
    Object.keys(obj).forEach((k) => { if (typeof obj[k] === 'number') obj[k] = parseFloat(obj[k].toFixed(3)); }); // strip FP noise from times
    fields.forEach((f) => { if (!f.omitIfEmpty) obj[f.key] = f.def; }); // seed defaults (optional-empty fields like a label stay unset)
    const seeded = insertArrayElement(ed.getValue(), key, J.stringify(obj));
    if (seeded == null) return;
    applyText(seeded);
    highlightItem({ kind: kind, index: index });

    let i = 0;
    // Apply a chosen value for the current field and advance. `desired` is the
    // final string (already resolved from default); commit only real changes so
    // accepting defaults doesn't pile up undo steps.
    function commitFieldValue(f, desired) {
      const m = parseModel();
      const cur = (m && m[key] && m[key][index]) ? m[key][index][f.key] : undefined;
      if (f.numeric && desired !== '' && !isFinite(parseFloat(desired))) desired = ''; // garbage → keep auto
      if (desired !== '' && String(cur == null ? '' : cur) !== desired) {
        const lit = f.numeric ? numLiteral(parseFloat(desired)) : quote(desired);
        const t = setOrInsertField(ed.getValue(), key, index, f.key, lit);
        if (t != null) applyText(t);
      }
      highlightItem({ kind: kind, index: index });
      step();
    }
    function step() {
      if (i >= fields.length) { clearSelBox(); return; }
      const f = fields[i++];
      // Each field type uses the same input control as editing an existing
      // element: a palette menu for colors, a solid/dashed menu for styles, and
      // the text popover otherwise. (#2)
      if (f.type === 'color') {
        showColorPicker(kind, clientX, clientY, f.def, (c) => commitFieldValue(f, c));
      } else if (f.type === 'style') {
        showStylePicker(clientX, clientY, (s) => commitFieldValue(f, s));
      } else {
        showTextInput(clientX, clientY, f.def, (v, checked) => {
          const val = (v == null ? '' : String(v));
          let desired = (val.trim() === '') ? f.def : val;
          if (f.checkbox && checked && desired !== '') desired = '^' + desired; // vertical-text tick (#activation)
          commitFieldValue(f, desired);
        }, f.label, f.multiline, f.checkbox ? { checkbox: f.checkbox, checked: false } : undefined);
      }
    }
    step();
  }

  function onCreateUp(ev) {
    window.removeEventListener('pointermove', onCreateMove, true);
    window.removeEventListener('pointerup', onCreateUp, true);
    const d = createDrag; createDrag = null;
    const wasCreating = creating;
    cancelCreating();
    ignoreNextClick = true;
    if (!d) return;
    const x = ev.clientX, y = ev.clientY;

    if (wasCreating === 'infoBox') {
      const lane = nearestLaneClean(d.start.x);
      const t = snapTime(yToTime(d.start.y));
      if (lane == null) return;
      createWithPrompts('infoBox', { lane: lane, time: t }, [
        { key: 'text', label: 'Info box text', def: 'note', multiline: true },
      ], x, y);
    } else if (wasCreating === 'message') {
      const from = nearestLaneClean(d.start.x), to = nearestLaneClean(d.cur.x);
      const t0 = snapTime(yToTime(d.start.y)), t1 = snapTime(yToTime(d.cur.y));
      if (from == null || to == null) return;
      if (from === to && t0 === t1) return; // ignore a zero gesture
      // Same lane → self message; the pointer's side of the lane picks the loop
      // direction ('A->A' right, 'A<-A' left) via the back-arrow notation. Its
      // label prompt offers the horizontal-flip check mark. (#self-message)
      const isSelf = (from === to);
      const path = isSelf
        ? (from + (d.cur.x >= laneX(from) ? '->' : '<-') + to)
        : (from + '->' + to);
      const labelField = { key: 'label', label: 'Message label', def: '', omitIfEmpty: true, multiline: true };
      if (isSelf) labelField.checkbox = 'Horizontal label (upright)';
      createWithPrompts('message', { path: path, fromTime: t0, toTime: t1 }, [
        labelField,
        { key: 'color', label: 'Color', def: 'black', type: 'color' },
        { key: 'style', label: 'Style', def: 'solid', type: 'style' },
      ], x, y);
    } else if (wasCreating === 'state') {
      const lane = nearestLaneClean(d.start.x);
      let t0 = snapTime(yToTime(d.start.y)), t1 = snapTime(yToTime(d.cur.y));
      if (lane == null) return;
      if (t1 < t0) { const tmp = t0; t0 = t1; t1 = tmp; }
      if (t0 === t1) t1 = t0 + 1; // give a fresh state a visible duration
      // Width is deliberately NOT prompted on create (a distraction for fast
      // authoring — set it later from the state menu's Width… row). (#activation)
      createWithPrompts('state', { lane: lane, fromTime: t0, toTime: t1 }, [
        { key: 'label', label: 'State label', def: 'state', multiline: true, checkbox: 'Vertical text (reads downward)' },
        { key: 'color', label: 'Color', def: 'yellow', type: 'color' },
      ], x, y);
    } else if (wasCreating === 'frame') {
      // Span the contiguous main lanes between the start and end columns, over the
      // dragged time range. Margins are NOT prompted — they default and can be
      // tuned later from the frame menu. (#frames)
      const order = mainLanesLR();
      const a = nearestLaneClean(d.start.x), b = nearestLaneClean(d.cur.x);
      const iA = order.indexOf(a), iB = order.indexOf(b);
      if (iA < 0 || iB < 0) return;
      const lanesSpan = order.slice(Math.min(iA, iB), Math.max(iA, iB) + 1);
      let t0 = snapTime(yToTime(d.start.y)), t1 = snapTime(yToTime(d.cur.y));
      if (t1 < t0) { const tmp = t0; t0 = t1; t1 = tmp; }
      if (t0 === t1) t1 = t0 + 1; // give a fresh frame a visible height
      createWithPrompts('frame', { label: 'loop', lanes: lanesSpan, fromTime: t0, toTime: t1 }, [
        { key: 'label', label: 'Frame label (e.g. loop, alt, opt)', def: 'loop', multiline: true },
      ], x, y);
    }
  }

  function uniqueLaneName(lanes) {
    let n = 1; let name;
    do { name = 'Lane' + n; n++; } while (lanes.indexOf(name) !== -1);
    return name;
  }
  function addLaneAt(clientX, clientY) {
    const ed = getEditor(); const model = parseModel(); const L = layout();
    if (!ed || !model || !L) return;
    const dp = clientToDiagram(clientX, 0);
    let idx = (model.lanes || []).length;
    if (dp) { idx = 0; for (const l of L.lanes) { if (l.x < dp.x) idx++; } }
    const lanes = (model.lanes || []).slice();
    const def = uniqueLaneName(lanes);
    showTextInput(clientX, clientY, def, (name) => {
      const nm = (name && name.trim()) || def;
      const arr = lanes.slice(); arr.splice(idx, 0, nm);
      const text = setLanes(ed.getValue(), arr);
      if (text != null) applyText(text);
    }, 'New lane', true);
  }

  function attach() {
    const container = getContainer();
    if (!container || container.__flowdromEditorBound) return;
    container.style.position = container.style.position || 'relative';
    container.addEventListener('click', onCanvasClick);
    container.addEventListener('mousemove', onCanvasHover);
    // Ctrl/Cmd + mouse-wheel zooms the diagram itself (not the whole page). (#3)
    container.addEventListener('wheel', onCanvasWheel, { passive: false });
    // Re-fit the diagram to the canvas whenever its size changes — window resize
    // OR dragging the editor/canvas boundary — until the user takes manual zoom
    // control with Ctrl+wheel. (rAF-debounced to avoid layout thrash.) (#3)
    if (typeof ResizeObserver !== 'undefined') {
      let resizeRAF = 0;
      const ro = new ResizeObserver(function () {
        if (resizeRAF) return;
        resizeRAF = requestAnimationFrame(function () {
          resizeRAF = 0;
          // A vertical scrollbar appearing/disappearing nudges clientWidth by ~15px.
          // Re-fitting on that resizes the svg, which toggles the scrollbar again →
          // an infinite re-fit loop (flicker/freeze) for diagrams whose fitted height
          // sits right at the container height. Skip the re-fit for such sub-scrollbar
          // width changes; real resizes (boundary drags) clear the slop. (#3 loop guard)
          const skip = !zoomUserSet && lastFitWidth >= 0 &&
            Math.abs(container.clientWidth - lastFitWidth) <= 24;
          if (!skip) applyCanvasZoom(); // re-fits when !zoomUserSet; keeps manual zoom otherwise
          invalidateCandidates();
          rebuildOverlay();
          if (dragItem) highlightItem(dragItem);
        });
      });
      ro.observe(container);
    }
    container.addEventListener('mouseleave', clearHover);
    container.addEventListener('pointerdown', function (e) {
      ignoreNextClick = false; // a new gesture starts; never let a stale flag eat its click
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-h')) { onHandleDown(e); return; }
      if (creating) { onCreateDown(e); return; }
      // Press inside a selected item's highlight box and drag up/down → shift
      // every selected item in time. Works for a single selected item too.
      if (e.button === 0 && !(e.ctrlKey || e.metaKey)) {
        // Don't preventDefault here: doing so suppresses the click/dblclick events
        // in some browsers, which broke double-clicking a selected item. Text
        // selection during an actual drag is blocked in startGroupDrag instead. (#1)
        if (selection.length >= 1 && pointInSelection(e.clientX, e.clientY)) { startGroupDrag(e); return; }
        if (groupSelecting || subLaneOf) return; // those modes own plain clicks
        const cands = candidatesAt(e.clientX, e.clientY);
        if (cands.length) {
          // Open the actions menu on PRESS, not release, so it feels instant. The
          // release's click would otherwise re-open it, so swallow that click. The
          // 2nd press of a double-click is intercepted earlier by the document-
          // level detector (it stops propagation), so this won't reopen then. (#1)
          closeMenu();
          clearSelection();
          showActions(cands[0], e.clientX, e.clientY);
          ignoreNextClick = true;
          return;
        }
        startRubberBand(e); // drag on empty → rubber-band select
      }
    }, true);
    container.addEventListener('scroll', function () { invalidateCandidates(); clearSelBox(); clearHover(); });
    window.addEventListener('resize', invalidateCandidates);
    // Right-click opens the Add menu (left-click empty is reserved for dismiss).
    container.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (subLaneOf) { endSubLaneSelect(); return; } // right-click cancels parent-pick
      if (creating) return;
      // Right-click inside a multi-selection → actions for the whole selection;
      // otherwise the usual Add menu. (#5)
      if (selection.length && pointInSelection(e.clientX, e.clientY)) { showSelectionMenu(e.clientX, e.clientY); return; }
      showCreateMenu(e.clientX, e.clientY);
    });
    // Double-click detector — capture phase at document level so it sees the 2nd
    // press even when it lands on the menu overlay. Runs before the canvas press
    // handler (document captures before its descendants). (#1)
    document.addEventListener('pointerdown', onDocPointerDownDbl, true);
    // Close menu when clicking outside it (and outside the canvas handled above).
    document.addEventListener('pointerdown', function (e) {
      if (menuEl && !menuEl.contains(e.target) && !container.contains(e.target)) { closeMenu(); }
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMenu(); exitDrag(); cancelCreating(); endGroupSelect(); endSubLaneSelect(); clearSelection(); } });
    // Undo/redo from anywhere (canvas or the JSON editor). Capture phase so it
    // pre-empts CodeMirror's own Ctrl-Z and adds the diagram re-render — but we
    // bow out for plain text fields (the edit popover) so their native undo wins.
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = (e.key || '').toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const t = e.target;
      const inCM = !!(t && t.closest && t.closest('.CodeMirror'));
      const inField = !inCM && !!(t && t.closest && t.closest('input, textarea'));
      if (inField) return; // let the field's native undo handle it
      e.preventDefault(); e.stopPropagation();
      doUndoRedo((k === 'y' || e.shiftKey) ? 'redo' : 'undo');
    }, true);
    container.__flowdromEditorBound = true;
  }

  function installRenderHook() {
    if (typeof window === 'undefined' || typeof window.renderGraph !== 'function' || window.renderGraph.__flowdromWrapped) return;
    const orig = window.renderGraph;
    const wrapped = function () {
      const out = orig.apply(this, arguments);
      try { invalidateCandidates(); attach(); applyCanvasZoom(); rebuildOverlay(); if (dragItem) highlightItem(dragItem); } catch (e) { /* never break rendering */ }
      try { applyPersistentStyling(); } catch (e) { /* never break rendering */ }
      return out;
    };
    wrapped.__flowdromWrapped = true;
    window.renderGraph = wrapped;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { locateArrayElement, replaceFieldValue, setElementFields, parseInfoOffset, buildInfoText, quote, numLiteral, locateArray, insertArrayElement, deleteArrayElement, deleteTopLevelKey, setLanes, moveLane, parseLabelMarkers, markersFromRatio, ratioFromMarkers, insertField, setOrInsertField, setTopField, renameLane, renameLaneToken, deleteLane, countLaneRefs, locateObjectValue, setOption, arrangeTimeAnchors, evenTimeMap, remapModelTimes, autoArrangeTimes, boxesOverlap, insertGapAtTime, overlappingStatePairs, sequentializeStates, orderEventTimes, isGluedTime, shiftLanes, usedColors, interpTime };
  }

  if (typeof document !== 'undefined') {
    installRenderHook();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { installRenderHook(); attach(); rebuildOverlay(); });
    } else { attach(); rebuildOverlay(); }
  }
})();
