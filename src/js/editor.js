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
  const DRAGGABLE = { message: true, state: true, infoBox: true, lane: true };
  const DELETABLE = { message: true, state: true, infoBox: true, legend: true, laneGroup: true };
  const HAS_COLOR = { message: true, legend: true, state: true }; // have a color field
  const HAS_STYLE = { message: true, legend: true };               // have solid/dashed
  const TEXTABLE = { message: true, state: true, infoBox: true, legend: true, title: true, laneGroup: true };
  const PALETTE = ['black', 'red', 'blue', 'green', 'purple', 'orange', 'teal', 'brown', 'gray', 'deeppink', 'goldenrod', 'seagreen'];
  // states render a pastel background keyed off these named colors (engine getPastelColor)
  const STATE_PALETTE = ['yellow', 'red', 'blue', 'green', 'orange', 'cyan', 'purple', 'pink'];
  // entities configurable via the options block (global text styling)
  const OPTION_ENTITIES = ['title', 'lane', 'subLane', 'laneGroup', 'message', 'state', 'info', 'legend', 'legendTitle', 'time'];

  const SECTION_BY_KIND = {
    lane: 'lanes', message: 'messages', state: 'states',
    infoBox: 'infoBoxes', laneGroup: 'laneGroups', legend: 'legend',
  };

  function getEditor() {
    if (typeof window !== 'undefined' && window.codeMirrorEditor) return window.codeMirrorEditor;
    if (typeof codeMirrorEditor !== 'undefined') return codeMirrorEditor; // eslint-disable-line no-undef
    return null;
  }
  function getJSON5() {
    return (typeof window !== 'undefined' && window.JSON5) || (typeof JSON5 !== 'undefined' ? JSON5 : null); // eslint-disable-line no-undef
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
      const parts = String(msg.path || '').split('->').map((s) => s.trim());
      const np = parts.map((p) => renameLaneToken(p, oldClean, newClean));
      if (np.join('->') !== parts.join('->')) {
        const span = locateArrayElement(out, 'messages', i);
        if (span) out = replaceFieldValue(out, span, 'path', quote(np.join('->')));
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
    (model.messages || []).forEach((m) => { if (String(m.path || '').split('->').map((s) => s.trim()).some(hit)) n++; });
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

    delHi('messages', (model.messages || []).map((m, i) => [m, i]).filter(([m]) => String(m.path || '').split('->').map((s) => s.trim()).some(ref)).map(([, i]) => i));
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
  function snapTime(t) { return Math.max(0, Math.round(t / SNAP_TIME) * SNAP_TIME); }

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

  // ========================================================================
  // Selection box (sibling div over the container) + item labelling.
  // ========================================================================

  function selBox() {
    const container = getContainer();
    let ov = container.querySelector(':scope > .flowdrom-sel-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'flowdrom-sel-overlay';
      ov.style.cssText = 'position:absolute;pointer-events:none;border:2px dashed #e6007a;border-radius:3px;background:rgba(230,0,122,0.07);display:none;z-index:5;';
      container.appendChild(ov);
    }
    return ov;
  }
  function clearSelBox() { const c = getContainer(); const ov = c && c.querySelector(':scope > .flowdrom-sel-overlay'); if (ov) ov.style.display = 'none'; }

  // ---- multi-selection (ctrl+click) -------------------------------------
  // Only time-bearing kinds can take part in a shared time shift.
  const SHIFTABLE = { message: true, state: true, infoBox: true };

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
      box.style.cssText = 'position:absolute;pointer-events:none;border:2px dashed #e6007a;border-radius:3px;background:rgba(230,0,122,0.10);z-index:5;';
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
      b.style.cssText = 'position:fixed;z-index:10002;background:#e6007a;color:#fff;padding:4px 8px;border-radius:4px;font:12px "Segoe UI",sans-serif;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.25);';
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
    const d = groupDrag; groupDrag = null;
    removeShiftBadge();
    if (d && d.moved && d.dt) { ignoreNextClick = true; commitGroupShift(d.dt); }
    else { renderSelectionBoxes(); }
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
    for (const e of els) { const cr = e.getBoundingClientRect(); l = Math.min(l, cr.left); t = Math.min(t, cr.top); r = Math.max(r, cr.right); b = Math.max(b, cr.bottom); }
    const container = getContainer(); const c = container.getBoundingClientRect(); const ov = selBox(); const pad = 4;
    ov.style.left = l - c.left + container.scrollLeft - pad + 'px';
    ov.style.top = t - c.top + container.scrollTop - pad + 'px';
    ov.style.width = r - l + 2 * pad + 'px';
    ov.style.height = b - t + 2 * pad + 'px';
    ov.style.display = 'block';
  }

  function labelFor(item, model) {
    const m = model || {};
    try {
      if (item.kind === 'message') { const x = m.messages[item.index]; return 'Message  ' + (x.path || '') + (x.label ? '  “' + String(x.label).split('|')[0] + '”' : ''); }
      if (item.kind === 'state') { const x = m.states[item.index]; return 'State  “' + (x.label || '') + '” @ ' + x.lane; }
      if (item.kind === 'infoBox') { const x = m.infoBoxes[item.index]; return 'Info @ ' + x.lane + '  t' + x.time; }
      if (item.kind === 'lane') { return 'Lane  ' + m.lanes[item.index]; }
      if (item.kind === 'laneGroup') { return 'Group  ' + m.laneGroups[item.index].label; }
      if (item.kind === 'legend') { const x = m.legend[item.index]; return 'Legend  “' + (x.label || '') + '”'; }
      if (item.kind === 'legendBox') { return 'Legend (whole)  ' + ((m.legend || []).length) + ' entries'; }
      if (item.kind === 'title') { return 'Title  “' + (m.title || '') + '”'; }
    } catch (e) { /* fall through */ }
    return item.kind + '[' + item.index + ']';
  }

  // ========================================================================
  // Hit-testing: all tagged items under a viewport point (disambiguation).
  // ========================================================================

  function candidatesAt(clientX, clientY) {
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
        const parts = String(msg.path || '').split('->').map((s) => s.trim());
        const x1 = laneX(parts[0]), y1 = timeToY(msg.fromTime), x2 = laneX(parts[1]), y2 = timeToY(msg.toTime);
        if (x1 != null && x2 != null && distToSeg(p.x, p.y, x1, y1, x2, y2) <= tolMsg) add('message', i);
      });
      const top = L.laneTop, bot = L.laneTop + L.maxTime * L.timeStep;
      (L.lanes || []).forEach((ln) => { if (Math.abs(p.x - ln.x) <= tolLane && p.y >= top - tolLane && p.y <= bot + tolLane) add('lane', ln.index); });
    }
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
    el.style.cssText =
      'position:fixed;z-index:9999;background:#fff;border:1px solid #bbb;border-radius:6px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.18);font:13px "Segoe UI",sans-serif;min-width:190px;' +
      'padding:4px 0;user-select:none;';
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
    h.style.cssText = 'padding:6px 12px;color:#555;font-weight:600;border-bottom:1px solid #eee;white-space:nowrap;';
    menu.appendChild(h);
  }
  function addRow(menu, text, onClick, opts) {
    opts = opts || {};
    const row = document.createElement('div');
    row.textContent = text;
    row.style.cssText = 'padding:7px 12px;cursor:pointer;white-space:nowrap;' + (opts.muted ? 'color:#999;' : 'color:#1a1a1a;');
    row.addEventListener('mouseenter', () => { row.style.background = '#2a5eb2'; row.style.color = '#fff'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; row.style.color = opts.muted ? '#999' : '#1a1a1a'; });
    row.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    menu.appendChild(row);
    return row;
  }

  // Stage 1: choose among overlapping items.
  function showPicker(candidates, clientX, clientY) {
    const model = parseModel();
    const menu = buildMenu(clientX, clientY);
    addHeader(menu, candidates.length + ' items here — select one:');
    candidates.forEach((item) => {
      const row = addRow(menu, labelFor(item, model), () => showActions(item, clientX, clientY));
      row.addEventListener('mouseenter', () => highlightItem(item));
    });
  }

  // Stage 2: actions for a chosen item.
  function showActions(item, clientX, clientY) {
    const model = parseModel();
    highlightItem(item);
    const menu = buildMenu(clientX, clientY);
    addHeader(menu, labelFor(item, model));

    // The legend as a whole (its box/title) — only action is removing it entirely.
    if (item.kind === 'legendBox') {
      addRow(menu, '⟶  Go to JSON definition', () => { closeMenu(); gotoLegend(); });
      addRow(menu, '🗑  Delete entire legend', () => { closeMenu(); deleteLegend(); });
      return;
    }

    if (item.kind === 'lane') {
      addRow(menu, '↔  Drag (shift position)', () => { closeMenu(); enterDrag(item, 'shift'); });
      addRow(menu, '⇄  Drag (reorder)', () => { closeMenu(); enterDrag(item, 'reorder'); });
      addRow(menu, '✎  Rename…', () => { renameLanePrompt(item, clientX, clientY); });
      addRow(menu, '⌹  Make sub-lane of…', () => { convertLanePrompt(item, clientX, clientY); });
      addRow(menu, '▦  Make medium lane', () => { closeMenu(); convertLane(item, 'medium'); });
    } else if (DRAGGABLE[item.kind]) {
      addRow(menu, '✥  Drag', () => { closeMenu(); enterDrag(item); });
    }

    if (TEXTABLE[item.kind]) {
      const label = hasText(item, model) ? '✎  Edit text…' : '✎  Add text…';
      addRow(menu, label, () => { editText(item, clientX, clientY); });
    }
    if (HAS_COLOR[item.kind]) addRow(menu, '🎨  Change color ▸', () => { showColorMenu(item, clientX, clientY); });
    if (HAS_STYLE[item.kind]) {
      const style = (currentField(model, item, 'style') === 'dashed') ? 'solid' : 'dashed';
      addRow(menu, '┄  Make ' + style, () => { closeMenu(); setItemField(item, 'style', quote(style)); });
    }
    if (item.kind === 'laneGroup') addRow(menu, '☷  Edit members…', () => { closeMenu(); startGroupSelect(item.index); });
    if (item.kind !== 'title') addRow(menu, '⟶  Go to JSON definition', () => { closeMenu(); gotoDefinition(item); });
    if (DELETABLE[item.kind]) addRow(menu, '🗑  Delete', () => { closeMenu(); deleteItem(item); });
    if (item.kind === 'lane') {
      const refs = countLaneRefs(model, parseLanePrefix(model.lanes[item.index]).clean);
      addRow(menu, '🗑  Delete lane' + (refs ? ' (+ ' + refs + ' refs)' : ''), () => { closeMenu(); deleteLaneAction(item); });
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
  function convertLanePrompt(item, clientX, clientY) {
    const ed = getEditor(); const model = parseModel();
    if (!ed || !model) return;
    const clean = parseLanePrefix(model.lanes[item.index]).clean;
    showTextInput(clientX, clientY, '', (parent) => {
      const p = (parent || '').trim(); if (!p) return;
      const text = renameLane(ed.getValue(), clean, p + '.' + clean);
      if (text != null) applyText(text);
    });
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

  // Colors already used in the diagram, most-frequent first. So the picker can
  // offer "reuse a color you already have" before the generic palette.
  function usedColors(model) {
    const counts = new Map();
    const bump = (c) => { if (c && typeof c === 'string') counts.set(c, (counts.get(c) || 0) + 1); };
    if (model) {
      (model.messages || []).forEach((m) => bump(m.color));
      (model.legend || []).forEach((l) => bump(l.color));
      (model.states || []).forEach((s) => bump(s.color));
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  }

  function showColorMenu(item, clientX, clientY) {
    const model = parseModel();
    const base = (item.kind === 'state' ? STATE_PALETTE : PALETTE);
    const menu = buildMenu(clientX, clientY);

    const swatch = (c) => {
      const row = addRow(menu, '   ' + c, () => { closeMenu(); setItemField(item, 'color', quote(c)); });
      row.style.borderLeft = '14px solid ' + c;
    };

    // 1) colors already in use (top), 2) the rest of the palette, 3) custom.
    const used = usedColors(model);
    if (used.length) {
      addHeader(menu, 'Used in diagram:');
      used.forEach(swatch);
      addHeader(menu, 'Palette:');
    } else {
      addHeader(menu, 'Color:');
    }
    base.filter((c) => used.indexOf(c) === -1).forEach(swatch);

    addRow(menu, 'Custom…', () => {
      const cur = currentField(model, item, 'color') || '';
      showTextInput(clientX, clientY, cur, (v) => { if (v && v.trim()) setItemField(item, 'color', quote(v.trim())); });
    });
  }

  function renameLanePrompt(item, clientX, clientY) {
    const model = parseModel(); const ed = getEditor();
    if (!model || !ed) return;
    const pp = parseLanePrefix(model.lanes[item.index]);
    showTextInput(clientX, clientY, pp.clean, (v) => {
      const nv = (v || '').trim(); if (!nv) return;
      const text = renameLane(ed.getValue(), pp.clean, nv);
      if (text != null) applyText(text);
    });
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

  // Reusable inline text input. Commits on Enter/blur, cancels on Escape.
  function showTextInput(clientX, clientY, initial, onCommit) {
    closeMenu();
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = initial || '';
    inp.className = 'flowdrom-textedit';
    inp.style.cssText =
      'position:fixed;z-index:10000;font:13px "Segoe UI",sans-serif;padding:6px 8px;' +
      'border:1px solid #2a5eb2;border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,0.2);min-width:220px;';
    inp.style.left = clientX + 'px';
    inp.style.top = clientY + 'px';
    document.body.appendChild(inp);
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      const v = inp.value;
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      if (commit) onCommit(v);
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation(); // don't let Escape reach the global handler
    });
    inp.addEventListener('blur', () => finish(true));
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
      const pm = parseLabelMarkers((arr[item.index] || {}).label || '');
      showTextInput(clientX, clientY, pm.text, (v) => commit()(setOrInsertField(ed.getValue(), key, item.index, 'label', quote(pm.markers + v))));
    } else if (item.kind === 'state') {
      showTextInput(clientX, clientY, (model.states[item.index] || {}).label || '', (v) => commit()(setOrInsertField(ed.getValue(), key, item.index, 'label', quote(v))));
    } else if (item.kind === 'laneGroup') {
      showTextInput(clientX, clientY, (model.laneGroups[item.index] || {}).label || '', (v) => commit()(setOrInsertField(ed.getValue(), key, item.index, 'label', quote(v))));
    } else if (item.kind === 'infoBox') {
      const off = parseInfoOffset((model.infoBoxes[item.index] || {}).text || '');
      showTextInput(clientX, clientY, off.rest, (v) => commit()(setOrInsertField(ed.getValue(), key, item.index, 'text', quote(buildInfoText(off.x, off.y, v)))));
    } else if (item.kind === 'title') {
      showTextInput(clientX, clientY, model.title || '', (v) => commit()(setTopField(ed.getValue(), 'title', quote(v))));
    }
  }
  // Does the item currently have non-empty text?
  function hasText(item, model) {
    try {
      if (item.kind === 'message') return !!parseLabelMarkers(model.messages[item.index].label || '').text;
      if (item.kind === 'legend') return !!parseLabelMarkers(model.legend[item.index].label || '').text;
      if (item.kind === 'state') return !!(model.states[item.index].label || '');
      if (item.kind === 'laneGroup') return !!(model.laneGroups[item.index].label || '');
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
      h.setAttribute('fill', '#fff'); h.setAttribute('stroke', stroke || '#e6007a'); h.setAttribute('stroke-width', 2 / scale);
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
        band.setAttribute('fill', 'rgba(42,94,178,0.18)'); band.setAttribute('stroke', '#2a5eb2'); band.setAttribute('stroke-dasharray', '3,3');
        ov.appendChild(band);
      });
    }

    if (!dragItem) return; // creation / group-select mode: overlay positioned, no handles

    if (dragItem.kind === 'message') {
      const msg = (model.messages || [])[dragItem.index];
      if (msg) {
        const [from, to] = String(msg.path || '').split('->').map((s) => s.trim());
        const x1 = laneX(from), y1 = timeToY(msg.fromTime), x2 = laneX(to), y2 = timeToY(msg.toTime);
        addHandle(x1, y1, { 'data-h': 'msg', 'data-i': dragItem.index, 'data-end': 'from' });
        addHandle(x2, y2, { 'data-h': 'msg', 'data-i': dragItem.index, 'data-end': 'to' });
        // label-position handle (orange), only when the message has visible text
        const pm = parseLabelMarkers(msg.label || '');
        if (pm.text && x1 != null && x2 != null) {
          const len = Math.hypot(x2 - x1, y2 - y1) || 1;
          const ratio = ratioFromMarkers(pm.markers);
          const lx = (x1 + x2) / 2 + ratio * (x2 - x1), ly = (y1 + y2) / 2 + ratio * (y2 - y1);
          addHandle(lx, ly, { 'data-h': 'msglabel', 'data-i': dragItem.index }, '#e67e00');
        }
      }
    } else if (dragItem.kind === 'state') {
      const st = (model.states || [])[dragItem.index];
      if (st) {
        const x = laneX(st.lane);
        const to = st.toTime != null ? st.toTime : st.fromTime;
        addHandle(x, timeToY(st.fromTime), { 'data-h': 'state', 'data-i': dragItem.index, 'data-end': 'from' }, '#1769aa');
        addHandle(x, timeToY((st.fromTime + to) / 2), { 'data-h': 'state', 'data-i': dragItem.index, 'data-end': 'move' });
        addHandle(x, timeToY(to), { 'data-h': 'state', 'data-i': dragItem.index, 'data-end': 'to' }, '#1769aa');
      }
    } else if (dragItem.kind === 'infoBox') {
      const info = (model.infoBoxes || [])[dragItem.index];
      if (info) {
        const x = laneX(info.lane); const off = parseInfoOffset(info.text);
        addHandle(x + off.x, timeToY(info.time) + off.y, { 'data-h': 'info', 'data-i': dragItem.index });        // box (offset)
        addHandle(x, timeToY(info.time), { 'data-h': 'infoanchor', 'data-i': dragItem.index }, '#1769aa');        // anchor (lane/time)
      }
    } else if (dragItem.kind === 'lane') {
      const ln = L.lanes[dragItem.index];
      if (ln) addHandle(ln.x, L.laneTop - 25, { 'data-h': 'lane', 'data-i': dragItem.index, 'data-mode': dragItem.mode || 'reorder' });
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
      const lane = nearestLaneClean(p.x), x = laneX(lane), pt = yToTime(p.y);
      let fromT = st.fromTime, toT = (st.toTime != null ? st.toTime : st.fromTime);
      if (drag.end === 'from') fromT = snapTime(pt);
      else if (drag.end === 'to') toT = snapTime(pt);
      else { const mid = (st.fromTime + toT) / 2, dur = toT - st.fromTime; fromT = Math.max(0, snapTime(st.fromTime + (pt - mid))); toT = fromT + dur; }
      fromT = Math.max(0, fromT); toT = Math.max(0, toT);
      const hy = drag.end === 'to' ? toT : (drag.end === 'from' ? fromT : (fromT + toT) / 2);
      drag.handle.setAttribute('cx', x); drag.handle.setAttribute('cy', timeToY(hy));
      drag.preview = { lane: lane, fromTime: fromT, toTime: toT };
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
        const parts = String(msg.path || '').split('->').map((s) => s.trim());
        const x1 = laneX(parts[0]), y1 = timeToY(msg.fromTime), x2 = laneX(parts[1]), y2 = timeToY(msg.toTime);
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
    }
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
      const parts = String(msg.path).split('->').map((s) => s.trim());
      if (d.end === 'from') parts[0] = d.preview.lane; else parts[1] = d.preview.lane;
      text = setElementFields(text, 'messages', d.index, [
        { field: 'path', literal: quote(parts.join('->')) },
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
      text = setOrInsertField(text, 'infoBoxes', d.index, 'lane', quote(d.preview.lane));
      if (text != null) text = setOrInsertField(text, 'infoBoxes', d.index, 'time', numLiteral(d.preview.time));
    } else if (d.kind === 'lane') {
      const L = layout(); if (!L) return;
      if (d.mode === 'shift') {
        // Adjust the lane's '>'/'<' prefix (each = 20px) to match the drop x.
        const ln = L.lanes[d.index];
        const pp = parseLanePrefix(model.lanes[d.index]);
        const naturalX = ln.x - pp.offsetPx;
        const count = Math.round((d.preview.x - naturalX) / 20);
        const lanes = model.lanes.slice();
        lanes[d.index] = buildLaneName(pp.clean, count);
        text = setLanes(text, lanes);
      } else {
        // reorder: target slot = number of OTHER lanes whose x is left of drop x
        let target = 0;
        for (const l of L.lanes) { if (l.index !== d.index && l.x < d.preview.x) target++; }
        text = moveLane(text, d.index, target);
      }
      if (text != null) applyText(text); // dragItem index may shift; drop drag mode
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
      if (candidates.length === 1) showActions(candidates[0], e.clientX, e.clientY);
      else showPicker(candidates, e.clientX, e.clientY);
      return;
    }
    // Empty space (left click): dismiss any menu / selection. Add is on right-click.
    closeMenu();
    exitDrag();
    clearSelection();
  }

  // ---- creation ----

  function showCreateMenu(clientX, clientY) {
    const menu = buildMenu(clientX, clientY);
    addHeader(menu, 'Add element:');
    addRow(menu, '➕  Message (drag to draw)', () => { closeMenu(); startCreating('message'); });
    addRow(menu, '➕  State (drag to draw)', () => { closeMenu(); startCreating('state'); });
    addRow(menu, '➕  Info box (click a lane)', () => { closeMenu(); startCreating('infoBox'); });
    addRow(menu, '➕  Lane here', () => { closeMenu(); addLaneAt(clientX, clientY); });
    addRow(menu, '➕  Legend entry', () => { closeMenu(); addLegendEntry(clientX, clientY); });
    addRow(menu, '➕  Lane group (select lanes)', () => { closeMenu(); startGroupSelect(); });
    addRow(menu, '⚙  Text styling…', () => { closeMenu(); showOptionsPanel(); });
  }

  // Global text styling panel — edits the options.<entity>.{textSize,textColor}.
  function showOptionsPanel() {
    const ed = getEditor(); if (!ed) return;
    const existing = document.querySelector('.flowdrom-options-panel'); if (existing) existing.remove();
    const opts = (parseModel() || {}).options || {};
    const panel = document.createElement('div');
    panel.className = 'flowdrom-options-panel';
    panel.style.cssText = 'position:fixed;z-index:10001;top:60px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #bbb;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,0.25);font:13px "Segoe UI",sans-serif;padding:12px 14px;max-height:80vh;overflow:auto;';
    const h = document.createElement('div'); h.textContent = 'Text styling (blank = default)'; h.style.cssText = 'font-weight:600;margin-bottom:8px;font-size:15px;'; panel.appendChild(h);
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:auto 70px 110px;gap:6px 10px;align-items:center;'; panel.appendChild(grid);
    const hdr = (t) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'color:#888;font-size:11px;'; return d; };
    grid.appendChild(hdr('Entity')); grid.appendChild(hdr('Size')); grid.appendChild(hdr('Color'));
    OPTION_ENTITIES.forEach((ent) => {
      const cur = opts[ent] || {};
      const name = document.createElement('div'); name.textContent = ent;
      const size = document.createElement('input'); size.type = 'number'; size.placeholder = 'default'; size.className = 'opt-size'; size.setAttribute('data-ent', ent); size.style.width = '60px';
      if (typeof cur.textSize === 'number') size.value = cur.textSize;
      const color = document.createElement('input'); color.type = 'text'; color.placeholder = 'default'; color.className = 'opt-color'; color.setAttribute('data-ent', ent); color.style.width = '100px';
      if (cur.textColor && cur.textColor !== 'default') color.value = cur.textColor;
      size.addEventListener('change', () => { const v = size.value.trim() === '' ? null : parseFloat(size.value); const t = setOption(ed.getValue(), ent, 'textSize', v); if (t != null) applyText(t); });
      color.addEventListener('change', () => { const v = color.value.trim() === '' ? null : color.value.trim(); const t = setOption(ed.getValue(), ent, 'textColor', v); if (t != null) applyText(t); });
      grid.appendChild(name); grid.appendChild(size); grid.appendChild(color);
    });
    const close = document.createElement('button'); close.textContent = 'Close'; close.style.cssText = 'margin-top:10px;cursor:pointer;padding:4px 12px;'; close.addEventListener('click', () => panel.remove());
    panel.appendChild(close);
    document.body.appendChild(panel);
  }

  function addLegendEntry(clientX, clientY) {
    const ed = getEditor(); if (!ed) return;
    showTextInput(clientX, clientY, '', (v) => {
      const label = (v || '').trim() || 'legend';
      const text = insertArrayElement(ed.getValue(), 'legend', '{ label: ' + quote(label) + ", color: 'black', style: 'solid' }");
      if (text != null) applyText(text);
    });
  }

  // ---- lane-group multi-select ----

  function showGroupBanner() {
    const b = document.createElement('div');
    b.className = 'flowdrom-group-banner';
    b.style.cssText =
      'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:10001;background:#2a5eb2;color:#fff;' +
      'padding:8px 12px;border-radius:6px;font:13px "Segoe UI",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.25);display:flex;gap:10px;align-items:center;';
    const span = document.createElement('span');
    span.innerHTML = 'Click lanes to group (<b class="cnt">0</b> selected)';
    const mk = (txt, bg, fn) => { const x = document.createElement('button'); x.textContent = txt; x.style.cssText = 'cursor:pointer;border:none;border-radius:4px;padding:4px 10px;background:' + bg + ';color:#fff;'; x.addEventListener('click', fn); return x; };
    b.appendChild(span);
    b.appendChild(mk(groupEditIndex != null ? 'Save' : 'Create', '#1a7f37', () => createGroupFromSelection(window.innerWidth / 2, 130)));
    b.appendChild(mk('Cancel', '#888', () => endGroupSelect()));
    document.body.appendChild(b);
    groupBanner = b;
  }
  function updateGroupBanner() { if (groupBanner) { const c = groupBanner.querySelector('.cnt'); if (c) c.textContent = groupSelecting ? groupSelecting.size : 0; } }
  function startGroupSelect(editIndex) {
    exitDrag(); creating = null;
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
    });
  }

  function startCreating(kind) {
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

  function onCreateDown(ev) {
    const ov = overlayEl();
    const p = pointerToDiagram(ov, ev);
    if (!p) return;
    ev.preventDefault(); ev.stopPropagation();
    createDrag = { ov: ov, kind: creating, start: p, cur: p, ghost: null };
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
      const x1 = laneX(nearestLaneClean(createDrag.start.x)), y1 = timeToY(snapTime(yToTime(createDrag.start.y)));
      const x2 = laneX(nearestLaneClean(p.x)), y2 = timeToY(snapTime(yToTime(p.y)));
      const g = document.createElementNS(SVGNS, 'line');
      g.setAttribute('x1', x1); g.setAttribute('y1', y1); g.setAttribute('x2', x2); g.setAttribute('y2', y2);
      g.setAttribute('stroke', '#e6007a'); g.setAttribute('stroke-width', 2); g.setAttribute('stroke-dasharray', '5,4');
      ov.appendChild(g); createDrag.ghost = g;
    } else if (createDrag.kind === 'state') {
      const x = laneX(nearestLaneClean(createDrag.start.x));
      const t0 = snapTime(yToTime(createDrag.start.y)), t1 = snapTime(yToTime(p.y));
      const yTop = timeToY(Math.min(t0, t1)), yBot = timeToY(Math.max(t0, t1));
      const g = document.createElementNS(SVGNS, 'rect');
      g.setAttribute('x', x - 25); g.setAttribute('y', yTop); g.setAttribute('width', 50); g.setAttribute('height', Math.max(2, yBot - yTop));
      g.setAttribute('fill', 'rgba(230,0,122,0.12)'); g.setAttribute('stroke', '#e6007a'); g.setAttribute('stroke-dasharray', '4,3');
      ov.appendChild(g); createDrag.ghost = g;
    } else if (createDrag.kind === 'infoBox') {
      const x = laneX(nearestLaneClean(p.x)), y = timeToY(snapTime(yToTime(p.y)));
      const g = document.createElementNS(SVGNS, 'circle');
      g.setAttribute('cx', x); g.setAttribute('cy', y); g.setAttribute('r', 6);
      g.setAttribute('fill', 'rgba(46,139,87,0.3)'); g.setAttribute('stroke', '#2e8b57');
      ov.appendChild(g); createDrag.ghost = g;
    }
  }

  function onCreateUp(ev) {
    window.removeEventListener('pointermove', onCreateMove, true);
    window.removeEventListener('pointerup', onCreateUp, true);
    const d = createDrag; createDrag = null;
    const wasCreating = creating;
    cancelCreating();
    ignoreNextClick = true;
    if (!d) return;
    const ed = getEditor(); if (!ed) return;
    let text = ed.getValue(), literal = null, key = null;

    if (wasCreating === 'infoBox') {
      const lane = nearestLaneClean(d.start.x);
      const t = snapTime(yToTime(d.start.y));
      if (lane == null) return;
      showTextInput(ev.clientX, ev.clientY, 'note', (v) => {
        const txt = (v && v.trim()) || 'note';
        const lit = '{ lane: ' + quote(lane) + ', time: ' + numLiteral(t) + ', text: ' + quote(txt) + ' }';
        const out = insertArrayElement(ed.getValue(), 'infoBoxes', lit);
        if (out != null) applyText(out);
      });
      return;
    }
    if (wasCreating === 'message') {
      const from = nearestLaneClean(d.start.x), to = nearestLaneClean(d.cur.x);
      const t0 = snapTime(yToTime(d.start.y)), t1 = snapTime(yToTime(d.cur.y));
      if (from == null || to == null) return;
      if (from === to && t0 === t1) return; // ignore a zero gesture
      key = 'messages';
      literal = "{ path: '" + from + '->' + to + "', fromTime: " + numLiteral(t0) + ', toTime: ' + numLiteral(t1) + ' }';
    } else if (wasCreating === 'state') {
      const lane = nearestLaneClean(d.start.x);
      let t0 = snapTime(yToTime(d.start.y)), t1 = snapTime(yToTime(d.cur.y));
      if (lane == null) return;
      if (t1 < t0) { const tmp = t0; t0 = t1; t1 = tmp; }
      if (t0 === t1) t1 = t0 + 1; // give a fresh state a visible duration
      key = 'states';
      literal = "{ lane: " + quote(lane) + ", label: 'state', fromTime: " + numLiteral(t0) + ', toTime: ' + numLiteral(t1) + ' }';
    }
    if (!literal) return;
    text = insertArrayElement(text, key, literal);
    if (text != null) applyText(text);
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
    });
  }

  function attach() {
    const container = getContainer();
    if (!container || container.__flowdromEditorBound) return;
    container.style.position = container.style.position || 'relative';
    container.addEventListener('click', onCanvasClick);
    container.addEventListener('pointerdown', function (e) {
      ignoreNextClick = false; // a new gesture starts; never let a stale flag eat its click
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-h')) { onHandleDown(e); return; }
      if (creating) { onCreateDown(e); return; }
      // Press inside a selected item's highlight box and drag up/down → shift
      // every selected item in time. Works for a single selected item too.
      if (e.button === 0 && !(e.ctrlKey || e.metaKey) && selection.length >= 1) {
        if (pointInSelection(e.clientX, e.clientY)) { e.preventDefault(); startGroupDrag(e); }
      }
    }, true);
    container.addEventListener('scroll', function () { clearSelBox(); });
    // Right-click opens the Add menu (left-click empty is reserved for dismiss).
    container.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (creating) return;
      showCreateMenu(e.clientX, e.clientY);
    });
    // Close menu when clicking outside it (and outside the canvas handled above).
    document.addEventListener('pointerdown', function (e) {
      if (menuEl && !menuEl.contains(e.target) && !container.contains(e.target)) { closeMenu(); }
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMenu(); exitDrag(); cancelCreating(); endGroupSelect(); clearSelection(); } });
    container.__flowdromEditorBound = true;
  }

  function installRenderHook() {
    if (typeof window === 'undefined' || typeof window.renderGraph !== 'function' || window.renderGraph.__flowdromWrapped) return;
    const orig = window.renderGraph;
    const wrapped = function () {
      const out = orig.apply(this, arguments);
      try { attach(); rebuildOverlay(); if (dragItem) highlightItem(dragItem); } catch (e) { /* never break rendering */ }
      return out;
    };
    wrapped.__flowdromWrapped = true;
    window.renderGraph = wrapped;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { locateArrayElement, replaceFieldValue, setElementFields, parseInfoOffset, buildInfoText, quote, numLiteral, locateArray, insertArrayElement, deleteArrayElement, deleteTopLevelKey, setLanes, moveLane, parseLabelMarkers, markersFromRatio, ratioFromMarkers, insertField, setOrInsertField, setTopField, renameLane, renameLaneToken, deleteLane, countLaneRefs, locateObjectValue, setOption };
  }

  if (typeof document !== 'undefined') {
    installRenderHook();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { installRenderHook(); attach(); rebuildOverlay(); });
    } else { attach(); rebuildOverlay(); }
  }
})();
