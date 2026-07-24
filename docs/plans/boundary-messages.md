# Plan: Boundary-snapped message endpoints

Status: in progress. Code is the source of truth if this doc ever diverges.

## Goal & behavior

When a message endpoint lands inside a state box, terminate the arrow at the
box's **facing edge** (side toward the other lifeline) at the message's own
time, instead of crossing to the lane center (which overlaps the state's
centered label). Controlled by a global default plus a per-state override.

**Resolution rule (per endpoint):** collect the states on that lane whose
vertical span contains the endpoint's Y; order them **outermost -> innermost**
(widest facing-edge first). Walk inward, resolving each state's `attach` (own
setting, else the global default):

- `boundary` -> stop, snap to this box's facing edge. Done.
- `center`   -> pass through to the next inner state.
- fall through all -> land at lane center (today's behavior).

"Outermost" = widest facing edge (the box an arrow from outside reaches first).
This is independent of the duration-based *z-order* draw sort in main.js.

## Data model

- **Global:** `options.graph.messageAttach: 'center' | 'boundary'`, default
  `'center'` so existing diagrams render unchanged (feature is opt-in).
- **Per-state:** `state.attach: 'default' | 'boundary' | 'center'`, default
  `'default'` (inherits global). Add `'attach'` to `SECTION_KEY_ORDER.states`
  (main.js ~line 177), after `width`.

## Shared snap function (single source of truth)

Pure helper, defined in main.js and exposed on `window` so the editor's live
previews reuse it (no duplicated math):

```
snapMessageEndpoint({ laneCenterX, y, otherX, boxesOnLane, resolveAttach }) -> x
```

- `boxesOnLane`: state boxes on this lane whose `[y, y+h]` contains the endpoint
  Y, sorted by width descending (furthest facing edge = outermost).
- `resolveAttach(stateModelIndex) -> 'boundary' | 'center'` (applies the default
  fallback).
- Facing edge: `otherX >= laneCenterX ? box.x + box.w : box.x`.
- Returns lane center if nothing matches.

## Renderer changes (main.js)

- **Geometry pre-pass** — extract state box sizing (the width/rect math around
  lines 1330-1376) into `computeStateBoxes()` returning
  `[{stateIndex, lane, boxX, boxWidth, rectY, rectH}]`, run *before* the message
  loop. The existing state-draw loop then consumes the same rects (one source of
  truth). Must preserve explicit-`width`, `uniformStateWidth`, min-floor, and
  vertical-`^` rules exactly. **Verify pixel-identical before adding snapping.**
- **Snap straight messages** (lines 1053-1056) — replace `fromX`/`toX` with
  snapped values (each endpoint uses the other's lane-center X as `otherX`).
  Feed snapped endpoints into `calculateLabelPosition` so the label re-centers on
  the shortened arrow.
- **Self-messages** (lines 1058-1141) — start/return the loop at the box's facing
  edge (bulge side) instead of `fromX`.
- **Inversion guard** — after snapping both ends, if they'd cross or the arrow
  gets shorter than a small minimum, revert *both* ends of that message to
  center. Prevents reversed arrows when boxes are wide and lanes close.
- **Expose endpoints** — add
  `layout.messageEndpoints[msgIndex] = { fromX, fromY, toX, toY, self, side }`
  to the exposed `layout` object (~line 1772), so the editor matches the render
  without re-deriving.

## Editor changes (editor.js)

Everything interactive must sit at the *snapped* endpoints:

- **Drag handles** (lines 1964-1966) — read `layout.messageEndpoints[i]` instead
  of `laneX(pp.from/to)`.
- **Hit-testing / selection box** (lines 1043-1056) — same substitution, so click
  targeting and the dashed selection window follow the visible arrow.
- **Guide line, committed drag** (lines 2062-2081) — fixed end reads its committed
  snapped X; dragged end computes snap live against current boxes.
- **Guide line, creation** (`messageGuide` line 3558, from `onCreateMove` ~3599)
  — call the shared window snap helper against the measure-pass state boxes
  (editor already has these: `kind==='state'` with `data-index` -> model index).
- **Global option UI** — in `showOptionsPanel()` (~line 3398, beside existing
  checkboxes) add "Snap messages to state boundaries"; checked sets
  `graph.messageAttach = 'boundary'`, unchecked clears it.
- **Per-state menu** — in the `item.kind === 'state'` block (line 1222, next to
  Width) add "Message attach >" submenu showing the current value with three
  rows: Default (global) / Snap to boundary / Center (through state), writing
  `state.attach` (omit the key when set back to `default`).

## Edge cases

- No containing state -> center (fallback, no change).
- Endpoint exactly on the box's top/bottom edge (the state's begin/end time)
  reaches the lane center, not the side edge: the containment test is strictly
  inside (`y > top && y < bottom`), since the box already meets the lifeline at
  that horizontal edge. Handles both edges without a special case.
- Both ends snap -> handled independently, then the inversion guard runs.
- Vertical `^` states -> have a real box; snap uses actual `boxX`/`boxWidth`.

## Tests (test/)

Unit tests for pure `snapMessageEndpoint` (no DOM): no-state fallback; single
`boundary`; single `center` pass-through; nested outer-center + inner-boundary;
nested outer-boundary short-circuit; facing-edge from-left vs from-right;
inversion guard; self-message side. Plus a render smoke test that a
boundary-mode message's `x2` equals the box edge.

## Docs

Update `docs/user-guide.md` with the global toggle and the per-state attach
option.

## Build order

1. Data model + serialization key. **[done]** — `attach` added to state key
   order; `messageAttach` global read + `resolveStateAttach()` helper in main.js.
2. `computeStateBoxes()` refactor — render stays pixel-identical; verify first.
   **[done]** — geometry pre-pass added before the message loop; draw loop
   consumes `stateBoxByIndex`; old inline sizing removed.
3. Shared `snapMessageEndpoint` + straight-message snapping + label + guard +
   expose endpoints. **[done]** — snap is a no-op in `center` mode; endpoints +
   `stateBoxes` exposed on `window.flowdromLayout`.
4. Self-messages. **[done]** — loop near ends snap to the bulge-side edge with a
   width guard.
5. Editor chrome consistency (handles, hit-test, guides). **[done]** — handles +
   hit-test read `layout.messageEndpoints`; `messageGuide` snaps live via
   `snapEndpointX`/`snapStraightEnds`.
6. Global + per-state UI. **[done]** — "Snap messages to state boundaries"
   checkbox in Styling; per-state "Message attach…" submenu.
7. Tests + docs. **[done]** — pure `snapEndpointPure`/`guardInversion` extracted
   + exported + unit-tested; user-guide section added.
