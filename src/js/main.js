let currentConfig = {};

// Per-entity text defaults. Each entity is configurable in the options section
// as options.<entity> = { textSize, textColor }. A field that is missing or set
// to the string 'default' falls back to the value here.
const TEXT_DEFAULT_SIZES = {
  lane: 18, subLane: 12, laneGroup: 14, message: 15, state: 11,
  info: 12, legend: 27, legendTitle: 16, time: 12, title: 24, frame: 13,
};
// Default colors. 'item' means "inherit the message's / legend entry's own color".
const TEXT_DEFAULT_COLORS = {
  lane: '#2a5eb2', subLane: '#2a5eb2', laneGroup: '#6699cc',
  message: 'item', state: 'black', info: '#333',
  legend: 'item', legendTitle: '#2a5eb2', time: '#666', title: '#2a5eb2', frame: '#666',
};
const TEXT_TYPES = Object.keys(TEXT_DEFAULT_COLORS);

// Default frame side margins (px), shared with the editor's geometry so the
// drawn box, hit-testing and drag handles agree. lMargin / rMargin: horizontal
// padding beyond the leftmost / rightmost spanned lane. There is no vertical
// margin — the top/bottom edges sit exactly on fromTime/toTime, which the time
// axis already controls at 0.1 resolution. Overridable per frame. (#frames)
const FRAME_DEFAULT_L_MARGIN = 40;
const FRAME_DEFAULT_R_MARGIN = 40;
// Resolve a frame's left/right margins, honoring the legacy single xMargin.
function frameMargins(frame) {
  const f = frame || {};
  const legacy = (typeof f.xMargin === 'number') ? f.xMargin : null;
  const lm = (typeof f.lMargin === 'number') ? f.lMargin : (legacy != null ? legacy : FRAME_DEFAULT_L_MARGIN);
  const rm = (typeof f.rMargin === 'number') ? f.rMargin : (legacy != null ? legacy : FRAME_DEFAULT_R_MARGIN);
  return { lm: lm, rm: rm };
}

// Resolve the per-entity text config (size + color) from the options section.
// For each entity, textSize/textColor come straight from options.<entity>; a
// missing value or the literal 'default' yields the built-in default. This is
// the single source of truth shared by the renderer (layout math) and
// buildDiagramCss (the embedded CSS).
function resolveTextConfig(options) {
  const o = options || {};
  const cfg = { timeStep: 50 };

  TEXT_TYPES.forEach(type => {
    const e = o[type] || {};
    const size = (typeof e.textSize === 'number') ? e.textSize : TEXT_DEFAULT_SIZES[type];
    const color = (e.textColor != null && e.textColor !== 'default') ? e.textColor : TEXT_DEFAULT_COLORS[type];
    cfg[type] = { size, color };
  });

  return cfg;
}

// Read + resolve the text config straight from the editor's JSON. Used by the
// export paths; the renderer resolves from its already-parsed input instead.
function getDisplayOptions() {
  try {
    const cfg = JSON5.parse(document.getElementById("input").value);
    return resolveTextConfig(cfg.options);
  } catch (e) {
    return resolveTextConfig({});
  }
}

// Build the stylesheet embedded into every rendered/exported SVG. Driven by the
// resolved text config so the output is self-contained and looks identical in
// apps that consume only this renderer (without index.html's CSS).
function buildDiagramCss(cfg) {
  cfg = cfg || resolveTextConfig({});
  // Portable sans so exports render consistently everywhere (Helvetica on Mac,
  // Arial on Windows — metric-compatible — and a generic fallback elsewhere).
  // Message/legend labels stay monospaced (Courier New) by design.
  const sans = "font-family: Helvetica, Arial, sans-serif;";
  // For message/legend, 'item' leaves the per-item fill attribute showing; any
  // other value overrides every label with that color.
  const msgFill = cfg.message.color === 'item' ? '' : ` fill: ${cfg.message.color};`;
  const legendFill = cfg.legend.color === 'item' ? '' : ` fill: ${cfg.legend.color};`;
  return `
    .label-box { fill: white; stroke: none; }
    .state-box { fill: #ffffcc; stroke: #aaa; rx: 4; ry: 4; }
    .lane-label { font-weight: bold; font-size: ${cfg.lane.size}px; text-anchor: middle; fill: ${cfg.lane.color}; ${sans} }
    .sub-lane-label { font-weight: bold; font-size: ${cfg.subLane.size}px; text-anchor: middle; fill: ${cfg.subLane.color}; ${sans} }
    /* Repeated lane labels: a distinct guide style so they don't read as ordinary
       message/state text. Three variants (options.graph.labelStyle); opacity is
       set per-group inline from options.graph.opacity. */
    .lane-label-repeat { pointer-events: none; }
    /* outline: hollow, colored letters (true "word-art" outline) */
    .lane-label-repeat.outline .lane-label { fill: none; stroke: ${cfg.lane.color}; stroke-width: 1.3px; stroke-linejoin: round; }
    .lane-label-repeat.outline .sub-lane-label { fill: none; stroke: ${cfg.subLane.color}; stroke-width: 1px; stroke-linejoin: round; }
    /* white: white letters with a colored outline */
    .lane-label-repeat.white .lane-label { fill: #ffffff; stroke: ${cfg.lane.color}; stroke-width: 3px; paint-order: stroke; stroke-linejoin: round; }
    .lane-label-repeat.white .sub-lane-label { fill: #ffffff; stroke: ${cfg.subLane.color}; stroke-width: 2px; paint-order: stroke; stroke-linejoin: round; }
    /* solid: colored letters with a white halo (chunky, reads solid on white) */
    .lane-label-repeat.solid .lane-label, .lane-label-repeat.solid .sub-lane-label { paint-order: stroke; stroke: #ffffff; stroke-width: 3.5px; stroke-linejoin: round; }
    .lane-group-label { font-weight: bold; font-size: ${cfg.laneGroup.size}px; text-anchor: middle; fill: ${cfg.laneGroup.color}; ${sans} }
    .lane-group-bracket { stroke: #6699cc; stroke-width: 2; stroke-dasharray: 4,4; fill: none; }
    .message-label { font-size: ${cfg.message.size}px; font-family: 'Courier New', monospace; dominant-baseline: middle; font-weight: bold;${msgFill} }
    .state-label { font-size: ${cfg.state.size}px; fill: ${cfg.state.color}; ${sans} text-anchor: middle; }
    .arrow { stroke-width: 2; }
    .dashed { stroke-dasharray: 5,5; }
    .time-label { font-size: ${cfg.time.size}px; fill: ${cfg.time.color}; ${sans} }
    .grid-line { stroke: #eee; stroke-width: 1; }
    .legend-box { fill: white; stroke: #ccc; stroke-width: 1; rx: 6; ry: 6; }
    .legend-title { font-weight: bold; font-size: ${cfg.legendTitle.size}px; fill: ${cfg.legendTitle.color}; ${sans} }
    .legend-label { font-size: ${cfg.legend.size}px; font-family: 'Courier New', monospace; dominant-baseline: middle;${legendFill} }
    .info-box { fill: white; stroke: #333; stroke-width: 1; rx: 4; ry: 4; }
    .info-box-text { font-size: ${cfg.info.size}px; ${sans} fill: ${cfg.info.color}; }
    .info-box-line { stroke: #333; stroke-width: 1; stroke-dasharray: 3,3; fill: none; }
    /* Interaction frames (PlantUML-style): a thin bordered region with a cut-corner
       label tab at the top-left. Transparent interior so it scopes without hiding. */
    .frame-box { fill: none; stroke: #888; stroke-width: 1.2; }
    .frame-tab { fill: #f3f3f3; stroke: #888; stroke-width: 1.2; }
    .frame-label { font-size: ${cfg.frame.size}px; font-weight: bold; ${sans} fill: ${cfg.frame.color}; }
  `;
}

// ===========================================================================
// Canonical config formatter — the single source of truth for "tidy" JSON.
// Used by the Canonize button, the graphical editor (after every edit), and
// Load SVG. Produces guide-style output: top-level keys in a fixed order, one
// element per line for array-of-object sections, and small objects (title,
// lanes, options) rendered inline. Single-quoted strings + bare identifier keys.
// ===========================================================================

// Fixed top-level key order. Keys not listed are appended in original order.
const TOP_LEVEL_ORDER = ['title', 'options', 'lanes', 'laneGroups', 'frames', 'infoBoxes', 'messages', 'states', 'legend'];
// Preferred key order within each array section's element objects.
const SECTION_KEY_ORDER = {
  laneGroups: ['label', 'lanes'],
  frames: ['label', 'lanes', 'background', 'fromTime', 'toTime', 'lMargin', 'rMargin'],
  infoBoxes: ['lane', 'time', 'background', 'tether', 'text'],
  messages: ['path', 'label', 'color', 'style', 'fromTime', 'toTime'],
  states: ['lane', 'label', 'color', 'width', 'fromTime', 'toTime'],
  legend: ['label', 'color', 'style'],
};

// Emit a key bare when it's a valid identifier, else single-quoted.
function formatKey(k) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : "'" + String(k).replace(/'/g, "\\'") + "'";
}

// Serialize any scalar / inline array / inline object as a one-line JSON5 literal.
function jsonLiteral(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return String(value);
  if (t === 'string') return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  if (Array.isArray(value)) return value.length ? '[' + value.map(jsonLiteral).join(', ') + ']' : '[]';
  if (t === 'object') {
    const ks = Object.keys(value);
    if (!ks.length) return '{}';
    return '{ ' + ks.map(k => formatKey(k) + ': ' + jsonLiteral(value[k])).join(', ') + ' }';
  }
  return JSON.stringify(value);
}

// Order an object's keys by a preferred list, then append any extras (original order).
function orderedKeys(obj, preferred) {
  const keys = Object.keys(obj);
  return preferred.filter(k => keys.includes(k)).concat(keys.filter(k => preferred.indexOf(k) === -1));
}

// Migrate the lanes array to the order-based sub-lane convention: a sub-lane is
// always named "Parent.Sub", and its left/right side comes from its position in
// the array relative to the parent. Legacy "Sub.Parent" names (which encoded a
// left-side sub-lane in the name itself) are rewritten to "Parent.Sub" and moved
// to just before their parent so they keep rendering on the left. Preserves any
// >/< shift prefix. Idempotent: a model with no legacy names is returned as-is.
function migrateLanes(lanes) {
  if (!Array.isArray(lanes) || !lanes.length) return lanes;
  const prefixOf = (raw) => { const m = /^([<>]+)/.exec(String(raw == null ? '' : raw)); return m ? m[1] : ''; };
  const mains = new Set(lanes.map(cleanLaneName).filter(n => n && !n.includes('.')));

  const items = lanes.map(raw => {
    const pfx = prefixOf(raw), c = cleanLaneName(raw), parts = c.split('.');
    if (parts.length === 2 && !mains.has(parts[0]) && mains.has(parts[1])) {
      return { raw: pfx + parts[1] + '.' + parts[0], reverse: true, parent: parts[1] };
    }
    return { raw: raw };
  });
  if (!items.some(it => it.reverse)) return lanes; // already in the new form

  // Emit converted left-side sub-lanes immediately before their parent.
  const reverseByParent = {};
  items.forEach(it => { if (it.reverse) (reverseByParent[it.parent] = reverseByParent[it.parent] || []).push(it.raw); });
  const out = [];
  items.forEach(it => {
    if (it.reverse) return;
    const c = cleanLaneName(it.raw);
    if (reverseByParent[c]) { reverseByParent[c].forEach(r => out.push(r)); delete reverseByParent[c]; }
    out.push(it.raw);
  });
  Object.keys(reverseByParent).forEach(p => reverseByParent[p].forEach(r => out.push(r))); // orphans
  return out;
}

// Format a parsed config model into canonical, guide-style text.
function formatConfig(model) {
  if (model == null || typeof model !== 'object' || Array.isArray(model)) return jsonLiteral(model);
  if (Array.isArray(model.lanes)) model = Object.assign({}, model, { lanes: migrateLanes(model.lanes) });
  const lines = orderedKeys(model, TOP_LEVEL_ORDER).map(key => {
    const value = model[key];
    const isObjArray = Array.isArray(value) && value.length > 0 &&
      value.every(v => v && typeof v === 'object' && !Array.isArray(v));
    if (isObjArray) {
      const order = SECTION_KEY_ORDER[key] || [];
      const elems = value.map(item =>
        '    { ' + orderedKeys(item, order).map(k => formatKey(k) + ': ' + jsonLiteral(item[k])).join(', ') + ' }'
      );
      return '  ' + key + ': [\n' + elems.join(',\n') + '\n  ]';
    }
    return '  ' + key + ': ' + jsonLiteral(value);
  });
  return '{\n' + lines.join(',\n') + '\n}';
}

// Resolve a raw lane token to its clean name (strip the >/< shift prefix).
function cleanLaneName(raw) {
  const s = String(raw == null ? '' : raw);
  const m = /^([<>]+)([\s\S]*)$/.exec(s);
  return (m ? m[2] : s).trim();
}

// Parse a message path. 'A->B' and 'B<-A' both mean "from A to B" — the back
// arrow lets you write the receiver first. When both sides name the SAME lane
// it is a self message, and the notation picks the side: 'A->A' loops to the
// RIGHT of the lane, 'A<-A' to the LEFT. Returns { from, to, self, side } with
// from/to always in semantic (sender → receiver) order, or null when the
// string contains no arrow. Pure. (#self-message)
function parsePath(path) {
  const s = String(path == null ? '' : path);
  let i = s.indexOf('->');
  if (i >= 0) {
    const a = s.slice(0, i).trim(), b = s.slice(i + 2).trim();
    return { from: a, to: b, self: a === b && a !== '', side: 'right' };
  }
  i = s.indexOf('<-');
  if (i >= 0) {
    const a = s.slice(0, i).trim(), b = s.slice(i + 2).trim();
    return { from: b, to: a, self: a === b && a !== '', side: 'left' };
  }
  return null;
}

// Assign each message a sequence number for autonumbering: ordered by fromTime
// ascending, ties broken by array index. Returns a map { messageIndex: number }
// (1-based). Pure — the single source of truth shared by the renderer and tests,
// so numbers stay deterministic regardless of array order. (#autonumber)
function messageNumbers(messages) {
  const out = {};
  (messages || []).map((m, i) => ({ i: i, t: (typeof m.fromTime === 'number' ? m.fromTime : 0) }))
    .sort((a, b) => (a.t - b.t) || (a.i - b.i))
    .forEach((o, k) => { out[o.i] = k + 1; });
  return out;
}

// Parse a state label: a leading '^' renders the text vertically (rotated 90°,
// reading bottom-up) — the natural fit for thin activation-style bars (pairs
// with the state's optional `width` field). '|' still splits lines. Pure.
// (#activation)
function parseStateLabel(raw) {
  const s = String(raw == null ? '' : raw);
  const vertical = s.charAt(0) === '^';
  return { vertical: vertical, lines: (vertical ? s.slice(1) : s).split('|') };
}

// Pure: compute each lane group's resolved member lanes + horizontal extent.
// `lanes` are RAW lane strings (may carry >/< shift prefixes) and `lanePositions`
// is keyed by those raw strings, but a group's lane names are CLEAN — so we map
// clean -> raw before the membership/position lookups. This is what keeps a
// shifted lane (e.g. '>CA0') inside its group instead of being dropped.
function computeGroupExtents(lanes, laneGroups, lanePositions) {
  const rawByClean = {};
  (lanes || []).forEach(raw => { rawByClean[cleanLaneName(raw)] = raw; });
  return (laneGroups || []).map(group => {
    const members = (group.lanes || []).filter(name => Object.prototype.hasOwnProperty.call(rawByClean, name));
    const positions = members
      .map(name => lanePositions[rawByClean[name]])
      .filter(pos => pos !== undefined);
    const ext = Object.assign({}, group, { level: 0, lanes: members, leftmostX: 0, rightmostX: 0 });
    if (positions.length > 0) {
      ext.leftmostX = Math.min(...positions);
      ext.rightmostX = Math.max(...positions);
    }
    return ext;
  });
}

// Parse any CSS color (named or hex/rgb) to {r,g,b}, or null if invalid. Uses a
// cached canvas 2d context, which normalizes valid colors and leaves fillStyle
// unchanged for invalid input — so seeding from two different bases and checking
// for agreement detects an invalid color. Browser-only (called during render).
function parseCssColor(str) {
  try {
    const ctx = parseCssColor._ctx || (parseCssColor._ctx = document.createElement('canvas').getContext('2d'));
    ctx.fillStyle = '#000000'; ctx.fillStyle = str; const a = ctx.fillStyle;
    ctx.fillStyle = '#ffffff'; ctx.fillStyle = str; const b = ctx.fillStyle;
    if (a !== b) return null; // invalid: result depended on the seed
    if (a[0] === '#') return { r: parseInt(a.slice(1, 3), 16), g: parseInt(a.slice(3, 5), 16), b: parseInt(a.slice(5, 7), 16) };
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(a);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
  } catch (e) { return null; }
}

// Renders the diagram. With no arguments it reads the JSON from #input and
// commits the result to #svg-container (the normal path, used by the page and by
// any external tool). When `modelOverride` is supplied with `measureOnly` true,
// it builds the SAME svg off-screen and returns { layout, boxes } WITHOUT
// touching the live view — the shared build core behind window.flowdromMeasure,
// used by the editor's auto-arrange for collision detection. (auto-arrange)
function renderGraph(modelOverride, measureOnly) {
  if (!measureOnly) document.querySelectorAll('.flowdrom-editpop').forEach(el => el.remove());
  const svgContainer = document.getElementById("svg-container");

  const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  tempSvg.setAttribute("id", "temp-graph");
  document.body.appendChild(tempSvg);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  tempSvg.appendChild(defs);

  try {
    const input = modelOverride || JSON5.parse(document.getElementById("input").value);
    if (!measureOnly) currentConfig = input;

    const lanes = input.lanes || [];
    const messages = input.messages || [];
    const states = input.states || [];
    const legend = input.legend || [];
    const laneGroups = input.laneGroups || [];
    const infoBoxes = input.infoBoxes || [];
    const frames = input.frames || [];
    const textCfg = resolveTextConfig(input.options);
    // Graph styling (options.graph): repeated lane labels are an opt-in aid for
    // tall diagrams, driven entirely by the model so the editor render, exportSVG,
    // and any external renderer produce identical output. The interval is in TIME
    // units (like fromTime/toTime), so it tracks the diagram's own scale and stays
    // deterministic. Off by default. (repeat-lane-labels)
    const graphOpts = (input.options && input.options.graph) || {};
    const repeatLaneLabels = !!graphOpts.repeatLaneLabels;
    const laneLabelInterval = (graphOpts.laneLabelInterval > 0) ? graphOpts.laneLabelInterval : 5;
    const repeatLabelOpacity = (typeof graphOpts.opacity === 'number')
      ? Math.max(0, Math.min(1, graphOpts.opacity)) : 0.5;
    // When on, every state box in a lane is widened to the widest state in that
    // lane, so the states line up as a column. Width is determined per lane.
    const uniformStateWidth = !!graphOpts.uniformStateWidth;
    // Visual style of the repeated labels: 'outline' (hollow colored letters),
    // 'white' (white letters with a colored outline), or 'solid' (colored fill +
    // white halo). Default 'outline'.
    const labelStyle = (['outline', 'white', 'solid'].indexOf(graphOpts.labelStyle) >= 0) ? graphOpts.labelStyle : 'outline';
    // Self-message loop bulge, px out from the lane — one graph-wide knob
    // (options.graph.selfMessageWidth) so all loops stay consistent. (#self-message)
    const selfMsgWidth = (graphOpts.selfMessageWidth > 0) ? graphOpts.selfMessageWidth : 60;
    // Autonumber (options.graph.autonumber): prefix each message label with a
    // sequence number, computed at render time by (fromTime, then array index) —
    // so numbers stay correct as messages are edited, reordered or re-timed by
    // Arrange, and are never stored in the label text. Off by default. The
    // PlantUML importer flips this on for `autonumber`. (#autonumber)
    const autonumber = !!graphOpts.autonumber;
    const msgNumbers = autonumber ? messageNumbers(messages) : {};

    // Inject the diagram stylesheet into the live tempSvg up front so getBBox()
    // measures label/legend/state text in the real fonts (it reflects the
    // document's current styles). Without this, the auto-sized background boxes
    // are measured in the browser default font and don't fit the text. This is
    // the same CSS exportSVG embeds, so on-screen and exported output match.
    const diagramStyle = document.createElementNS("http://www.w3.org/2000/svg", "style");
    diagramStyle.textContent = buildDiagramCss(textCfg);
    tempSvg.appendChild(diagramStyle);

    // Lane pitch (px). Overridable via options.graph.laneSpacing — the PlantUML
    // importer widens it when long message labels need the room; hand-authored
    // diagrams keep the classic 250 default. (#lane-spacing)
    const laneSpacing = (graphOpts.laneSpacing > 0) ? graphOpts.laneSpacing : 250;
    const timeStep = textCfg.timeStep;
    const showGrid = true;
    const showTimeLabels = true;
    const showStates = true;

    const startX = 150;
    // Empty arrays would make Math.max(...[]) return -Infinity, so guard each.
    const timeOf = (arr, key) => (arr.length ? Math.max(...arr.map(o => o[key])) : 0);
    const maxMessageTime = timeOf(messages, 'toTime');
    const maxStateTime = timeOf(states, 'toTime');
    const maxInfoBoxTime = timeOf(infoBoxes, 'time');
    const maxFrameTime = timeOf(frames, 'toTime');

    // Calculate the overall maximum time. A from-scratch diagram (no messages/
    // states/info boxes yet) gets a small default so the canvas has usable
    // height for lifelines instead of collapsing.
    let maxTime = Math.max(maxMessageTime, maxStateTime, maxInfoBoxTime, maxFrameTime, 0);
    if (maxTime <= 0) maxTime = 4;

    // Extra "runway" below the last event: lifelines, grid and time labels
    // continue one time-unit past the final element, so a new message/state can
    // be dropped just below the last one without running off the canvas. (#9)
    const lifelineTail = 1;
    const lifelineBottom = maxTime + lifelineTail;

    // Lane Positioning Logic
    const lanePositions = {};
    let currentMainLaneIndex = 0;
    const mainLanes = new Set();

    // Helper: parse lane name for manual offset
    function parseLaneNameOffset(lane) {
      let offset = 0;
      let cleanLane = lane;
      const rightMatch = lane.match(/^(>+)(.*)$/);
      const leftMatch = lane.match(/^(<+)(.*)$/);
      if (rightMatch) {
        offset = rightMatch[1].length * 20;
        cleanLane = rightMatch[2];
      } else if (leftMatch) {
        offset = -leftMatch[1].length * 20;
        cleanLane = leftMatch[2];
      }
      return { cleanLane: cleanLane.trim(), offset };
    }

    // Pass 1: Identify and position main lanes
    lanes.forEach(lane => {
      const { cleanLane, offset } = parseLaneNameOffset(lane);
      if (!cleanLane.includes('.')) {
        mainLanes.add(cleanLane);
        lanePositions[lane] = (startX + currentMainLaneIndex * laneSpacing) + offset;
        currentMainLaneIndex++;
      }
    });

    // Map each main lane's clean name to its array index (for order-based sides).
    const mainIndexByName = {};
    lanes.forEach((lane, i) => {
      const { cleanLane } = parseLaneNameOffset(lane);
      if (!cleanLane.includes('.')) mainIndexByName[cleanLane] = i;
    });

    // Classify each lane: a sub-lane is named "Parent.Sub" (parent first) and
    // its side is derived from its position in the lanes array relative to the
    // parent — before the parent = left, after = right. Legacy "Sub.Parent"
    // names are still understood and forced to the left for backward
    // compatibility (they are auto-migrated to the new form on load).
    const laneMeta = lanes.map((lane, i) => {
      const { cleanLane, offset } = parseLaneNameOffset(lane);
      const parts = cleanLane.split('.');
      if (parts.length === 2) {
        if (mainLanes.has(parts[0])) {
          const pIdx = mainIndexByName[parts[0]];
          return { sub: true, parent: parts[0], side: (pIdx != null && i < pIdx) ? 'left' : 'right', offset, i };
        }
        if (mainLanes.has(parts[1])) {
          return { sub: true, parent: parts[1], side: 'left', offset, i }; // legacy reverse form
        }
      }
      return { sub: false, offset, i };
    });

    // Pass 2: Position sub-lanes adjacent to their parent, stacking outward in
    // array order (closest to the parent first). Main lanes keep their Pass 1 x.
    const subSpacing = laneSpacing / 3;
    lanes.forEach((lane, i) => {
      const m = laneMeta[i];
      if (!m.sub) return; // main lane already placed in Pass 1
      const parentKey = lanes.find((l, j) => !laneMeta[j].sub && parseLaneNameOffset(l).cleanLane === m.parent);
      const parentX = parentKey != null ? lanePositions[parentKey] : null;
      if (parentX == null) {
        console.warn(`Parent lane for ${lane} not found. Defaulting position.`);
        lanePositions[lane] = startX + i * laneSpacing + m.offset;
        return;
      }
      // Rank among same-parent, same-side sub-lanes by distance from the parent.
      const sibs = laneMeta.filter(s => s.sub && s.parent === m.parent && s.side === m.side);
      sibs.sort((a, b) => m.side === 'left' ? (b.i - a.i) : (a.i - b.i));
      const rank = sibs.findIndex(s => s.i === m.i) + 1;
      const dir = m.side === 'left' ? -1 : 1;
      lanePositions[lane] = parentX + dir * rank * subSpacing + m.offset;
    });

    // Calculate lane group hierarchy
    let laneGroupLevels = 0;
    let groupHierarchy = [];
    
    if (laneGroups.length > 0) {
      // Resolve membership + extent through clean<->raw mapping so shifted lanes
      // (e.g. '>CA0') stay in their group. See computeGroupExtents.
      groupHierarchy = computeGroupExtents(lanes, laneGroups, lanePositions);

      groupHierarchy.forEach((currentGroup, index) => {
        if (currentGroup.lanes.length === 0) return;
        
        let assignedLevel = 0;
        let levelFound = false;
        
        while (!levelFound) {
          let hasCollision = false;
          
          for (let otherGroup of groupHierarchy.slice(0, index)) {
            if (otherGroup.level === assignedLevel && otherGroup.lanes.length > 0) {
              const currentLeft = currentGroup.leftmostX;
              const currentRight = currentGroup.rightmostX;
              const otherLeft = otherGroup.leftmostX;
              const otherRight = otherGroup.rightmostX;
              
              const buffer = 50;
              const overlap = !(currentRight + buffer < otherLeft || 
                               otherRight + buffer < currentLeft);
              
              if (overlap) {
                hasCollision = true;
                break;
              }
            }
          }
          
          if (!hasCollision) {
            currentGroup.level = assignedLevel;
            levelFound = true;
          } else {
            assignedLevel++;
          }
        }
      });
      
      laneGroupLevels = Math.max(...groupHierarchy.map(g => g.level)) + 1;
    }
    
    // Vertical layout. laneGroupPitch is the per-level band height; it's shared
    // with the lane-group drawing below so labels/brackets stay aligned. The
    // title↔group and group↔lane gaps give the bracket label room to breathe
    // (it must clear both the title above and the lane labels below).
    // Title and group labels may use '|' for line breaks; reserve extra vertical
    // room so the multi-line versions push content down / clear the level above
    // rather than overlapping it. (#12)
    const titleText = input.title || "Enhanced Transaction Graph";
    const titleLines = String(titleText).split('|');
    const titleLineHeight = textCfg.title.size * 1.2;
    const titleHeight = 40 + (titleLines.length - 1) * titleLineHeight;

    const groupLabelLineHeight = textCfg.laneGroup.size * 1.2;
    const maxGroupLabelLines = groupHierarchy.length
      ? Math.max(...groupHierarchy.map(g => String(g.label || '').split('|').length))
      : 1;
    const laneGroupPitch = 34 + (maxGroupLabelLines - 1) * groupLabelLineHeight;
    const laneGroupHeight = laneGroupLevels * laneGroupPitch;
    const spaceBetweenTitleAndGroups = 24;
    // Multi-line lane labels stack upward from just above the lifelines; widen
    // the groups↔lanes gap so the tallest one clears the brackets/title. (#11)
    const laneLabelLineHeight = textCfg.lane.size * 1.2;
    const maxLaneLabelLines = lanes.length
      ? Math.max(...lanes.map(l => String(parseLaneNameOffset(l).cleanLane).split('|').length))
      : 1;
    const spaceBetweenGroupsAndLanes = Math.max(38, maxLaneLabelLines * laneLabelLineHeight + 14);

    const laneTop = titleHeight + spaceBetweenTitleAndGroups + laneGroupHeight + spaceBetweenGroupsAndLanes;
    
    const bottomPadding = 30;
    let svgHeight = laneTop + lifelineBottom * timeStep + bottomPadding;

    // Track the real vertical extent of drawn content so the canvas can grow to
    // contain anything that spills past the computed height/top — e.g. an info
    // box dragged far down (or up). Seeded with the runway bottom. (#1)
    let contentBottom = laneTop + lifelineBottom * timeStep;
    let contentTop = 0;

    const lifelineEndY = laneTop + lifelineBottom * timeStep;

    function laneLabelMeta(lane) {
      const { cleanLane } = parseLaneNameOffset(lane);
      const parts = cleanLane.split('.');
      const isSubLane = parts.length === 2 && (mainLanes.has(parts[0]) || mainLanes.has(parts[1]));
      const isSpecialLane = cleanLane.startsWith('_') && cleanLane.endsWith('_');
      const fontSize = isSubLane ? textCfg.subLane.size : textCfg.lane.size;
      const lineHeight = fontSize * 1.2;
      const lines = String(cleanLane).split('|');
      return { cleanLane, isSubLane, isSpecialLane, fontSize, lineHeight, lines };
    }

    function appendLaneLabel(x, y, lines, lineHeight, className, attrs, parent) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", x);
      text.setAttribute("y", y);
      text.setAttribute("class", className);
      Object.keys(attrs || {}).forEach(key => text.setAttribute(key, attrs[key]));
      lines.forEach((ln, i) => {
        const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        tspan.setAttribute("x", x);
        tspan.setAttribute("dy", i === 0 ? 0 : lineHeight);
        tspan.textContent = ln;
        text.appendChild(tspan);
      });
      (parent || tempSvg).appendChild(text);
      return text;
    }

    // A repeated lane label, drawn on top of the diagram. It uses a "word-art"
    // outline (a contrasting halo via .lane-label-repeat, paint-order:stroke) so
    // it stays legible over messages/states AND reads as visually distinct from
    // the diagram's own message/state text — no opaque box needed. The group is
    // faded by the configurable opacity. Non-interactive (no data-kind), so the
    // graphical editor ignores it. (repeat-lane-labels)
    function appendRepeatLaneLabel(x, y, meta, className, opacity, style) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "lane-label-repeat " + (style || "outline"));
      g.setAttribute("aria-hidden", "true");
      if (opacity != null) g.setAttribute("opacity", opacity);
      tempSvg.appendChild(g);
      appendLaneLabel(x, y, meta.lines, meta.lineHeight, className, { "aria-hidden": "true" }, g);
      return g;
    }

    // Draw lanes
    lanes.forEach((lane, laneIndex) => {
      const x = lanePositions[lane];
      const meta = laneLabelMeta(lane);

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x);
      line.setAttribute("y1", laneTop);
      line.setAttribute("x2", x);
      line.setAttribute("y2", lifelineEndY);

      line.setAttribute("stroke", meta.isSubLane ? "#666" :  meta.isSpecialLane ? "LightGray" : "#333");
      line.setAttribute("stroke-width", meta.isSubLane ? "2" :  meta.isSpecialLane ? "16" :"3");
      // Editor identity tags (inert; used only by editor.js, ignored by the engine/extension).
      line.setAttribute("data-kind", "lane");
      line.setAttribute("data-index", laneIndex);
      line.setAttribute("data-role", "line");
      tempSvg.appendChild(line);

      // Fill comes from the (configurable) .lane-label / .sub-lane-label CSS.
      // Lane names may use '|' for line breaks; stack the top labels upward so the
      // bottom line keeps its usual position just above the lifeline. (#11)
      appendLaneLabel(
        x,
        laneTop - 10 - (meta.lines.length - 1) * meta.lineHeight,
        meta.lines,
        meta.lineHeight,
        meta.isSubLane ? "sub-lane-label" : "lane-label",
        { "data-kind": "lane", "data-index": laneIndex, "data-role": "label" }
      );
    });

    // Draw Lane Groups
    if (groupHierarchy.length > 0) {
      groupHierarchy.forEach((group, groupIndex) => {
        if (group.lanes.length === 0) return;

        // Use the original lane string (with prefix) for lanePositions
        const groupPositions = group.lanes
          .map(laneName => {
            // Find the original lane string in lanes array that matches this group lane (ignoring prefix)
            const laneKey = lanes.find(l => {
              const { cleanLane } = parseLaneNameOffset(l);
              return cleanLane === laneName;
            });
            return lanePositions[laneKey];
          })
          .filter(pos => pos !== undefined);
        if (groupPositions.length === 0) return;

        const leftmostX = Math.min(...groupPositions);
        const rightmostX = Math.max(...groupPositions);
        const centerX = (leftmostX + rightmostX) / 2;

        const levelFromBottom = laneGroupLevels - 1 - group.level;
        const groupLabelY = laneTop - spaceBetweenGroupsAndLanes - (levelFromBottom * laneGroupPitch) - 20;
        const bracketY = laneTop - spaceBetweenGroupsAndLanes - (levelFromBottom * laneGroupPitch);
        const bracketHeight = 15;

        const groupLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        groupLabel.setAttribute("x", centerX);
        groupLabel.setAttribute("class", "lane-group-label");
        groupLabel.setAttribute("data-kind", "laneGroup");
        groupLabel.setAttribute("data-index", groupIndex);
        groupLabel.setAttribute("data-role", "label");
        // Group labels may use '|' for line breaks; stack upward so the bottom
        // line keeps its usual spot just above the bracket. (#12)
        const groupLabelLines = String(group.label).split('|');
        groupLabel.setAttribute("y", groupLabelY - (groupLabelLines.length - 1) * groupLabelLineHeight);
        groupLabelLines.forEach((ln, i) => {
          const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          tspan.setAttribute("x", centerX);
          tspan.setAttribute("dy", i === 0 ? 0 : groupLabelLineHeight);
          tspan.textContent = ln;
          groupLabel.appendChild(tspan);
        });
        tempSvg.appendChild(groupLabel);

        const bracket = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const bracketWidth = rightmostX - leftmostX;
        const bracketPath = `
          M ${leftmostX} ${bracketY}
          L ${leftmostX} ${bracketY - bracketHeight/2}
          L ${leftmostX + bracketWidth/2 - 10} ${bracketY - bracketHeight/2}
          L ${leftmostX + bracketWidth/2} ${bracketY - bracketHeight}
          L ${leftmostX + bracketWidth/2 + 10} ${bracketY - bracketHeight/2}
          L ${rightmostX} ${bracketY - bracketHeight/2}
          L ${rightmostX} ${bracketY}
        `;
        bracket.setAttribute("d", bracketPath);
        bracket.setAttribute("class", "lane-group-bracket");
        bracket.setAttribute("data-kind", "laneGroup");
        bracket.setAttribute("data-index", groupIndex);
        bracket.setAttribute("data-role", "bracket");

        const opacity = 1 - (group.level * 0.15);
        bracket.setAttribute("opacity", Math.max(opacity, 0.4));
        groupLabel.setAttribute("opacity", Math.max(opacity, 0.4));
        
        tempSvg.appendChild(bracket);
      });
    }

    // Interaction frames: compute each box up front (behind states/messages) so
    // its extent can grow the canvas. A frame spans from its leftmost lane (−
    // lMargin) to its rightmost lane (+ rMargin), and vertically exactly from its
    // from-time to its to-time (no vertical margin — the time axis controls that).
    // Frames referencing no known lane are skipped. (#frames)
    const frameBoxes = [];
    frames.forEach((frame, index) => {
      const xs = (frame.lanes || []).map(name => {
        const key = lanes.find(l => parseLaneNameOffset(l).cleanLane === name);
        return key != null ? lanePositions[key] : undefined;
      }).filter(x => x !== undefined);
      if (!xs.length) return;
      const { lm, rm } = frameMargins(frame);
      const leftX = Math.min(...xs), rightX = Math.max(...xs);
      const t0 = Math.min(frame.fromTime, frame.toTime), t1 = Math.max(frame.fromTime, frame.toTime);
      const x = Math.max(2, leftX - lm); // never clip off the left edge
      const w = Math.max(2, (rightX + rm) - x);
      const y = laneTop + t0 * timeStep, h = (t1 - t0) * timeStep;
      frameBoxes.push({ index, x, y, w, h, label: String(frame.label || ''), background: frame.background });
      contentBottom = Math.max(contentBottom, y + h);
      contentTop = Math.min(contentTop, y);
    });

    // The fill a message label should use so it blends with any frame
    // background(s) it sits inside — instead of an opaque white box over the
    // tint. Composites each containing frame's background at the same 0.15 wash
    // over white, in draw order: exact for one frame, correct for nested /
    // overlapping ones. Returns null over no coloured frame (keep white). Called
    // per label at render time, so moving a message or frame re-evaluates it. (#frames)
    function frameBgAt(px, py) {
      let r = 255, g = 255, b = 255, any = false;
      for (const fb of frameBoxes) {
        if (!fb.background) continue;
        if (px < fb.x || px > fb.x + fb.w || py < fb.y || py > fb.y + fb.h) continue;
        const rgb = parseCssColor(fb.background);
        if (!rgb) continue;
        const a = 0.15;
        r = rgb.r * a + r * (1 - a); g = rgb.g * a + g * (1 - a); b = rgb.b * a + b * (1 - a);
        any = true;
      }
      return any ? 'rgb(' + Math.round(r) + ', ' + Math.round(g) + ', ' + Math.round(b) + ')' : null;
    }

    // Calculate legend position
    let rightmostLaneX = 0;
    if (lanes.length > 0) {
        rightmostLaneX = Math.max(...Object.values(lanePositions));
    }
    const legendX = rightmostLaneX + laneSpacing;

    const legendWidth = legend.length > 0 ? 360 : 0;
    let framesRight = 0;
    frameBoxes.forEach(fb => { framesRight = Math.max(framesRight, fb.x + fb.w); });
    const svgWidth = Math.max(legendX + legendWidth + 20, framesRight + 20);

    tempSvg.setAttribute('width', svgWidth);
    tempSvg.setAttribute('height', svgHeight);
    tempSvg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
    tempSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    tempSvg.style.maxWidth = '100%';
    tempSvg.style.height = 'auto';

    // Add title with minimal spacing
    const titleY = 25;
    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    title.setAttribute("x", (svgWidth / 2) - 80);
    title.setAttribute("y", titleY);
    title.setAttribute("text-anchor", "middle");
    title.setAttribute("font-size", textCfg.title.size);
    title.setAttribute("font-weight", "bold");
    title.setAttribute("fill", textCfg.title.color);
    title.setAttribute("data-kind", "title");
    title.setAttribute("data-index", 0);
    // Title may use '|' for line breaks; stack downward from titleY (titleHeight
    // above reserved room for the extra lines). (#12)
    titleLines.forEach((ln, i) => {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("x", (svgWidth / 2) - 80);
      tspan.setAttribute("dy", i === 0 ? 0 : titleLineHeight);
      tspan.textContent = ln;
      title.appendChild(tspan);
    });
    tempSvg.appendChild(title);

    // Draw grid
    if (showGrid) {
      for (let t = 0; t <= lifelineBottom; t++) {
        const y = laneTop + t * timeStep;
        const gridLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        gridLine.setAttribute("x1", startX - 100);
        gridLine.setAttribute("y1", y);
        gridLine.setAttribute("x2", rightmostLaneX + 50);
        gridLine.setAttribute("y2", y);
        gridLine.setAttribute("class", "grid-line");
        tempSvg.appendChild(gridLine);

        if (showTimeLabels) {
          const timeLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
          timeLabel.setAttribute("x", startX - 120);
          timeLabel.setAttribute("y", y + 5);
          timeLabel.setAttribute("class", "time-label");
          timeLabel.textContent = `T${t}`;
          tempSvg.appendChild(timeLabel);
        }
      }
    }

    const stateGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const messageGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const infoBoxGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");

    // Function to calculate label position based on leading/trailing spaces
    function calculateLabelPosition(labelText, fromX, fromY, toX, toY) {
      const originalLabel = labelText || '';

      // Count leading '>' characters (instead of leading spaces)
      const leadingSpaces = originalLabel.length - originalLabel.replace(/^>+/, '').length;

      // Count leading '<' characters (instead of trailing spaces)
      const trailingSpaces = originalLabel.length - originalLabel.replace(/^<+/, '').length;

      // Get the cleaned label (remove leading '<' and '>' characters)
      const cleanLabel = originalLabel.replace(/^[<>]+/, '');

      // Calculate arrow properties
      const arrowLength = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
      const unitX = (toX - fromX) / arrowLength;
      const unitY = (toY - fromY) / arrowLength;
      
      // Base position (center of arrow)
      const midX = (fromX + toX) / 2;
      const midY = (fromY + toY) / 2;
      
      // Calculate offset based on spaces
      // 8 spaces = full arrow length, so 4 spaces = half arrow length
      let offsetRatio = 0; // 0 = center, -0.5 = start, +0.5 = end
      
      if (leadingSpaces > 0) {
        // Leading spaces push label towards the end of the arrow (right/down)
        offsetRatio = Math.min(leadingSpaces / 8.0, 0.4); // Cap at 0.4 to stay within arrow bounds
      } else if (trailingSpaces > 0) {
        // Trailing spaces push label towards the start of the arrow (left/up)
        offsetRatio = -Math.min(trailingSpaces / 8.0, 0.4); // Cap at -0.4 to stay within arrow bounds
      }
      
      // Apply offset
      const offsetDistance = offsetRatio * arrowLength;
      const finalX = midX + offsetDistance * unitX;
      const finalY = midY + offsetDistance * unitY;
      
      return {
        x: finalX,
        y: finalY,
        cleanLabel: cleanLabel,
        offsetRatio: offsetRatio
      };
    }

    // One arrowhead marker per color, shared by straight messages and self loops.
    function ensureArrowMarker(color) {
      const arrowId = `arrowhead-${(color || 'black').replace('#', '')}`;
      if (!tempSvg.querySelector(`#${arrowId}`)) {
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", arrowId);
        marker.setAttribute("markerWidth", "10");
        marker.setAttribute("markerHeight", "7");
        marker.setAttribute("refX", "9");
        marker.setAttribute("refY", "3.5");
        marker.setAttribute("orient", "auto");
        const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polygon.setAttribute("points", "0 0, 10 3.5, 0 7");
        polygon.setAttribute("fill", color || "black");
        marker.appendChild(polygon);
        defs.appendChild(marker);
      }
      return arrowId;
    }

    // Draw messages with space-based label positioning. Paths may be written
    // forward ('A->B') or backward ('B<-A'); same-lane paths are self messages
    // (see parsePath). (#self-message)
    messages.forEach((msg, msgIndex) => {
      const pp = parsePath(msg.path);
      if (!pp) return; // no arrow in the path: nothing sensible to draw
      // Find the original lane string (with prefix) for both from and to
      const fromLaneKey = lanes.find(l => {
        const { cleanLane } = parseLaneNameOffset(l);
        return cleanLane === pp.from;
      });
      const toLaneKey = lanes.find(l => {
        const { cleanLane } = parseLaneNameOffset(l);
        return cleanLane === pp.to;
      });
      const fromX = lanePositions[fromLaneKey] ?? startX;
      const toX = lanePositions[toLaneKey] ?? startX;
      const fromY = laneTop + msg.fromTime * timeStep;
      const toY = laneTop + msg.toTime * timeStep;

      if (pp.self) {
        // Self message: a rounded loop leaving the lane at fromTime and
        // returning at toTime — to the RIGHT for 'A->A', LEFT for 'A<-A'. The
        // bulge distance comes from options.graph.selfMessageWidth (default 45).
        const dir = pp.side === 'left' ? -1 : 1;
        const w = selfMsgWidth;
        let yb = toY;
        if (Math.abs(yb - fromY) < timeStep * 0.25) yb = fromY + timeStep * 0.25; // keep the loop readable
        const xf = fromX + dir * w;
        const rr = Math.min(8, w / 2, Math.abs(yb - fromY) / 2);
        const dPath = 'M ' + fromX + ' ' + fromY +
          ' L ' + (xf - dir * rr) + ' ' + fromY +
          ' Q ' + xf + ' ' + fromY + ' ' + xf + ' ' + (fromY + rr) +
          ' L ' + xf + ' ' + (yb - rr) +
          ' Q ' + xf + ' ' + yb + ' ' + (xf - dir * rr) + ' ' + yb +
          ' L ' + fromX + ' ' + yb;
        const loop = document.createElementNS("http://www.w3.org/2000/svg", "path");
        loop.setAttribute("d", dPath);
        loop.setAttribute("fill", "none");
        loop.setAttribute("stroke", msg.color || "black");
        loop.setAttribute("class", "arrow" + (msg.style === "dashed" ? " dashed" : ""));
        loop.setAttribute("data-kind", "message");
        loop.setAttribute("data-index", msgIndex);
        loop.setAttribute("data-role", "line");
        loop.setAttribute("marker-end", `url(#${ensureArrowMarker(msg.color)})`);
        messageGroup.appendChild(loop);

        // Label: ON the loop's far segment, like any other message label sits on
        // its line — rotated 90° to follow the (vertical) segment, with the same
        // white label-box. The rotation is FIXED (+90, reading downward, same as
        // vertical states) rather than following the arrow direction, so an
        // upward loop never renders upside down. A leading '^' flips the label
        // back to horizontal-readable. Slide markers ('>'/'<') don't apply to a
        // loop and are stripped. (#self-message)
        let selfLabel = String(msg.label || '').replace(/^[<>]+/, '');
        const flipHorizontal = selfLabel.charAt(0) === '^';
        if (flipHorizontal) selfLabel = selfLabel.slice(1);
        // Prefix the autonumber (draws even for an arrow-only self message). (#autonumber)
        if (autonumber && msgNumbers[msgIndex]) selfLabel = msgNumbers[msgIndex] + ' ' + selfLabel;
        if (selfLabel.trim()) {
          const fontSize = textCfg.message.size;
          const lines = selfLabel.split('|');
          const lineHeight = fontSize * 1.2;
          const paddingX = 6, paddingY = 4;
          const textHeight = lines.length * lineHeight;
          const midY = (fromY + yb) / 2;
          const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
          if (!flipHorizontal) group.setAttribute("transform", `rotate(90, ${xf}, ${midY})`);
          group.setAttribute("data-kind", "message");
          group.setAttribute("data-index", msgIndex);
          group.setAttribute("data-role", "label");
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", xf);
          text.setAttribute("y", midY - (textHeight - lineHeight) / 2);
          text.setAttribute("class", "message-label");
          text.setAttribute("fill", msg.color || "black");
          text.setAttribute("text-anchor", "middle");
          lines.forEach((ln, i) => {
            const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
            tspan.setAttribute("x", xf);
            tspan.setAttribute("dy", i === 0 ? 0 : lineHeight);
            tspan.textContent = ln;
            text.appendChild(tspan);
          });
          // Measured box, like the straight-message label above. (#autonumber)
          group.appendChild(text);
          tempSvg.appendChild(group);
          const tBox = text.getBBox();
          tempSvg.removeChild(group);
          const labelBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          labelBg.setAttribute("x", tBox.x - paddingX);
          labelBg.setAttribute("y", tBox.y - paddingY);
          labelBg.setAttribute("width", tBox.width + 2 * paddingX);
          labelBg.setAttribute("height", tBox.height + 2 * paddingY);
          labelBg.setAttribute("class", "label-box");
          // Blend with the frame background (inline style beats the CSS rule). (#frames)
          const selfFrameBg = frameBgAt(xf, midY);
          if (selfFrameBg) labelBg.style.fill = selfFrameBg;
          group.innerHTML = '';
          group.appendChild(labelBg);
          group.appendChild(text);
          messageGroup.appendChild(group);
        }
        return;
      }

      // Draw the message line
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", fromX);
      line.setAttribute("y1", fromY);
      line.setAttribute("x2", toX);
      line.setAttribute("y2", toY);
      line.setAttribute("stroke", msg.color || "black");
      line.setAttribute("class", "arrow" + (msg.style === "dashed" ? " dashed" : ""));
      line.setAttribute("data-kind", "message");
      line.setAttribute("data-index", msgIndex);
      line.setAttribute("data-role", "line");
      messageGroup.appendChild(line);
      line.setAttribute("marker-end", `url(#${ensureArrowMarker(msg.color)})`);

      // Calculate label position based on spaces
      const labelPosition = calculateLabelPosition(msg.label, fromX, fromY, toX, toY);
      // Prefix the autonumber; draws even for an arrow-only message. (#autonumber)
      let displayLabel = labelPosition.cleanLabel;
      if (autonumber && msgNumbers[msgIndex]) displayLabel = msgNumbers[msgIndex] + ' ' + displayLabel;

      // Only create label if there's actual text content (or a number to show)
      if (displayLabel.trim()) {
        // Calculate arrow angle for text rotation
        const dx = toX - fromX;
        const dy = toY - fromY;
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle > 90 || angle < -90) {
          angle += 180;
        }

        const fontSize = textCfg.message.size;
        const lines = displayLabel.split('|');
        const lineHeight = fontSize * 1.2;
        const paddingX = 6;
        const paddingY = 4;
        const textHeight = lines.length * lineHeight;

        // Create label group with rotation
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("transform", `rotate(${angle}, ${labelPosition.x}, ${labelPosition.y})`);
        group.setAttribute("data-kind", "message");
        group.setAttribute("data-index", msgIndex);
        group.setAttribute("data-role", "label");

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", labelPosition.x);
        text.setAttribute("y", labelPosition.y - (textHeight - lineHeight) / 2);
        text.setAttribute("class", "message-label");
        text.setAttribute("fill", msg.color || "black");
        text.setAttribute("text-anchor", "middle");

        lines.forEach((line, i) => {
          const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          tspan.setAttribute("x", labelPosition.x);
          tspan.setAttribute("dy", i === 0 ? 0 : lineHeight);
          tspan.textContent = line;
          text.appendChild(tspan);
        });

        // Size the white box from the MEASURED text (same pattern as legend
        // labels): the old char-count estimate under-measured long — and
        // autonumbered — labels, letting the arrow strike through the text.
        // getBBox is pre-transform and the box lives in the same rotated group,
        // so the rotation stays consistent. (#autonumber)
        group.appendChild(text);
        tempSvg.appendChild(group);
        const tBox = text.getBBox();
        tempSvg.removeChild(group);

        const labelBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        labelBg.setAttribute("x", tBox.x - paddingX);
        labelBg.setAttribute("y", tBox.y - paddingY);
        labelBg.setAttribute("width", tBox.width + 2 * paddingX);
        labelBg.setAttribute("height", tBox.height + 2 * paddingY);
        labelBg.setAttribute("class", "label-box");
        // Blend the label box with the frame background it sits on. Inline style
        // (not a fill attribute) so it beats the .label-box { fill: white } rule
        // — a presentation attribute would lose to the class. (#frames)
        const labelFrameBg = frameBgAt(labelPosition.x, labelPosition.y);
        if (labelFrameBg) labelBg.style.fill = labelFrameBg;

        group.innerHTML = '';
        group.appendChild(labelBg);
        group.appendChild(text);
        messageGroup.appendChild(group);
      }
    });

    // Uniform state widths (options.graph.uniformStateWidth): a first measuring
    // pass finds the widest state box per lane, so the draw loop below can widen
    // every state in that lane to match — same metrics (font, padding, floor) as
    // the loop's own sizing. (graph)
    const laneStateMaxWidth = {};
    if (uniformStateWidth && showStates) {
      const minStateBoxWidth = 50, paddingX = 6;
      states.forEach((state) => {
        // Explicit-width states (activation bars) neither widen the column nor
        // get widened by it — their width is a deliberate statement. (#activation)
        if (typeof state.width === 'number' && state.width > 0) return;
        const fontSize = textCfg.state.size;
        const lineHeight = fontSize * 1.2;
        const pl = parseStateLabel(state.label);
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", 0); t.setAttribute("class", "state-label"); t.style.fontSize = fontSize + "px";
        pl.lines.forEach((line, i) => {
          const ts = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          ts.setAttribute("x", 0); ts.setAttribute("dy", i === 0 ? 0 : lineHeight); ts.textContent = line;
          t.appendChild(ts);
        });
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(t); tempSvg.appendChild(g);
        const bb = t.getBBox();
        // A vertical ('^') label occupies its measured HEIGHT across the lane.
        const w = Math.max(minStateBoxWidth, (pl.vertical ? bb.height : bb.width) + 2 * paddingX);
        tempSvg.removeChild(g);
        laneStateMaxWidth[state.lane] = Math.max(laneStateMaxWidth[state.lane] || 0, w);
      });
    }

    // Draw states. Longer-duration states first, so a state fully inside
    // another on the same lane (a sub-state / nested activation bar) renders on
    // top of its container and stays visible. data-index keeps the model order,
    // so the editor is unaffected by the draw order. (#activation)
    const stateDur = (s) => Math.abs(((s.toTime != null) ? s.toTime : s.fromTime) - s.fromTime);
    states.map((s, i) => i).sort((a, b) => stateDur(states[b]) - stateDur(states[a])).forEach((stateIndex) => {
      const state = states[stateIndex];
      if (!showStates) return;
      // Find the original lane string (with prefix) for this state
      const laneKey = lanes.find(l => {
        const { cleanLane } = parseLaneNameOffset(l);
        return cleanLane === state.lane;
      });
      const laneX = lanePositions[laneKey] ?? startX;
      const fromY = laneTop + state.fromTime * timeStep;
      const toY = laneTop + state.toTime * timeStep;

      function getPastelColor(color) {
        const colorMap = {
          'red': '#ffcccc',
          'blue': '#ccccff',
          'green': '#ccffcc',
          'yellow': '#ffffcc',
          'purple': '#ffccff',
          'orange': '#ffddcc',
          'cyan': '#ccffff',
          'pink': '#ffccdd'
        };
        if (!color) return '#ffffcc';
        const key = String(color).toLowerCase().trim();
        if (colorMap[key]) return colorMap[key];
        // Any other valid CSS color (named or hex): tint toward white so it reads
        // as a soft state background, consistent with the built-in pastels above.
        // Falls back to the default yellow only for genuinely invalid input. (#10)
        const rgb = parseCssColor(color);
        if (!rgb) return '#ffffcc';
        const tint = (c) => Math.round(c + (255 - c) * 0.72);
        return `rgb(${tint(rgb.r)}, ${tint(rgb.g)}, ${tint(rgb.b)})`;
      }
      
      const stateSubGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      stateSubGroup.setAttribute("data-kind", "state");
      stateSubGroup.setAttribute("data-index", stateIndex);
      const stateFontSize = textCfg.state.size;
      const pLabel = parseStateLabel(state.label); // '^' prefix = vertical text (#activation)
      const stateLines = pLabel.lines;
      const stateLineHeight = stateFontSize * 1.2;

      const stateText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const provisionalTextY = fromY + 8 + stateLineHeight / 2; // measured here, repositioned below
      stateText.setAttribute("x", laneX);
      stateText.setAttribute("y", provisionalTextY);
      stateText.setAttribute("class", "state-label");
      // Inline style (not attribute) so it wins over any document .state-label
      // rule and getBBox measures the scaled size correctly.
      stateText.style.fontSize = stateFontSize + "px";

      stateLines.forEach((line, i) => {
        const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        tspan.setAttribute("x", laneX);
        tspan.setAttribute("dy", i === 0 ? 0 : stateLineHeight);
        tspan.textContent = line;
        stateText.appendChild(tspan);
      });

      stateSubGroup.appendChild(stateText);
      tempSvg.appendChild(stateSubGroup);
      const stateBbox = stateText.getBBox();
      tempSvg.removeChild(stateSubGroup);

      const minStateBoxWidth = 50;
      const paddingX = 6;
      // Text footprint on each axis — a vertical ('^') label swaps the measured
      // box, so a thin bar fits the text height across the lane. (#activation)
      const textW = pLabel.vertical ? stateBbox.height : stateBbox.width;
      const textH = pLabel.vertical ? stateBbox.width : stateBbox.height;
      // Always size to the measured text (+ padding) so it never overflows the
      // box; keep minStateBoxWidth only as a floor so short labels still get a
      // reasonably sized box — vertical labels skip the floor (thin is their
      // point). (A small character count can still be wide — large fonts or wide
      // glyphs — so we must not key off line length.)
      let stateBoxWidth = Math.max(pLabel.vertical ? 0 : minStateBoxWidth, textW + 2 * paddingX);
      // An explicit `width` (activation-style bar) beats auto AND uniform sizing;
      // otherwise widen to the lane's widest state when uniform widths are on
      // (centered on the lifeline, so the boxes align as a column). (graph)
      if (typeof state.width === 'number' && state.width > 0) stateBoxWidth = state.width;
      else if (uniformStateWidth && laneStateMaxWidth[state.lane]) stateBoxWidth = laneStateMaxWidth[state.lane];

      const stateBoxX = laneX - (stateBoxWidth / 2);
      
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", stateBoxX);
      rect.setAttribute("width", stateBoxWidth);
      
      // Vertical placement. The rect is sized to the time span but never smaller
      // than the measured text (+ padding); when it must grow, it grows evenly
      // around the span. The text is then centered in the FINAL rect by shifting
      // its measured bbox — exact for any font size and line count, replacing the
      // old fixed-offset math that was tuned for the 11px default and drifted the
      // letters past the box edges at larger sizes. (#state-text-metrics)
      const statePadY = 4;
      let rectY, rectH;
      if (state.fromTime === state.toTime) {
        rectY = laneTop + state.fromTime * timeStep;
        rectH = textH + 2 * statePadY;
      } else {
        const fromGridY = laneTop + state.fromTime * timeStep;
        const toGridY = laneTop + state.toTime * timeStep;
        const boxTop = Math.min(fromGridY, toGridY);
        const boxHeight = Math.abs(toGridY - fromGridY);
        rectH = Math.max(boxHeight, textH + 2 * statePadY);
        rectY = boxTop - (rectH > boxHeight ? (rectH - boxHeight) / 2 : 0);
      }
      rect.setAttribute("y", rectY);
      rect.setAttribute("height", rectH);
      // Center the text block on the rect center via its measured bbox (exact for
      // any font size / line count), then rotate a vertical label 90° about that
      // center — getBBox is pre-transform, so center-then-rotate stays centered.
      // +90 so the text reads DOWNWARD (top-to-bottom), following the time axis.
      const rectCenterY = rectY + rectH / 2;
      const stateTextTop = rectCenterY - stateBbox.height / 2;
      stateText.setAttribute("y", provisionalTextY + (stateTextTop - stateBbox.y));
      if (pLabel.vertical) stateText.setAttribute("transform", "rotate(90 " + laneX + " " + rectCenterY + ")");
      
      rect.setAttribute("fill", getPastelColor(state.color || 'yellow'));
      rect.setAttribute("stroke", "#aaa");
      rect.setAttribute("stroke-width", "1");
      rect.setAttribute("rx", "4");
      rect.setAttribute("ry", "4");

      stateSubGroup.innerHTML = '';
      stateSubGroup.appendChild(rect);
      // No <text> node for an empty label: an empty SVG text still exposes a
      // zero-size client rect at its anchor — and with nothing to measure, the
      // bbox-shift placement above puts that anchor at a stray position, which
      // ballooned the editor's hover/selection box and the measure-path bboxes.
      if (stateLines.some((ln) => ln !== '')) stateSubGroup.appendChild(stateText);
      stateGroup.appendChild(stateSubGroup);
    });

    // Draw info boxes with quadrant-based placement
    if (infoBoxes.length > 0) {
      infoBoxes.forEach((info, index) => {
        // Find the original lane string (with prefix) for this info box
        const laneKey = lanes.find(l => {
          const { cleanLane } = parseLaneNameOffset(l);
          return cleanLane === info.lane;
        });
        const laneX = lanePositions[laneKey];
        if (laneX === undefined) return;
        
        const anchorY = laneTop + info.time * timeStep;
        let actualText = info.text || '';
        let xOffset = 50; // default horizontal right
        let yOffset = -50; // default diagonal upper right
        
        // Parse <x,y> offset notation from the start of text
        const offsetRegex = /^<(-?\d+),(-?\d+)>(.*)$/;
        const offsetMatch = actualText.match(offsetRegex);
        if (offsetMatch) {
          xOffset = parseInt(offsetMatch[1], 10);
          yOffset = parseInt(offsetMatch[2], 10);
          actualText = offsetMatch[3];
        }
        
        const lines = actualText.split('|');
        const fontSize = textCfg.info.size;
        const lineHeight = fontSize * 1.2;
        const padding = 8;
        
        const tempText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        tempText.setAttribute("font-size", fontSize);
        tempText.setAttribute("font-family", "'Segoe UI', sans-serif");
        tempText.style.visibility = "hidden";
        
        lines.forEach((line, i) => {
          const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          tspan.setAttribute("x", 0);
          tspan.setAttribute("dy", i === 0 ? 0 : lineHeight);
          tspan.textContent = line;
          tempText.appendChild(tspan);
        });
        
        tempSvg.appendChild(tempText);
        const bbox = tempText.getBBox();
        tempSvg.removeChild(tempText);
        
        const boxWidth = Math.max(bbox.width + 2 * padding, 80);
        const boxHeight = bbox.height + 2 * padding;
        
        // Use parsed offsets (no quadrant-based placement anymore)
        const boxX = laneX + xOffset - boxWidth / 2;
        const boxY = anchorY + yOffset - boxHeight / 2;

        // Record this box's extent so the canvas can grow to contain it. (#1)
        contentBottom = Math.max(contentBottom, boxY + boxHeight);
        contentTop = Math.min(contentTop, boxY);

        // The tether (leader line) is drawn BEFORE the box, so with `tether:
        // false` it's skipped and, being under the box anyway, a routed line
        // would sit behind it. PlantUML notes have no leader. (#infobox-tether)
        if (info.tether !== false) {
          const connectLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          connectLine.setAttribute("x1", laneX);
          connectLine.setAttribute("y1", anchorY);
          connectLine.setAttribute("x2", boxX + (boxX > laneX ? 0 : boxWidth));
          connectLine.setAttribute("y2", boxY + boxHeight/2);
          connectLine.setAttribute("class", "info-box-line");
          infoBoxGroup.appendChild(connectLine);
        }

        const infoBox = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        infoBox.setAttribute("x", boxX);
        infoBox.setAttribute("y", boxY);
        infoBox.setAttribute("width", boxWidth);
        infoBox.setAttribute("height", boxHeight);
        infoBox.setAttribute("class", "info-box");
        // Optional solid background fill (e.g. yellow, to match PlantUML notes).
        // Inline style beats the .info-box { fill: white } CSS rule. (#infobox-bg)
        if (info.background) infoBox.style.fill = info.background;
        infoBox.setAttribute("data-kind", "infoBox");
        infoBox.setAttribute("data-index", index);
        infoBox.setAttribute("data-role", "box");
        infoBoxGroup.appendChild(infoBox);

        const infoText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        infoText.setAttribute("x", boxX + padding);
        infoText.setAttribute("y", boxY + padding + fontSize);
        infoText.setAttribute("class", "info-box-text");
        infoText.setAttribute("font-size", fontSize);
        infoText.setAttribute("data-kind", "infoBox");
        infoText.setAttribute("data-index", index);
        infoText.setAttribute("data-role", "label");
        
        lines.forEach((line, i) => {
          const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          tspan.setAttribute("x", boxX + padding);
          tspan.setAttribute("dy", i === 0 ? 0 : lineHeight);
          tspan.textContent = line;
          infoText.appendChild(tspan);
        });
        
        infoBoxGroup.appendChild(infoText);
      });
    }

    // Draw interaction frames behind states/messages (background scoping). Each
    // is a bordered box with a cut-corner label tab at the top-left. Tagged so
    // the editor can select/drag/stretch them; inert for the headless engine. (#frames)
    // The label tabs are collected separately and drawn AFTER the messages, so a
    // message that runs near a frame's top edge never obscures its label. (#frames)
    const frameTabGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    if (frameBoxes.length > 0) {
      const frameGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const frameFont = textCfg.frame.size;
      frameBoxes.forEach((fb) => {
        // Optional background: draw as a separate filled rect UNDER the border,
        // at a low opacity so it reads as a wash and never hides content. The
        // border box itself stays fill:none so its interior isn't a click target.
        if (fb.background) {
          const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          bg.setAttribute("x", fb.x); bg.setAttribute("y", fb.y);
          bg.setAttribute("width", fb.w); bg.setAttribute("height", fb.h);
          bg.setAttribute("rx", "2"); bg.setAttribute("ry", "2");
          bg.setAttribute("fill", fb.background);
          bg.setAttribute("fill-opacity", "0.15");
          bg.setAttribute("stroke", "none");
          frameGroup.appendChild(bg);
        }
        const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        box.setAttribute("x", fb.x); box.setAttribute("y", fb.y);
        box.setAttribute("width", fb.w); box.setAttribute("height", fb.h);
        box.setAttribute("rx", "2"); box.setAttribute("ry", "2");
        box.setAttribute("class", "frame-box");
        box.setAttribute("data-kind", "frame");
        box.setAttribute("data-index", fb.index);
        box.setAttribute("data-role", "box");
        frameGroup.appendChild(box);

        if (fb.label) {
          // The tab label may use '|' for line breaks; the tab grows to fit the
          // widest line and the total height. (#frames)
          const cut = 8, padX = 7, padY = 4;
          const labelLines = String(fb.label).split('|');
          const lineHeight = frameFont * 1.2;
          const maxLen = Math.max(...labelLines.map(l => l.length));
          const tabW = Math.max(maxLen * frameFont * 0.62, 24) + 2 * padX;
          const tabH = labelLines.length * lineHeight + 2 * padY;
          const tab = document.createElementNS("http://www.w3.org/2000/svg", "path");
          tab.setAttribute("d",
            'M ' + fb.x + ' ' + fb.y +
            ' L ' + (fb.x + tabW) + ' ' + fb.y +
            ' L ' + (fb.x + tabW) + ' ' + (fb.y + tabH - cut) +
            ' L ' + (fb.x + tabW - cut) + ' ' + (fb.y + tabH) +
            ' L ' + fb.x + ' ' + (fb.y + tabH) + ' Z');
          tab.setAttribute("class", "frame-tab");
          tab.setAttribute("data-kind", "frame");
          tab.setAttribute("data-index", fb.index);
          tab.setAttribute("data-role", "tab");
          frameTabGroup.appendChild(tab);

          const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
          label.setAttribute("x", fb.x + padX);
          label.setAttribute("y", fb.y + padY + frameFont);
          label.setAttribute("class", "frame-label");
          label.setAttribute("data-kind", "frame");
          label.setAttribute("data-index", fb.index);
          label.setAttribute("data-role", "label");
          labelLines.forEach((ln, i) => {
            const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
            tspan.setAttribute("x", fb.x + padX);
            tspan.setAttribute("dy", i === 0 ? 0 : lineHeight);
            tspan.textContent = ln;
            label.appendChild(tspan);
          });
          frameTabGroup.appendChild(label);
        }
      });
      tempSvg.appendChild(frameGroup);
    }

    tempSvg.appendChild(stateGroup);
    tempSvg.appendChild(messageGroup);
    tempSvg.appendChild(infoBoxGroup);
    tempSvg.appendChild(frameTabGroup); // frame labels on top, so messages never hide them

    // Draw legend (unchanged from original)
    if (legend.length > 0) {
      const legendY = laneTop;
      const legendItemHeight = 67;
      const legendPadding = 20;
      const arrowLength = 300;
      
      const arrowMargin = 20;
      const arrowStartX = legendX + arrowMargin;
      
      const legendBox = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      legendBox.setAttribute("x", legendX);
      legendBox.setAttribute("y", legendY - 30);
      legendBox.setAttribute("width", arrowLength + 2 * arrowMargin);
      legendBox.setAttribute("height", legend.length * legendItemHeight + 50);
      legendBox.setAttribute("class", "legend-box");
      // Editor identity tags so the legend can be selected/deleted as a whole
      // (inert for the engine/extension; used only by editor.js).
      legendBox.setAttribute("data-kind", "legendBox");
      legendBox.setAttribute("data-index", 0);
      legendBox.setAttribute("data-role", "box");
      tempSvg.appendChild(legendBox);

      const legendTitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
      legendTitle.setAttribute("x", legendX + (arrowLength + 2 * arrowMargin) / 2);
      legendTitle.setAttribute("y", legendY - 40);
      legendTitle.setAttribute("text-anchor", "middle");
      legendTitle.setAttribute("class", "legend-title");
      legendTitle.setAttribute("data-kind", "legendBox");
      legendTitle.setAttribute("data-index", 0);
      legendTitle.setAttribute("data-role", "title");
      legendTitle.setAttribute("font-size", textCfg.legendTitle.size);
      legendTitle.textContent = "Legend";
      tempSvg.appendChild(legendTitle);
      
      legend.forEach((item, index) => {
        // Calculate position for legend item labels using the same space-based system
        const labelPosition = calculateLabelPosition(item.label, arrowStartX, legendY + 30 + index * legendItemHeight, arrowStartX + arrowLength, legendY + 30 + index * legendItemHeight);
        
        const itemY = legendY + 30 + index * legendItemHeight;
        
        const arrow = document.createElementNS("http://www.w3.org/2000/svg", "line");
        arrow.setAttribute("x1", arrowStartX);
        arrow.setAttribute("y1", itemY);
        arrow.setAttribute("x2", arrowStartX + arrowLength);
        arrow.setAttribute("y2", itemY);
        arrow.setAttribute("stroke", item.color || "black");
        arrow.setAttribute("class", "arrow" + (item.style === "dashed" ? " dashed" : ""));
        arrow.setAttribute("data-kind", "legend");
        arrow.setAttribute("data-index", index);
        arrow.setAttribute("data-role", "line");

        const arrowId = `legend-arrowhead-${index}-${(item.color || 'black').replace('#', '')}`;
        if (!tempSvg.querySelector(`#${arrowId}`)) {
          const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
          marker.setAttribute("id", arrowId);
          marker.setAttribute("markerWidth", "10");
          marker.setAttribute("markerHeight", "7");
          marker.setAttribute("refX", "9");
          marker.setAttribute("refY", "3.5");
          marker.setAttribute("orient", "auto");
          const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          polygon.setAttribute("points", "0 0, 10 3.5, 0 7");
          polygon.setAttribute("fill", item.color || "black");
          marker.appendChild(polygon);
          defs.appendChild(marker);
        }
        arrow.setAttribute("marker-end", `url(#${arrowId})`);
        tempSvg.appendChild(arrow);
        
        // Only create legend label if there's actual text content
        if (labelPosition.cleanLabel) {
          const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
          group.setAttribute("data-kind", "legend");
          group.setAttribute("data-index", index);
          group.setAttribute("data-role", "label");

          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          const fontSize = textCfg.legend.size;
          const lines = labelPosition.cleanLabel.split('|');
          const lineHeight = fontSize * 1.2;
          const paddingX = 6;
          const paddingY = 4;
          const textHeight = lines.length * lineHeight;
          
          const textYPosition = labelPosition.y - (textHeight - lineHeight) / 2;

          text.setAttribute("x", labelPosition.x);
          text.setAttribute("y", textYPosition);
          text.setAttribute("class", "legend-label");
          // Inline style so getBBox measures the scaled size regardless of CSS.
          text.style.fontSize = fontSize + "px";
          text.setAttribute("fill", item.color || "black");
          text.setAttribute("text-anchor", "middle");
          
          lines.forEach((line, i) => {
            const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
            tspan.setAttribute("x", labelPosition.x);
            tspan.setAttribute("dy", i === 0 ? 0 : lineHeight);
            tspan.textContent = line;
            text.appendChild(tspan);
          });
          
          group.appendChild(text);
          tempSvg.appendChild(group);
          const bbox = text.getBBox();
          tempSvg.removeChild(group);
          
          const labelBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          labelBg.setAttribute("x", bbox.x - paddingX);
          labelBg.setAttribute("y", bbox.y - paddingY);
          labelBg.setAttribute("width", bbox.width + 2 * paddingX);
          labelBg.setAttribute("height", bbox.height + 2 * paddingY);
          labelBg.setAttribute("class", "label-box");
          
          group.innerHTML = '';
          group.appendChild(labelBg);
          group.appendChild(text);
          tempSvg.appendChild(group);
        }
      });
    }

    // Repeated lane labels (opt-in: options.repeatLaneLabels). Drawn here — AFTER
    // all messages/states/info/legend — so they sit on top and stay legible
    // instead of being buried. A plain label sits below each lifeline; faint
    // chipped repeats mark it at a fixed interval down the page. Purely visual
    // (no data-kind), and fully deterministic, so the editor matches exportSVG and
    // any external renderer. (repeat-lane-labels)
    if (repeatLaneLabels) {
      lanes.forEach((lane) => {
        const x = lanePositions[lane];
        const meta = laneLabelMeta(lane);
        const cls = meta.isSubLane ? "sub-lane-label" : "lane-label";
        // bottom label under the lifeline
        appendRepeatLaneLabel(x, lifelineEndY + meta.lineHeight, meta, cls, repeatLabelOpacity, labelStyle);
        contentBottom = Math.max(contentBottom, lifelineEndY + meta.lineHeight * meta.lines.length + 10);
        // mid-lifeline repeats every `laneLabelInterval` TIME units
        for (let t = laneLabelInterval; t < lifelineBottom; t += laneLabelInterval) {
          appendRepeatLaneLabel(x, laneTop + t * timeStep, meta, cls, repeatLabelOpacity, labelStyle);
        }
      });
    }

    // Grow the canvas to contain any content that overflowed the initial height
    // or rose above the top (e.g. an info box dragged well below/above its
    // anchor), so nothing is clipped. Pad by bottomPadding on the spilling side.
    // The width is unchanged — only vertical overflow is in scope here. (#1)
    const finalTop = contentTop < 0 ? contentTop - bottomPadding : 0;
    const finalBottom = Math.max(svgHeight, contentBottom + bottomPadding);
    const finalHeight = finalBottom - finalTop;
    tempSvg.setAttribute('height', finalHeight);
    tempSvg.setAttribute('viewBox', `0 ${finalTop} ${svgWidth} ${finalHeight}`);

    // Layout metadata for the editor (and the measure path) to map pixels back
    // to model values. Inert for headless renders; never affects the SVG.
    const layout = {
      laneTop: laneTop,
      timeStep: timeStep,
      startX: startX,
      laneSpacing: laneSpacing,
      maxTime: maxTime,
      lanes: lanes.map((laneStr, i) => ({
        index: i,
        key: laneStr,
        clean: parseLaneNameOffset(laneStr).cleanLane,
        x: lanePositions[laneStr],
      })),
    };

    if (measureOnly) {
      // Off-screen measurement: every tagged element's bounding box in diagram
      // units (with its role), for the editor's collision detection. Then discard.
      const boxes = [];
      tempSvg.querySelectorAll('[data-kind][data-index]').forEach((el) => {
        let b; try { b = el.getBBox(); } catch (err) { return; }
        if (!b || (!b.width && !b.height)) return;
        boxes.push({
          kind: el.getAttribute('data-kind'),
          index: parseInt(el.getAttribute('data-index'), 10),
          role: el.getAttribute('data-role') || null,
          x: b.x, y: b.y, w: b.width, h: b.height,
        });
      });
      document.body.removeChild(tempSvg);
      return { layout: layout, boxes: boxes };
    }

    const exportedSvg = exportSVG(false, tempSvg);
    svgContainer.innerHTML = exportedSvg;
    document.body.removeChild(tempSvg);
    if (typeof window !== 'undefined') window.flowdromLayout = layout;

  } catch (e) {
    if (tempSvg && tempSvg.parentNode) document.body.removeChild(tempSvg);
    if (measureOnly) throw e; // let the caller (auto-arrange) handle a bad candidate
    console.error("Error parsing JSON: " + e.message);
    svgContainer.innerHTML = `<div style="color: red; padding: 20px;">Error parsing JSON: ${e.message}. Please check your input.</div>`;
  }
}

// Off-screen measurement API for the editor's auto-arrange: render a candidate
// model and get back { layout, boxes } without disturbing the live view. Uses the
// internal (un-hooked) renderGraph binding, so the editor's render hook (overlay
// rebuild, zoom, etc.) does not fire for a measurement. (auto-arrange)
if (typeof window !== 'undefined') {
  window.flowdromMeasure = function (model) { return renderGraph(model, true); };
}

function exportSVG(download = true, svgElement = null) {
  const svg = svgElement || document.querySelector('#svg-container svg');
  if (!svg) {
    console.error("No SVG element found");
    return;
  }

  let svgData = new XMLSerializer().serializeToString(svg);
  const jsonInput = document.getElementById('input').value;

  let formattedJson;
  try {
    formattedJson = JSON5.stringify(JSON5.parse(jsonInput), null, 2);
  } catch (e) {
    formattedJson = jsonInput;
  }

  const escapedJson = formattedJson.replace(/--/g, '\\-\\-');
  const cssStyles = buildDiagramCss(getDisplayOptions());

  svgData = svgData.replace(/(<svg[^>]*>)/, `$1<style>${cssStyles}</style>`);
  
  // Add responsive attributes to exported SVG
  svgData = svgData.replace(/(<svg[^>]*?)>/, (match, svgTag) => {
    if (!svgTag.includes('viewBox')) {
      const widthMatch = svgTag.match(/width="([^"]*)"/);
      const heightMatch = svgTag.match(/height="([^"]*)"/);
      if (widthMatch && heightMatch) {
        const width = widthMatch[1];
        const height = heightMatch[1];
        svgTag += ` viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="max-width: 100%; height: auto;"`;
      }
    }
    return svgTag + '>';
  });
  const svgHeader = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!-- Original JSON Input:\n${escapedJson}\n-->\n`;
  const fullSvgData = svgHeader + svgData;

  if (download) {
    const blob = new Blob([fullSvgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =  `${((JSON5.parse(document.getElementById('input').value)).title?.trim() || 'transaction-graph').replace(/\s+/g, '-').replace(/[:/\\*?"<>|]/g, '-')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    return fullSvgData;
  }
}

function exportPNG() {
  const svg = document.querySelector('#svg-container svg');
  if (!svg) {
    alert("Please render the graph first before exporting to PNG.");
    return;
  }

  try {
    const svgRect = svg.getBoundingClientRect();
    const svgWidth = svg.getAttribute('width') || svgRect.width;
    const svgHeight = svg.getAttribute('height') || svgRect.height;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const scale = 2;
    canvas.width = svgWidth * scale;
    canvas.height = svgHeight * scale;
    
    ctx.scale(scale, scale);
    
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, svgWidth, svgHeight);

    const svgData = new XMLSerializer().serializeToString(svg);

    const cssStyles = buildDiagramCss(getDisplayOptions());

    const styledSvgData = svgData.replace(/(<svg[^>]*>)/, `$1<style>${cssStyles}</style>`);
    
    const blob = new Blob([styledSvgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    const img = new Image();
    img.onload = function() {
      ctx.drawImage(img, 0, 0, svgWidth, svgHeight);
      
      canvas.toBlob(function(pngBlob) {
        const pngUrl = URL.createObjectURL(pngBlob);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `${((JSON5.parse(document.getElementById('input').value)).title?.trim() || 'transaction-graph').replace(/\s+/g, '-').replace(/[:/\\*?"<>|]/g, '-')}.png`;
        a.click();
        URL.revokeObjectURL(url);
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };
    
    img.onerror = function() {
      alert("Error converting SVG to PNG. This might be due to browser security restrictions.");
      URL.revokeObjectURL(url);
    };
    
    img.src = url;
    
  } catch (error) {
    console.error("PNG export error:", error);
    alert("Error exporting PNG. Please try again or use SVG export instead.");
  }
}

function loadSVGFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      // Normalize CRLF/CR to LF: git's autocrlf (or mail/zip round-trips) may
      // have rewritten the file's line endings, and the marker search below
      // depends on exact \n. JSON5 content is unaffected by this.
      const svgContent = e.target.result.replace(/\r\n?/g, '\n');

      const startMarker = "<!-- Original JSON Input:\n";
      const endMarker = "\n-->";
      
      const startIndex = svgContent.indexOf(startMarker);
      if (startIndex === -1) {
        alert("Error: This SVG file doesn't contain the expected JSON configuration. Please make sure it was exported from this application.");
        return;
      }
      
      const jsonStart = startIndex + startMarker.length;
      const endIndex = svgContent.indexOf(endMarker, jsonStart);
      
      if (endIndex === -1) {
        alert("Error: Could not find the end of the JSON configuration in the SVG file.");
        return;
      }
      
      let jsonString = svgContent.substring(jsonStart, endIndex);
      
      jsonString = jsonString.replace(/\\-\\-/g, '--');
      
      try {
        const jsonData = JSON5.parse(jsonString);

        const compactJson = formatConfig(jsonData);

        // Insert into hidden textarea (kept for compatibility) and into CodeMirror editor if available
        const textarea = document.getElementById('input');
        textarea.value = compactJson;

        // If the CodeMirror editor exists on the page, update it so the user can edit the JSON immediately
        try {
          if (window.codeMirrorEditor && typeof window.codeMirrorEditor.setValue === 'function') {
            window.codeMirrorEditor.setValue(compactJson);
          } else if (typeof updateCodeMirrorContent === 'function') {
            // fallback to helper defined in index.html
            updateCodeMirrorContent(compactJson);
          }
        } catch (cmErr) {
          console.warn('Could not update CodeMirror editor:', cmErr);
        }

        // If persistent text styling is on and this file specifies its own
        // (different) styling, let the editor layer ask which to keep before we
        // render (so persistence doesn't silently override the file).
        if (typeof window !== 'undefined' && typeof window.flowdromBeforeLoadRender === 'function') {
          try { window.flowdromBeforeLoadRender(); } catch (e) { /* never block loading */ }
        }

        // Re-render graph from the newly loaded config
        renderGraph();

        alert("SVG file loaded successfully!");
        console.log("SVG file loaded successfully!");
      } catch (jsonError) {
        alert("Error: The SVG file contains invalid JSON data. Please check the file format.");
        console.error("JSON parsing error:", jsonError);
        console.error("Extracted JSON string:", jsonString);
      }
    } catch (error) {
      alert("Error reading the SVG file. Please make sure it's a valid SVG file exported from this application.");
      console.error("File reading error:", error);
    }
  };
  
  reader.onerror = function() {
    alert("Error reading the file. Please try again.");
  };
  
  reader.readAsText(file);

  event.target.value = '';
}

// Headless export for the Node regression harness (no DOM is touched at require
// time — these are all pure). Ignored in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatConfig, jsonLiteral, formatKey, orderedKeys,
    cleanLaneName, computeGroupExtents, resolveTextConfig, migrateLanes,
    parseStateLabel, parsePath, messageNumbers,
    TOP_LEVEL_ORDER, SECTION_KEY_ORDER,
  };
}
