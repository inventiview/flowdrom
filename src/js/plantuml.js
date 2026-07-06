/*
 * PlantUML → flowdrom importer.
 *
 * plantumlToModel(text) -> { model, report }
 *
 * A pure, line-oriented converter for the common PlantUML *sequence* subset.
 * flowdrom is time-based and PlantUML is order-based, so time is SYNTHESISED
 * with a cursor: each message sits at an integer time (horizontal arrow) and
 * the cursor advances by one. Activations, notes and frames anchor to it.
 *
 * Never throws: anything it can't map is collected in report.unsupported so the
 * caller can surface an honest "these lines were approximated / skipped" note.
 *
 * Loaded in the browser (window.plantumlToModel) and required by the Node tests.
 * No DOM. (#plantuml)
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
  const GROUP_KW = /^(alt|opt|loop|par|critical|break|group)\b\s*(.*)$/i;

  // Nested-frame inset: each nesting level pulls the frame's side margins in and
  // its outer time boundaries inward, so a child frame sits ENTIRELY inside its
  // parent (matching flowdrom's default 40px margin at depth 0). alt/else stacking
  // stays seamless because only the group's very top/bottom get the vertical
  // inset, never the internal 'else' divider. (#plantuml nesting)
  const FRAME_MARGIN_BASE = 40, FRAME_MARGIN_STEP = 14, FRAME_MARGIN_FLOOR = 6;
  const FRAME_VINSET = 0.3; // time units pulled off each outer edge per depth level
  const round1 = (v) => Math.round(v * 10) / 10;

  // Parse the arrow segment (everything before the ':' label) into
  // { from, to, self, dashed, color, reverse, actTarget, deactTarget } or null.
  // Two passes: forward/other arrows must END in a direction char; a bare '<-'
  // reverse arrow is matched separately. This keeps '-' inside participant names
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

    // Trailing activation shorthand on the destination: 'B++' / 'B--'.
    let leftRef = m[1].trim(), rightRef = m[3].trim();
    let actTarget = false, deactTarget = false;
    const am = rightRef.match(/^(.*?)\s*(\+\+|--|\*\*|!!)\s*$/);
    if (am) { rightRef = am[1].trim(); if (am[2] === '++') actTarget = true; else if (am[2] === '--') deactTarget = true; }

    // Resolve semantic direction: 'A <- B' means B → A.
    const from = reverse ? rightRef : leftRef;
    const to = reverse ? leftRef : rightRef;
    if (!from || !to) return null;
    return { from: from, to: to, dashed: dashed, color: color, actTarget: actTarget, deactTarget: deactTarget };
  }

  function plantumlToModel(text) {
    const report = { unsupported: [], notes: [] };
    const model = { title: '', lanes: [], laneGroups: [], frames: [], infoBoxes: [], messages: [], states: [] };
    let autonumber = false;

    // ---- lane bookkeeping: alias -> display name, kept in declared/first-use order
    const aliasToName = {}; const nameUsed = {}; const laneOrder = [];
    function ensureLane(rawRef) {
      const ref = stripQuotes(rawRef); if (!ref) return null;
      if (aliasToName[ref]) return aliasToName[ref];
      if (nameUsed[ref]) return ref;
      aliasToName[ref] = ref; nameUsed[ref] = true; laneOrder.push(ref);
      return ref;
    }
    function declareParticipant(alias, display) {
      alias = stripQuotes(alias);
      let name = display ? stripQuotes(display) : alias;
      if (nameUsed[name] && name !== alias && !aliasToName[alias]) name = alias; // display-name collision
      if (!aliasToName[alias]) aliasToName[alias] = name;
      if (!nameUsed[name]) { nameUsed[name] = true; laneOrder.push(name); }
      if (boxOpen && boxOpen.lanes.indexOf(name) === -1) boxOpen.lanes.push(name);
      return name;
    }

    // ---- time. Start at 1 so the first message/note clears the lane headers.
    let cursor = 1, lastMsgTime = -1;
    // Frames get a uniform 0.5 headroom that preserves alt/else stacking.
    const frameTime = (c) => Math.max(0, c - 0.5);

    // ---- activation stacks (per lane) → thin states
    const actStacks = {};
    function activate(lane, fromLane) {
      (actStacks[lane] = actStacks[lane] || []).push({ open: (lastMsgTime >= 0 ? lastMsgTime : cursor), from: fromLane || null });
    }
    function deactivate(lane) {
      const st = actStacks[lane]; if (!st || !st.length) return null;
      const a = st.pop();
      const to = (cursor > a.open) ? cursor : a.open + 1;
      model.states.push({ lane: lane, color: 'white', width: 10, fromTime: a.open, toTime: to });
      return a;
    }

    // ---- group (frame) stack; a group carries one or more stacked sub-frames
    const groupStack = [];
    function addLaneToOpenGroups(lane) { groupStack.forEach((g) => g.lanes[lane] = true); }

    // ---- box → laneGroup
    let boxOpen = null;

    // ---- multi-line state (note / title blocks)
    const lines = text.replace(/\/'[\s\S]*?'\//g, '').split(/\r?\n/); // strip /' block comments '/

    // `i` is function-scoped (not for-block-scoped) so the note/title helpers can
    // advance it to consume a multi-line block. (#plantuml)
    let i = 0;
    for (; i < lines.length; i++) {
      let raw = lines[i];
      let line = raw.replace(/\t/g, ' ').trim();
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
        if (m[1].trim()) { model.title = nlToPipe(m[1]); }
        else {
          const buf = [];
          while (++i < lines.length && !/^end\s*title/i.test(lines[i].trim())) buf.push(lines[i].trim());
          model.title = buf.join('|');
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
        if (boxOpen) { if (boxOpen.lanes.length) model.laneGroups.push({ label: boxOpen.label, lanes: boxOpen.lanes.slice() }); boxOpen = null; }
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

      // note ... : text   (or a block terminated by 'end note')
      m = /^([rh]?note)\s+(left|right|over)\b(.*)$/i.exec(line);
      if (m) { handleNote(m[2].toLowerCase(), m[3]); continue; }

      // fragment open / else / end
      m = GROUP_KW.exec(line);
      if (m) {
        const kw = m[1].toLowerCase(), cond = m[2].trim();
        const label = kw + (cond ? ' [' + cond + ']' : '');
        groupStack.push({ subframes: [{ label: label, from: cursor, to: null }], lanes: {}, depth: groupStack.length });
        continue;
      }
      m = /^else\b\s*(.*)$/i.exec(line);
      if (m) {
        const g = groupStack[groupStack.length - 1];
        if (g) {
          g.subframes[g.subframes.length - 1].to = cursor;                 // close current branch
          const cond = m[1].trim();
          g.subframes.push({ label: 'else' + (cond ? ' [' + cond + ']' : ''), from: cursor, to: null });
        } else report.unsupported.push({ line: raw.trim(), reason: 'else outside a fragment' });
        continue;
      }
      if (/^end\b/i.test(line)) { closeGroup(); continue; }

      // activate / deactivate / return
      m = /^activate\s+(\S+)/i.exec(line); if (m) { activate(ensureLane(m[1])); continue; }
      m = /^deactivate\s+(\S+)/i.exec(line); if (m) { deactivate(ensureLane(m[1])); continue; }
      if (/^return\b/i.test(line)) {
        // Close the most recent activation and, if we know who called it, send a
        // dashed reply back. Best-effort. (#plantuml)
        const label = nlToPipe(line.replace(/^return\b/i, ''));
        let closed = null, lane = null;
        for (const ln in actStacks) if (actStacks[ln] && actStacks[ln].length) { lane = ln; }
        if (lane) closed = deactivate(lane);
        if (closed && closed.from) emitMessage(lane, closed.from, label, true, null);
        else if (!lane) report.unsupported.push({ line: raw.trim(), reason: 'return with no open activation' });
        continue;
      }

      // message  (the workhorse)
      const ci = line.indexOf(':');
      const head = ci >= 0 ? line.slice(0, ci) : line;
      const label = ci >= 0 ? line.slice(ci + 1).trim() : '';
      const a = parseArrow(head);
      if (a) {
        const from = ensureLane(a.from), to = ensureLane(a.to);
        emitMessage(from, to, nlToPipe(label), a.dashed, a.color);
        if (a.actTarget) activate(to, from);
        if (a.deactTarget) deactivate(to);
        continue;
      }

      report.unsupported.push({ line: raw.trim(), reason: 'unrecognised line' });
    }

    // Close anything left dangling.
    while (groupStack.length) closeGroup();
    Object.keys(actStacks).forEach((ln) => { while (actStacks[ln] && actStacks[ln].length) deactivate(ln); });

    // ---- helpers that close over the model/state above ----
    function emitMessage(from, to, label, dashed, color) {
      if (from == null || to == null) return;
      // Normal messages are horizontal (from==to). A self message needs a 1-unit
      // span so its loop is tall enough to hold a label. (#plantuml)
      const isSelf = (from === to);
      const fromT = cursor, toT = cursor + (isSelf ? 1 : 0);
      const msg = { path: from + '->' + to, fromTime: fromT, toTime: toT };
      // Self-message labels read horizontally, like PlantUML (the '^' modifier);
      // without it a long label renders vertically and runs off the canvas.
      if (isSelf && label) label = '^' + label;
      if (label) msg.label = label;
      if (color) msg.color = color;
      msg.style = dashed ? 'dashed' : 'solid';
      model.messages.push(msg);
      addLaneToOpenGroups(from); addLaneToOpenGroups(to);
      lastMsgTime = toT; cursor = toT + 1;
    }
    function handleNote(pos, rest) {
      // rest is like ' over A : text', ' over A, B : text', ' of A : text'
      const ci = rest.indexOf(':');
      let target = (ci >= 0 ? rest.slice(0, ci) : rest).replace(/^\s*of\s+/i, '').trim();
      let body = ci >= 0 ? nlToPipe(rest.slice(ci + 1)) : '';
      if (ci < 0) { // multi-line block until 'end note'
        const buf = [];
        while (++i < lines.length && !/^end\s*[rh]?note/i.test(lines[i].trim())) buf.push(lines[i].trim());
        body = buf.join('|');
      }
      const first = target.split(',')[0];
      const lane = ensureLane(first); if (lane == null) return;
      // 'over' sits just below the anchor (not above — that collides with the
      // lane headers when the note is near t=0); left/right sit to the side. (#plantuml)
      const off = pos === 'left' ? '<-95,0>' : pos === 'right' ? '<95,0>' : '<0,40>';
      model.infoBoxes.push({ lane: lane, time: Math.max(0, lastMsgTime >= 0 ? lastMsgTime : cursor), text: off + body });
      addLaneToOpenGroups(lane);
    }
    function closeGroup() {
      const g = groupStack.pop(); if (!g) return;
      g.subframes[g.subframes.length - 1].to = cursor;
      const laneNames = laneOrder.filter((n) => g.lanes[n]);
      const span = laneNames.length ? laneNames : laneOrder.slice(); // fall back to all lanes
      const depth = g.depth || 0;
      const margin = Math.max(FRAME_MARGIN_FLOOR, FRAME_MARGIN_BASE - depth * FRAME_MARGIN_STEP);
      const n = g.subframes.length;
      g.subframes.forEach((sf, idx) => {
        let from = frameTime(sf.from), to = frameTime(sf.to == null ? cursor : sf.to);
        if (idx === 0) from = from + depth * FRAME_VINSET;         // group top edge only
        if (idx === n - 1) to = to - depth * FRAME_VINSET;         // group bottom edge only
        if (to <= from) to = from + 0.5;                            // keep a positive height
        const frame = { label: sf.label, lanes: span.slice(), fromTime: round1(from), toTime: round1(to) };
        if (depth > 0) { frame.lMargin = margin; frame.rMargin = margin; } // inset from the parent
        model.frames.push(frame);
      });
    }

    // ---- assemble the final model, dropping empty sections ----
    model.lanes = laneOrder.slice();
    const out = {};
    if (model.title) out.title = model.title;
    if (autonumber) out.options = { graph: { autonumber: true } };
    out.lanes = model.lanes;
    if (model.laneGroups.length) out.laneGroups = model.laneGroups;
    if (model.frames.length) out.frames = model.frames;
    if (model.infoBoxes.length) out.infoBoxes = model.infoBoxes;
    if (model.messages.length) out.messages = model.messages;
    if (model.states.length) out.states = model.states;
    return { model: out, report: report };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { plantumlToModel: plantumlToModel, parseArrow: parseArrow };
  if (typeof window !== 'undefined') window.plantumlToModel = plantumlToModel;
})();
