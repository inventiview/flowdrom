/*
 * PlantUML → flowdrom importer.
 *
 * plantumlToModel(text) -> { model, report }
 *
 * Three phases (#plantuml refactor):
 *
 *   A. PARSE  — the line-oriented grammar builds an event TREE: fragments
 *      (alt / opt / loop / par / group / partition / …) are nodes holding
 *      ordered branches of children; messages, notes and activations are
 *      leaves. No time values exist in this phase.
 *
 *   B. LAYOUT — a walk over the tree hands out integer ROWS (1 row = 1
 *      flowdrom time unit). Everything that needs vertical room gets a row:
 *        message              → 1 row (self-message: 2 — the loop needs height)
 *        targeted note        → 1 row
 *        targetless side note → 0 rows — it shares the LAST MESSAGE's row,
 *                               anchored beyond the outermost involved lane
 *        fragment open        → 1 row (top edge + header, so the label tab
 *                               always has clearance)
 *        alt/else divider     → 1 row shared by both branches (seamless stack)
 *        fragment close       → 1 row (bottom padding + gap before a sibling)
 *      Containment of nested frames, tab clearance, and gaps between
 *      independent sibling fragments are structural consequences of the row
 *      accounting — there are no tuning constants on the vertical axis.
 *
 *   C. EMIT   — the laid-out events map 1:1 onto the flowdrom model.
 *
 * flowdrom is time-based and PlantUML is order-based: the rows ARE the
 * synthesised timeline. Arrows come out horizontal; the user drags them off
 * horizontal afterwards to express real latency.
 *
 * Never throws: anything unmapped lands in report.unsupported so the caller
 * can surface an honest "these lines were skipped" note.
 *
 * Loaded in the browser (window.plantumlToModel) and required by the Node
 * tests. No DOM. (#plantuml)
 */
(function () {
  'use strict';

  function stripQuotes(s) {
    s = String(s == null ? '' : s).trim();
    const m = /^"([\s\S]*)"$/.exec(s) || /^'([\s\S]*)'$/.exec(s);
    return m ? m[1].trim() : s;
  }
  // PlantUML colors: '#red' (named) or '#FF8800' (hex). Normalise to what
  // flowdrom accepts — a bare CSS name, or a '#'-prefixed hex.
  function normalizeColor(c) {
    c = String(c || '').trim();
    if (!c) return null;
    if (c[0] === '#') c = c.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(c) || /^[0-9a-fA-F]{6}$/.test(c)) return '#' + c;
    return c;
  }
  // PlantUML '\n' inside a label → flowdrom '|' line break.
  function nlToPipe(s) { return String(s == null ? '' : s).replace(/\\n/g, '|').trim(); }

  const PARTICIPANT_KW = /^(participant|actor|boundary|control|entity|database|collections|queue)\b\s*(.*)$/i;
  const GROUP_KW = /^(alt|opt|loop|partition|par|critical|break|group)\b\s*(.*)$/i;
  const NOTE_BG = '#FEFECE'; // PlantUML's pale note yellow

  // Horizontal inset per nesting depth, so a child frame spanning the same
  // lanes sits visibly INSIDE its parent. (Vertical containment needs no
  // constants — it falls out of the row layout.)
  const FRAME_MARGIN_BASE = 40, FRAME_MARGIN_STEP = 14, FRAME_MARGIN_FLOOR = 6;
  const DEFAULT_LANE_SPACING = 250; // the renderer's default main-lane pitch

  // Parse the arrow segment (everything before the ':' label) into
  // { from, to, dashed, color, actTarget, deactSource } or null. Two passes:
  // forward/other arrows must END in a direction char; a bare '<-' reverse
  // arrow is matched separately. This keeps '-' inside participant names
  // (e.g. User-Service) from being mistaken for the arrow. (#plantuml)
  function parseArrow(head) {
    let color = null, styleDashed = false;
    // A '[#color]' / '[#color,dashed]' block sits between the line and the head;
    // pull out its tokens and remove it (that leaves the dash count intact).
    head = head.replace(/\[([^\]]*)\]/, function (_m, inner) {
      String(inner).split(',').forEach(function (tok) {
        tok = tok.trim();
        if (tok[0] === '#') color = normalizeColor(tok);
        else if (/^(dashed|dotted)$/i.test(tok)) styleDashed = true;
      });
      return '';
    });

    let m = head.match(/^(.+?)\s*((?:<{1,2})?[-.]{1,3}(?:>{1,2}|\\|\/|x|o))\s*(.+)$/);
    if (!m) m = head.match(/^(.+?)\s*(<{1,2}[-.]{1,3})\s*(.+)$/);
    if (!m) return null;

    const arrow = m[2];
    const reverse = /^<{1,2}/.test(arrow) && !/>/.test(arrow);
    const dashRun = arrow.replace(/[<>\\/xo]/g, '');
    const dashed = styleDashed || dashRun.length >= 2 || dashRun.indexOf('.') >= 0;

    // Trailing activation shorthand after the right-hand token: '++' activates
    // the message TARGET, '--' deactivates the SOURCE — PlantUML's semantics,
    // so a reply 'A <- B --' (or 'B -> A --') closes B's activation. Tokens may
    // combine ('--++'), and may carry a trailing '#color' (ignored). '**'/'!!'
    // (create/destroy) are stripped but unsupported.
    let leftRef = m[1].trim(), rightRef = m[3].trim();
    let actTarget = false, deactSource = false;
    for (;;) {
      const am = rightRef.match(/^(.*?)\s*(\+\+|--|\*\*|!!)\s*(?:#\w+)?\s*$/);
      if (!am) break;
      rightRef = am[1].trim();
      if (am[2] === '++') actTarget = true;
      else if (am[2] === '--') deactSource = true;
    }

    // Resolve semantic direction: 'A <- B' means B → A.
    const from = reverse ? rightRef : leftRef;
    const to = reverse ? leftRef : rightRef;
    if (!from || !to) return null;
    return { from: from, to: to, dashed: dashed, color: color, actTarget: actTarget, deactSource: deactSource };
  }

  function plantumlToModel(text) {
    const report = { unsupported: [], notes: [] };
    let title = '', autonumber = false;

    // ---- lane bookkeeping: alias -> display name, kept in declared/first-use order
    const aliasToName = {}; const nameUsed = {}; const laneOrder = [];
    const laneGroups = [];
    let boxOpen = null;
    function ensureLane(rawRef) {
      const ref = stripQuotes(rawRef); if (!ref) return null;
      if (aliasToName[ref]) return aliasToName[ref];
      if (nameUsed[ref]) return ref;
      aliasToName[ref] = ref; nameUsed[ref] = true; laneOrder.push(ref);
      return ref;
    }
    function declareParticipant(alias, display) {
      alias = stripQuotes(alias);
      // A '\n' in the display name → '|' line break (flowdrom's lane-label
      // convention). The alias stays the message-reference key.
      let name = display ? nlToPipe(stripQuotes(display)) : alias;
      if (nameUsed[name] && name !== alias && !aliasToName[alias]) name = alias; // display-name collision
      if (!aliasToName[alias]) aliasToName[alias] = name;
      if (!nameUsed[name]) { nameUsed[name] = true; laneOrder.push(name); }
      if (boxOpen && boxOpen.lanes.indexOf(name) === -1) boxOpen.lanes.push(name);
      return name;
    }

    // =====================================================================
    // Phase A — parse into an event tree.
    // =====================================================================
    const root = [];
    const stack = [root];   // stack of children arrays (top = current container)
    const fragStack = [];   // open fragment nodes, parallel to stack[1..]
    const top = () => stack[stack.length - 1];

    const lines = text.replace(/\/'[\s\S]*?'\//g, '').split(/\r?\n/); // strip /' block comments '/

    // `i` is function-scoped (not for-block-scoped) so the note/title helpers
    // can advance it to consume a multi-line block.
    let i = 0;
    for (; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.replace(/\t/g, ' ').trim();
      if (!line) continue;
      if (line[0] === "'") continue;                                   // ' line comment
      if (/^@(start|end)uml\b/i.test(line)) continue;
      if (/^(skinparam|!|hide|show|scale|autoactivate|mainframe|header|footer|legend|caption)\b/i.test(line)) {
        if (/^autoactivate\b/i.test(line)) report.notes.push('autoactivate not applied: ' + line);
        continue; // styling / directives we intentionally drop
      }
      if (/^left to right|^top to bottom/i.test(line)) continue;

      // title (single-line, or a block terminated by 'end title')
      let m = /^title\b\s*(.*)$/i.exec(line);
      if (m) {
        if (m[1].trim()) { title = nlToPipe(m[1]); }
        else {
          const buf = [];
          while (++i < lines.length && !/^end\s*title/i.test(lines[i].trim())) buf.push(lines[i].trim());
          title = buf.join('|');
        }
        continue;
      }

      // autonumber → the flowdrom feature (custom start/step approximated as 1,1)
      m = /^autonumber\b\s*(.*)$/i.exec(line);
      if (m) {
        if (/^(stop|resume)/i.test(m[1].trim())) report.notes.push('autonumber ' + m[1].trim() + ' not applied');
        else { autonumber = true; if (m[1].trim()) report.notes.push('autonumber start/step approximated as 1,1: ' + line); }
        continue;
      }

      // box "Label" ... end box  → laneGroup
      m = /^box\b\s*(.*)$/i.exec(line);
      if (m) { boxOpen = { label: stripQuotes(m[1]) || 'Group', lanes: [] }; continue; }
      if (/^end\s*box/i.test(line)) {
        if (boxOpen) { if (boxOpen.lanes.length) laneGroups.push({ label: boxOpen.label, lanes: boxOpen.lanes.slice() }); boxOpen = null; }
        continue;
      }

      // participant declarations (all the actor-ish keywords)
      m = PARTICIPANT_KW.exec(line);
      if (m) {
        const rest = m[2].trim();
        const asM = /^(.*?)\s+as\s+(\S+)\s*$/i.exec(rest);
        if (asM) declareParticipant(asM[2], asM[1]);            // participant "Name" as Alias
        else declareParticipant(rest, null);                   // participant Alias  (or "Name")
        continue;
      }

      // note left/right/over [of] X[, Y] : text   (or a block until 'end note')
      m = /^([rh]?note)\s+(left|right|over)\b(.*)$/i.exec(line);
      if (m) {
        const pos = m[2].toLowerCase();
        const rest = m[3];
        const ci = rest.indexOf(':');
        const targetStr = (ci >= 0 ? rest.slice(0, ci) : rest).replace(/^\s*of\s+/i, '').trim();
        let body = ci >= 0 ? nlToPipe(rest.slice(ci + 1)) : '';
        if (ci < 0) { // multi-line block until 'end note'
          const buf = [];
          while (++i < lines.length && !/^end\s*[rh]?note/i.test(lines[i].trim())) buf.push(lines[i].trim());
          body = buf.join('|');
        }
        // Resolve explicit targets NOW so lanes register in source order;
        // an empty list marks a targetless side note (resolved at layout).
        const targets = targetStr ? targetStr.split(',').map((s) => ensureLane(s)).filter(Boolean) : [];
        top().push({ type: 'note', pos: pos, targets: targets, body: body });
        continue;
      }

      // fragment open / else / end
      m = GROUP_KW.exec(line);
      if (m) {
        const kw = m[1].toLowerCase(), cond = m[2].trim();
        // 'group' shows its label directly (like PlantUML); the others prefix
        // the operator and bracket the guard: 'alt [cond]', 'partition [p1]'.
        const label = (kw === 'group') ? (cond || 'group') : (kw + (cond ? ' [' + cond + ']' : ''));
        const node = { type: 'fragment', branches: [{ label: label, children: [] }] };
        top().push(node);
        stack.push(node.branches[0].children);
        fragStack.push(node);
        continue;
      }
      m = /^else\b\s*(.*)$/i.exec(line);
      if (m) {
        const f = fragStack[fragStack.length - 1];
        if (f) {
          const cond = m[1].trim();
          const branch = { label: 'else' + (cond ? ' [' + cond + ']' : ''), children: [] };
          f.branches.push(branch);
          stack.pop(); stack.push(branch.children);
        } else report.unsupported.push({ line: raw.trim(), reason: 'else outside a fragment' });
        continue;
      }
      if (/^end\b/i.test(line)) {
        if (fragStack.length) { stack.pop(); fragStack.pop(); }
        else report.unsupported.push({ line: raw.trim(), reason: 'end with no open fragment' });
        continue;
      }

      // delay ('...' or '...text...') → a flowdrom time gap; spacer ('|||' or
      // '||N||') → blank vertical space (no marker). (#time-gap)
      m = /^\.\.\.(.*)$/.exec(line);
      if (m) { top().push({ type: 'delay', label: nlToPipe(m[1].trim().replace(/\.+$/, '').trim()) }); continue; }
      if (/^\|{3,}$/.test(line) || /^\|\|\s*\d+\s*\|\|$/.test(line)) { top().push({ type: 'spacer' }); continue; }

      // activate / deactivate / return
      m = /^activate\s+(\S+)/i.exec(line); if (m) { top().push({ type: 'activate', lane: ensureLane(m[1]) }); continue; }
      m = /^deactivate\s+(\S+)/i.exec(line); if (m) { top().push({ type: 'deactivate', lane: ensureLane(m[1]) }); continue; }
      if (/^return\b/i.test(line)) { top().push({ type: 'return', label: nlToPipe(line.replace(/^return\b/i, '')) }); continue; }

      // message  (the workhorse)
      const ci = line.indexOf(':');
      const head = ci >= 0 ? line.slice(0, ci) : line;
      const label = ci >= 0 ? line.slice(ci + 1).trim() : '';
      const a = parseArrow(head);
      if (a) {
        top().push({
          type: 'message', from: ensureLane(a.from), to: ensureLane(a.to),
          label: nlToPipe(label), dashed: a.dashed, color: a.color,
          actTarget: a.actTarget, deactSource: a.deactSource,
        });
        continue;
      }

      report.unsupported.push({ line: raw.trim(), reason: 'unrecognised line' });
    }
    // Fragments left open at EOF close implicitly (the tree already holds them).

    // ---- lane spacing: widen the pitch when message labels need the room ----
    // Imported labels are often long enough to overflow a 250px arrow. Estimate
    // each label's width (Courier ≈9px/char at the default 15px size, plus the
    // autonumber prefix) against the number of lanes its arrow spans, and widen
    // the lane pitch so every label fits. Diagrams with short labels keep the
    // classic default, so hand-authored flowdrom is untouched. (#lane-spacing)
    const CHAR_PX = 9, SPACING_SLACK = 60;
    const msgLeaves = [];
    (function collect(children) {
      children.forEach((n) => {
        if (n.type === 'message' || n.type === 'return') msgLeaves.push(n);
        else if (n.type === 'fragment') n.branches.forEach((b) => collect(b.children));
      });
    })(root);
    const numExtra = autonumber ? String(msgLeaves.length).length + 1 : 0; // "12 " prefix
    let needPx = 0;
    msgLeaves.forEach((n) => {
      if (n.type !== 'message' || n.from == null || n.to == null || n.from === n.to) return;
      const span = Math.max(1, Math.abs(laneOrder.indexOf(n.from) - laneOrder.indexOf(n.to)));
      const w = Math.max.apply(null, String(n.label || '').split('|').map((l, li) => l.length + (li === 0 ? numExtra : 0)));
      needPx = Math.max(needPx, (w * CHAR_PX + SPACING_SLACK) / span);
    });
    const laneSpacingPx = Math.max(DEFAULT_LANE_SPACING, Math.ceil(needPx / 10) * 10);
    if (laneSpacingPx > DEFAULT_LANE_SPACING) report.notes.push('lane spacing widened to ' + laneSpacingPx + 'px to fit message labels');

    // =====================================================================
    // Phase B + C — row layout over the tree, emitting the flowdrom model.
    // =====================================================================
    const model = { messages: [], states: [], infoBoxes: [], frames: [], timeGaps: [] };
    let r = 1;            // next free row; row 0 is headroom under the lane labels
    let lastMsg = null;   // { row, from, to } — side-note + activation anchor
    const actStacks = {}; // lane -> stack of open activations
    const actOrder = [];  // global LIFO of open activations (for 'return')
    const collectors = []; // lane sets of the enclosing fragments

    const laneIdx = (n) => laneOrder.indexOf(n);
    function touchLanes(names) { names.forEach((n) => collectors.forEach((set) => { set[n] = true; })); }

    function emitMessage(node) {
      if (node.from == null || node.to == null) return;
      const isSelf = node.from === node.to;
      const msg = { path: node.from + '->' + node.to, fromTime: r, toTime: isSelf ? r + 1 : r };
      // Self-message labels read horizontally, like PlantUML (the '^' modifier);
      // without it a long label renders vertically and runs off the canvas.
      let label = node.label;
      if (isSelf && label) label = '^' + label;
      if (label) msg.label = label;
      if (node.color) msg.color = node.color;
      msg.style = node.dashed ? 'dashed' : 'solid';
      model.messages.push(msg);
      touchLanes([node.from, node.to]);
      lastMsg = { row: msg.fromTime, from: node.from, to: node.to };
      r = msg.toTime + 1;
      if (node.actTarget) doActivate(node.to, node.from);   // '++' → activate the target
      if (node.deactSource) doDeactivate(node.from);        // '--' → deactivate the sender
    }

    function doActivate(lane, fromLane) {
      if (lane == null) return;
      const rec = { lane: lane, open: lastMsg ? lastMsg.row : r, from: fromLane || null };
      (actStacks[lane] = actStacks[lane] || []).push(rec);
      actOrder.push(rec);
    }
    // Close the lane's most recent activation as a thin white state hugging the
    // exchange: opened at the triggering message's row, closed at the last
    // message's row (min 1 unit tall).
    function doDeactivate(lane) {
      const st = actStacks[lane];
      if (!st || !st.length) return null;
      const rec = st.pop();
      const oi = actOrder.lastIndexOf(rec); if (oi >= 0) actOrder.splice(oi, 1);
      let to = lastMsg ? lastMsg.row : rec.open + 1;
      if (to <= rec.open) to = rec.open + 1;
      model.states.push({ lane: lane, color: 'white', width: 10, fromTime: rec.open, toTime: to });
      return rec;
    }
    // 'return': reply from the most recently activated lane back to its caller
    // (when known), then close that activation AT the reply's row.
    function doReturn(label) {
      const rec = actOrder.length ? actOrder[actOrder.length - 1] : null;
      if (!rec) { report.unsupported.push({ line: 'return' + (label ? ' ' + label : ''), reason: 'return with no open activation' }); return; }
      if (rec.from) emitMessage({ type: 'message', from: rec.lane, to: rec.from, label: label, dashed: true, color: null });
      doDeactivate(rec.lane);
    }

    // A delay becomes a time gap spanning a short window at the current row; the
    // optional text is its label. A spacer just advances the row (blank space).
    function emitDelay(node) {
      const g = { fromTime: r, toTime: r + 2 };
      if (node.label) g.label = node.label;
      model.timeGaps.push(g);
      r = g.toTime + 1;
      lastMsg = null; // a delay breaks "beside the last message" note anchoring
    }

    function emitNote(node) {
      let names = node.targets;
      if (!names.length) {
        if (lastMsg) {
          // Targetless side note = "beside the last message" (PlantUML): shares
          // that message's ROW, anchored beyond the outermost involved lane so
          // it can never cover the arrow or its label. Consumes no row.
          const ia = laneIdx(lastMsg.from), ib = laneIdx(lastMsg.to);
          const lane = node.pos === 'left' ? laneOrder[Math.min(ia, ib)] : laneOrder[Math.max(ia, ib)];
          const off = node.pos === 'left' ? '<-95,0>' : '<95,0>';
          model.infoBoxes.push({ lane: lane, time: lastMsg.row, background: NOTE_BG, tether: false, text: off + node.body });
          touchLanes([lane]);
          return;
        }
        names = laneOrder.length ? [laneOrder[0]] : []; // note before any message
        if (!names.length) return;
      }
      // Targeted note: its own row. A multi-lane 'over' is centered between its
      // lanes (main lanes sit LANE_SPACING apart in the renderer).
      const idxs = names.map(laneIdx);
      const lo = Math.min.apply(null, idxs), hi = Math.max.apply(null, idxs);
      const anchor = laneOrder[lo];
      const off = node.pos === 'over'
        ? ('<' + Math.round(((lo + hi) / 2 - lo) * laneSpacingPx) + ',0>')
        : (node.pos === 'left' ? '<-95,0>' : '<95,0>');
      model.infoBoxes.push({ lane: anchor, time: r, background: NOTE_BG, tether: false, text: off + node.body });
      touchLanes(names);
      r += 1;
    }

    function layoutFragment(node, depth) {
      const set = {};
      collectors.push(set);
      const marks = [r]; r += 1;              // top edge; header row gives the tab clearance
      node.branches.forEach((br, bi) => {
        if (bi > 0) { marks.push(r); r += 1; } // shared divider row between alt/else branches
        walk(br.children, depth + 1);
      });
      marks.push(r); r += 1;                  // bottom edge; the extra row is padding + sibling gap
      collectors.pop();
      const laneNames = laneOrder.filter((n) => set[n]);
      const span = laneNames.length ? laneNames : laneOrder.slice(); // empty fragment: all lanes
      touchLanes(laneNames);                  // parent fragments scope these lanes too
      const margin = Math.max(FRAME_MARGIN_FLOOR, FRAME_MARGIN_BASE - depth * FRAME_MARGIN_STEP);
      node.branches.forEach((br, bi) => {
        const frame = { label: br.label, lanes: span.slice(), fromTime: marks[bi], toTime: marks[bi + 1] };
        if (depth > 0) { frame.lMargin = margin; frame.rMargin = margin; } // horizontal inset from the parent
        model.frames.push(frame);
      });
    }

    function walk(children, depth) {
      children.forEach((node) => {
        if (node.type === 'message') emitMessage(node);
        else if (node.type === 'delay') emitDelay(node);
        else if (node.type === 'spacer') { r += 2; lastMsg = null; }
        else if (node.type === 'note') emitNote(node);
        else if (node.type === 'activate') doActivate(node.lane, lastMsg ? lastMsg.from : null);
        else if (node.type === 'deactivate') doDeactivate(node.lane);
        else if (node.type === 'return') doReturn(node.label);
        else if (node.type === 'fragment') layoutFragment(node, depth);
      });
    }

    walk(root, 0);
    while (actOrder.length) doDeactivate(actOrder[actOrder.length - 1].lane); // close dangling activations

    // ---- assemble the final model, dropping empty sections ----
    const out = {};
    if (title) out.title = title;
    const graphOut = {};
    if (autonumber) graphOut.autonumber = true;
    if (laneSpacingPx > DEFAULT_LANE_SPACING) graphOut.laneSpacing = laneSpacingPx;
    if (Object.keys(graphOut).length) out.options = { graph: graphOut };
    out.lanes = laneOrder.slice();
    if (laneGroups.length) out.laneGroups = laneGroups;
    if (model.frames.length) out.frames = model.frames;
    if (model.timeGaps.length) out.timeGaps = model.timeGaps;
    if (model.infoBoxes.length) out.infoBoxes = model.infoBoxes;
    if (model.messages.length) out.messages = model.messages;
    if (model.states.length) out.states = model.states;
    return { model: out, report: report };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { plantumlToModel: plantumlToModel, parseArrow: parseArrow };
  if (typeof window !== 'undefined') window.plantumlToModel = plantumlToModel;
})();
