# Flowdrom User Guide

**Flowdrom** is a web-based tool for creating transaction timing diagrams and sequence charts. It uses JSON-based definitions to generate visual diagrams that can be exported as SVG or PNG files.

## Table of Contents
- [Getting Started](#getting-started)
- [Basic Concepts](#basic-concepts)
- [The Graphical Editor](#the-graphical-editor)
- [Feature Examples](#feature-examples)
  - [1. Two-Lane Communication](#1-two-lane-communication)
    - [Simple Two-Lane Communication](#simple-two-lane-communication)
    - [Unordered Two-Lane Communication](#unordered-two-lane-communication)
  - [Building & editing on the canvas](#building--editing-on-the-canvas)
    - [Start a new diagram](#start-a-new-diagram)
    - [Select an item](#select-an-item)
    - [Zoom and fit the canvas](#zoom-and-fit-the-canvas)
    - [Move and edit existing items](#move-and-edit-existing-items)
    - [Select multiple items](#select-multiple-items)
    - [Add items](#add-items)
  - [2. Adding States](#2-adding-states)
    - [Thin & nested states (activation bars)](#thin--nested-states-activation-bars)
  - [3. Multi-Lane Systems](#3-multi-lane-systems)
  - [4. Lane Groups](#4-lane-groups)
  - [5. Frames (interaction scopes)](#5-frames-interaction-scopes)
  - [6. Time gaps (elapsed time)](#6-time-gaps-elapsed-time)
  - [7. Information Boxes](#7-information-boxes)
  - [8. Complex Transactions](#8-complex-transactions)
  - [9. Legends](#9-legends)
- [Styling & Options](#styling--options)
- [Importing from PlantUML](#importing-from-plantuml)
- [HTML / CSS named colors](#html--css-named-colors)
- [JSON Schema Reference](#json-schema-reference)

## Getting Started

1. Open Flowdrom in your web browser
2. Edit the JSON in the **source panel** (left side) to define your diagram
3. Click **"Render"** to generate the visual diagram
4. Use **"Export SVG"** or **"Export PNG"** to save your diagram
5. Use **"Load SVG"** to edit existing diagrams

> **The interface** has a **toolbar** across the top, the **source panel** (JSON) on the left, and the **canvas** on the right. Drag the divider between them to resize, or use the toolbar's pane toggle (top-left) to hide the source and give the canvas full width. Toolbar actions include **Render**, **Canonize** (reformat the JSON to the canonical guide style), **Fit** (fit the diagram to the canvas — see [Zoom and fit](#zoom-and-fit-the-canvas)), **Undo / Redo**, **Export SVG / PNG**, and **Load SVG**.

## Basic Concepts

Flowdrom diagrams consist of:
- **Lanes**: Vertical columns representing entities (processors, agents, memory, etc.). A lane name may use `|` for a line break in its label (e.g. `'Caching|Agent'`).
- **Messages**: Arrows between lanes showing communication
- **States**: Boxes showing state changes within lanes
- **Time**: Horizontal axis showing sequence of events
- **Lane Groups**: Visual grouping of related lanes
- **Info Boxes**: Annotations explaining specific events

### Lane Positioning and Manual Adjustment

- By default, lanes are spaced evenly.
- To manually shift a lane horizontally, prefix its name with `>` (right) or `<` (left). Each symbol shifts by 20 pixels.
  - Example: `>CA0` shifts CA0 right by 20px, `<<CA1` shifts CA1 left by 40px.
- This affects all diagram elements referencing that lane (messages, states, info boxes, groups).

## The Graphical Editor

The rendered diagram is **interactive** — you can build and edit it directly on the canvas, and every change is written back to the JSON (and vice-versa). The diagram looks exactly like a normal render until you interact with it.

> Tip: you don't have to choose between the two — mix graphical edits and JSON editing freely. Use **Undo / Redo** (the toolbar buttons, or **Ctrl/Cmd-Z** and **Ctrl/Cmd-Shift-Z** / **Ctrl-Y**) to step back and forth. These work whether your focus is on the canvas or the JSON panel, and each one re-renders the diagram.

## Feature Examples

### 1. Two-Lane Communication
#### Simple Two-Lane Communication
Let's start with the simplest possible diagram - two entities exchanging a message:

```js
{
  title: 'Hello world',
  lanes: ['Source', 'Target'],
  messages: [
    { path: 'Source->Target', label: 'Hello', fromTime: 0, toTime: 1 },
    { path: 'Target->Source', label: 'World', fromTime: 1, toTime: 2 }
  ]
}
```
![Hello-World](images/01-Hello-world.svg)


Adding color and style.

```js
{
  title: 'Basic Request-Response',
  lanes: ['Client', 'Server'],
  messages: [
    { path: 'Client->Server', label: 'Request', color: 'blue', style: 'solid', fromTime: 0, toTime: 1 },
    { path: 'Server->Client', label: 'Response', color: 'green', style: 'solid', fromTime: 1, toTime: 2 }
  ]
}
```

![Basic Request-Response](images/01-basic-request-response.svg)

This creates a simple sequence showing a client sending a request to a server and receiving a response.

#### Unordered Two-Lane Communication
Since flowdrom is not just a sequence graph generator but actually has timing parameters, it opens the possibilities to create unordered sequences / non linear sequences.

```js
{
  title: 'Unordered traffic',
  lanes: ['CA0', 'HN'],
  messages: [
    { path: 'CA0->HN', label: 'RdData(k1)', color: 'red', style: 'solid', fromTime: 0, toTime: 4 },
    { path: 'HN->CA0', label: 'Data (k1)', color: 'red', style: 'solid', fromTime: 4, toTime: 6 },
    { path: 'CA0->HN', label: 'RdData(k2)', color: 'purple', style: 'solid', fromTime: 0.5, toTime: 2 },
    { path: 'HN->CA0', label: 'Data (k2)', color: 'purple', style: 'solid', fromTime: 2, toTime: 7 }
  ]
}
```

![Unordered traffic](images/01-unordered-traffic.svg)

Here source and target sequences are different. 

#### Message Label Syntax

use '|' to create a multi line message label. In case of collisions (message label obscures another graph element) you can use prefix '>' or '<' in the label text to shift the message right or left accordingly along its arrow (can also use multiple for bigger distance '>>>label').

- Each `>` at the start of a label moves the label toward the arrow's end; each `<` moves it toward the start.
- This does not affect the arrow itself, only the label's position.

```js
{
  title: 'Request-Response with collision',
  lanes: ['Client', 'Server'],
  messages: [
    { path: 'Client->Server', label: 'Request', color: 'blue', style: 'solid', fromTime: 0, toTime: 1 },
    { path: 'Client->Server', label: '>ctl|msg', color: 'red', style: 'solid', fromTime: 0, toTime: 4 },
   { path: 'Server->Client', label: 'Response', color: 'green', style: 'solid', fromTime: 1, toTime: 2 }
  ]
}
```

![message syntax example](images/01-Request-Response-with-collision.svg)

>*message defaults*
>All given examples are full, however:
>If label is omitted the message would be arrow only
>If color is omitted the message would be black
>If style is omitted the style would be solid

#### Self messages & back arrows

A path can be written in either direction: `A->B` and `B<-A` mean the **same
message** (from A to B) — the back arrow just lets you write the receiver
first.

When both sides name the **same lane**, the message is a **self message**,
drawn as a rounded loop that leaves the lane at `fromTime` and returns at
`toTime`. The notation picks the side:

- `HN->HN` — loop on the **right** of the lane
- `HN<-HN` — loop on the **left**

The loop bulges 45px from the lane by default; set
`options: { graph: { selfMessageWidth: <px> } }` (or right-click → **Styling…**)
to change it for the whole diagram. Equal `fromTime`/`toTime` gives a compact
loop.

The label sits **on the loop's line** like any other message label — rotated to
read downward along the far segment. Start the label with `^` to flip it 90°
into a horizontal, always-upright label (same modifier as vertical state text:
`^` means "rotate 90° from the default").

```js
{
  title: 'Self messages',
  options: { graph: { selfMessageWidth: 60 } },
  lanes: ['CA', 'HN'],
  messages: [
    { path: 'CA->HN', label: 'Req',    color: 'blue',   style: 'solid',  fromTime: 0, toTime: 1 },
    { path: 'HN->HN', label: 'lookup', color: 'purple', style: 'solid',  fromTime: 1, toTime: 2 },
    { path: 'HN<-HN', label: '^retry', color: 'orange', style: 'dashed', fromTime: 2, toTime: 3 },
    { path: 'CA<-HN', label: 'Resp',   color: 'green',  style: 'solid',  fromTime: 3, toTime: 4 },
  ],
}
```

![Self messages](images/01-self-messages.svg)

### Building & editing on the canvas

Now that you've seen a diagram, here's how to build and edit one directly on the canvas — every change is written back to the JSON, and vice-versa.

#### Start a new diagram

Click **New** to start a fresh diagram. It walks you through two quick prompts — the **title**, then the **lane names** (comma-separated) — each pre-filled with a default you can accept by pressing **Enter**. The diagram opens with those lanes ready; build it up by right-clicking the canvas to add messages, states, and so on. (You can also type JSON directly in the source panel, or **Load SVG**.)

#### Select an item

- **Hover** over the canvas: the item under the pointer is **highlighted** and the cursor turns to a pointer, so you can see exactly what a click will select. Thin targets like legend lines have a **forgiving hit area** — you don't have to land on the stroke.
- **Left-click** the highlighted element — a message, state, info box, lane, lane group, legend entry, or the title — to open a small menu of actions for it. Where items overlap, the click acts on the highlighted (top) one; hover a different part to target another.
- **Double-click** an item to jump straight to its most common action — **Edit text** for a labelled item, **Rename** for a lane — skipping the menu.
- **Left-click empty space** clears the menu. **Esc** cancels any open menu, drag, or pending action.

#### Zoom and fit the canvas

- By default the diagram **fits the canvas width**, and re-fits automatically when the canvas changes size — resizing the window or dragging the divider between the source panel and the canvas.
- **Ctrl/Cmd + mouse-wheel** over the canvas **zooms the diagram** (centered on the pointer), scrolling within the canvas when you zoom in past its edges. This zooms only the diagram — not the toolbar or source panel — and takes over from auto-fit.
- The toolbar's **Fit** button snaps the diagram back to fit the canvas and **resumes auto-fit** on resize.

#### Move and edit existing items

Most items offer a **Drag** action that reveals draggable handles:

- **Message** — drag an endpoint handle to change its **time** (move vertically) or send it to **another lane** (move horizontally). Drag the handle on the **label** to slide it along the arrow.
- **State** — drag the **top/bottom** handles to resize (change start/end time) or the **middle** handle to move the whole box; drag sideways to change lane.
- **Info box** — drag the handle on the **box** to **reposition it**; drag the handle on the **anchor** (the lane/time point it connects to) to change what it points at.
- **Lane** — **Drag** the handle sideways: cross another lane to **reorder**, or move within its current slot to **nudge** its horizontal position.

> All editing handles and the selection outline use a single highlight color, so they're easy to tell apart from the diagram's own colors.

A message reveals a handle at each **endpoint** (change its time or lane) and one on its **label** (slide it along the arrow); a state reveals **top / middle / bottom** handles (resize from either end, or move the whole box):

![Message drag handles](images/editor-message-handles.svg)

![State drag handles](images/editor-state-handles.svg)

Times **snap to 0.1** steps while dragging — hold **Alt** for free placement.

Other actions in an item's menu:

- **Edit text** — label, info text, group name, or the diagram title. The editor is **multi-line**: **Enter** saves, **Alt+Enter** adds a line break (so you don't have to type `|` yourself), and the box grows to fit what you type.
- **Duplicate** — for messages, states, and info boxes, drops a copy one time-step below, selected so you can drag it into place; for a **legend entry** it appends an identical row.
- **Change color** and **Make dashed / Make solid** — for messages and legend entries. **Change color** opens a **palette** — colors already used by **that element type** first (e.g. existing state colors when coloring a state), then the rest of the palette, plus a **Custom…** field for any CSS color name or hex. **States** can take a color too (rendered as a soft tint).
- **Go to JSON definition** — selects that element in the JSON panel.
- **Delete**.
- For **lanes**: **Rename** (updates every reference automatically), **Make sub-lane of…** (then **click the parent lane**), **Make medium lane**, and **Delete lane** (also removes elements that referenced it). A sub-lane or medium lane instead offers **Make primary lane** to revert it (drops the parent, or the `_…_` medium markers).

#### Select multiple items

- **Drag a box** over empty canvas to select every message, state, and info box it **fully encloses** (items only partly inside the box aren't selected). You can also **Ctrl/Cmd-click** items to build up a selection one at a time.
- **Drag** anywhere inside the selection to shift all the selected items in time together.
- **Right-click** the selection for actions on the whole set: **Duplicate**, **Change color**, **Make dashed / Make solid**, and **Delete all**.

#### Add items

**Right-click** anywhere on the canvas to open the **Add** menu:

- **Message** / **State** — pick it, then **drag** on the canvas to draw it (between lanes, or down a lane). The element appears immediately, then you're guided through its fields, each applied live: the **label** in a text box, the **color** from the palette picker, and the line **style** from a solid/dashed menu (same controls as editing an existing item). You can stop at any point — what you've set so far stays.
- **Info box** — pick it, then **click a lane** at the time you want, and enter its text.
- **Lane** — adds a lane at the clicked position (you give it a name).
- **Legend entry** — adds a legend line: enter its label, then pick a color and a solid/dashed style.
- **Lane group (select lanes)** — then click the lanes to include and press **Create**.
- **Styling…** — opens a panel to set per-element text size/color and whole-diagram **graph styling** (this edits the `options` block; see [Styling & Options](#styling--options)).

> Note: JSON **comments are not supported**. Graphical edits may not behave correctly if the JSON in the editor contains comments.

### 2. Adding States

Now let's add state changes to show what happens inside each entity:

```js
{
  title: 'Request-Response with States',
  lanes: ['Client', 'Server'],
  messages: [
    { path: 'Client->Server', label: 'Request', color: 'blue', style: 'solid', fromTime: 0, toTime: 1 },
    { path: 'Server->Client', label: 'Response', color: 'green', style: 'solid', fromTime: 2, toTime: 3 }
  ],
  states: [
    { lane: 'Client', label: 'Waiting', color: 'yellow', fromTime: 1, toTime: 3 },
    { lane: 'Server', label: 'Processing', color: 'orange', fromTime: 1, toTime: 2 }
  ]
}
```

![Request response states](images/02-request-response-states.svg)

The states show that the client waits while the server processes the request.

#### Thin & nested states (activation bars)

A state normally sizes its box to the label text. Three additions let you draw
activation-style bars and sub-states:

- **`width: <px>`** — overrides the automatic sizing (omit it for the regular
  behavior). A small width gives a thin bar that reads as "this lane is
  busy/blocked" without covering its surroundings.
- **`^` label prefix** — renders the label vertically (reading bottom-up), the
  natural fit for a thin bar: `label: '^block'` instead of `'b|l|o|c|k'`.
- **Nesting** — a state fully inside another state's time range on the same
  lane draws on top of it, so you can show a sub-state (e.g. a blocked window
  inside a longer busy period). **Arrange** keeps nested states in place; only
  partially-overlapping same-lane states are treated as a data error and pushed
  apart.

```js
{
  title: 'Snoop blocked during busy window',
  lanes: ['CA0', 'HN'],
  messages: [
    { path: 'CA0->HN', label: 'Snp', color: 'purple', style: 'solid', fromTime: 1, toTime: 2 },
    { path: 'HN->CA0', label: 'SnpResp', color: 'green', style: 'solid', fromTime: 5, toTime: 6 },
  ],
  states: [
    { lane: 'HN', label: 'busy', color: 'yellow', fromTime: 0, toTime: 6 },
    { lane: 'HN', label: '^block', color: 'red', width: 14, fromTime: 3.5, toTime: 5 },
  ],
}
```

![Thin and nested states](images/02-thin-nested-states.svg)

### 3. Multi-Lane Systems

Real systems often involve multiple components. Here's a three-lane system:

```js
{
  title: 'Three-Tier Architecture',
  lanes: ['Frontend', 'Backend', 'Database'],
  messages: [
    { path: 'Frontend->Backend', label: 'API Call', color: 'blue', style: 'solid', fromTime: 0, toTime: 1 },
    { path: 'Backend->Database', label: 'Query', color: 'purple', style: 'solid', fromTime: 1, toTime: 2 },
    { path: 'Database->Backend', label: 'Results', color: 'orange', style: 'solid', fromTime: 3, toTime: 4 },
    { path: 'Backend->Frontend', label: 'JSON Response', color: 'green', style: 'solid', fromTime: 4, toTime: 5 }
  ],
  states: [
    { lane: 'Backend', label: 'Processing', color: 'yellow', fromTime: 1, toTime: 4 },
    { lane: 'Database', label: 'Query Execution', color: 'cyan', fromTime: 2, toTime: 3 }
  ]
}
```

![multi lane diagram](images/03-three-tier-architecture.svg)

This shows a typical web application flow: frontend → backend → database → backend → frontend.

### 4. Lane Groups

For complex systems, you can group related lanes visually:

```js
{
  title: 'Microservices Architecture',
  lanes: ['Client', 'API Gateway', 'Auth Service', 'User Service', 'Database'],
  laneGroups: [
    { label: 'Client Layer', lanes: ['Client'] },
    { label: 'Service Layer', lanes: ['API Gateway','Auth Service','User Service'] },
    { label: 'Data Layer', lanes: ['Database'] }
  ],
  messages: [
    { path: 'Client->API Gateway', label: 'Login Request', color: 'blue', style: 'solid', fromTime: 0, toTime: 1 },
    { path: 'API Gateway->Auth Service', label: 'Validate', color: 'purple', style: 'solid', fromTime: 1, toTime: 2 },
    { path: 'Auth Service->User Service', label: 'Get User', color: 'orange', style: 'solid', fromTime: 2, toTime: 3 },
    { path: 'User Service->Database', label: 'Query User', color: 'red', style: 'solid', fromTime: 3, toTime: 4 }
  ]
}
```

![grouping lanes together](images/04-microservices-groups.svg)

Lane groups help organize complex diagrams by showing architectural boundaries.

### 5. Frames (interaction scopes)

**Frames** draw a PlantUML-style bordered region — with a cut-corner label tab —
around a rectangle of lanes and time. Use them to scope a `loop`, `alt`, `opt`,
a conflict window, or any "these events belong together" annotation. The
interior is transparent, so a frame scopes without hiding what's inside.

```js
{
  title: 'Retry loop',
  lanes: ['CA0', 'HN'],
  frames: [
    { label: 'loop: until ack', lanes: ['CA0', 'HN'], fromTime: 1, toTime: 4 }
  ],
  messages: [
    { path: 'CA0->HN', label: 'Req',  color: 'blue',  style: 'solid',  fromTime: 1, toTime: 2 },
    { path: 'HN->CA0', label: 'Nack', color: 'red',   style: 'dashed', fromTime: 2, toTime: 3 },
    { path: 'CA0->HN', label: 'Req',  color: 'blue',  style: 'solid',  fromTime: 3, toTime: 4 },
  ],
}
```

![Frames](images/05-frames.svg)

- **`label`** — shown in the tab at the top-left (e.g. `loop`, `alt [x > 0]`, `opt`).
- **`lanes`** — the frame spans from its leftmost to its rightmost listed lane.
- **`fromTime` / `toTime`** — the vertical (time) extent; the edges sit exactly on these times.
- **`background`** *(optional)* — a fill color, drawn as a light wash so it tints without hiding content.
- **`lMargin` / `rMargin`** *(optional)* — px beyond the leftmost / rightmost lane (default 40 each).

In the editor: right-click → **Frame (drag across lanes)**, then drag a box over
the lanes and time you want (you're prompted only for the label — margins keep
their defaults). Select a frame by its **border or tab** to drag it (move in
time), stretch its edges (top/bottom change the time span; left/right change the
side margin and cross lanes to grow/shrink the span), edit the label, set a
background color, or adjust the left/right margins. **Arrange** moves frames
along with the diagram so they keep scoping the same events.

### 6. Time gaps (elapsed time)

A **time gap** marks a stretch where a lot of time passes that isn't drawn to
scale — something happens, then "three weeks later" something else does. Across
the gap's time window **every lifeline goes dashed**, with an optional centered
label. Place the before/after events close together in time and let the gap
carry the "not to scale" meaning.

```js
{
  lanes: ['Client', 'Server'],
  timeGaps: [
    { fromTime: 3, toTime: 4.5, label: '≈ 3 weeks later' }
  ],
  messages: [
    { path: 'Client->Server', label: 'sign up',  fromTime: 1, toTime: 2 },
    { path: 'Server->Client', label: 'welcome',   fromTime: 2, toTime: 3 },
    { path: 'Client->Server', label: 'first login', fromTime: 5, toTime: 6 },
  ],
}
```

![Time gaps](images/06-time-gaps.svg)

- **`fromTime` / `toTime`** — the time window; every lane dashes between them.
- **`label`** *(optional)* — a centered caption naming the elapsed time. Supports
  `|` line breaks; the label frame grows to fit the widest line and the height.
- **`background`** *(optional)* — a light tint wash across the whole band.

The label uses the same typeface as lane labels; set its size/color via
`options.timeGap.{textSize,textColor}` (see [Styling & Options](#styling--options)).
Two **global** toggles in the Styling panel (under `options.graph`) apply to every
gap: *Stretch time-gap labels across all lanes* (`timeGapLabelPan`) makes labels
full-width bars, and *Hide the time grid inside time gaps* (`timeGapHideGrid`)
drops the grid inside each window — reinforcing that the stretch isn't to scale.

In the editor: right-click → **Time gap (drag a time span)**, then drag over the
time range (the width always spans all lanes; you're prompted only for the
optional label). Grab either **horizontal edge** (or the tint band / label) to
select it — drag the top/bottom edges to resize the window, the center to move
it, and use the menu to edit the label or set a tint. Like frames, **Arrange**
re-times gaps along with the diagram.

### 7. Information Boxes

Add contextual information with info boxes:

```js
{
  title: 'Error Handling Example',
  lanes: ['Client', 'Server', 'Database'],
  infoBoxes: [
    { lane: 'Server', time: 2, text: '<130,30>Connection timeout|Retry with |exponential backoff' },
    { lane: 'Client', time: 4, text: '<-80,0>Display |error message|to user' }
  ],
  messages: [
    { path: 'Client->Server', label: 'Data Request', color: 'blue', style: 'solid', fromTime: 0, toTime: 1 },
    { path: 'Server->Database', label: 'Query', color: 'purple', style: 'solid', fromTime: 1, toTime: 2 },
    { path: 'Server->Client', label: 'Timeout Error', color: 'red', style: 'dashed', fromTime: 3, toTime: 4 }
  ],
  states: [
    { lane: 'Server', label: 'Error State', color: 'red', fromTime: 2, toTime: 3 }
  ]
}
```

![Adding info boxes for clarity](images/05-error-handling-info.svg)

Info boxes provide additional context about what's happening at specific points in time. Use `|` for line breaks in the text.

Info box placement
- The renderer places info boxes using a simple explicit offset mechanism. By default an info box is drawn upper-right of the lane/time anchor using offsets x=50, y=-50 (pixels).
- To request a specific placement, prefix the info box text with an offset in the form `<x,y>` where x and y are integer pixel offsets. Example:
```js
{ lane: 'Server', time: 2, text: '<8,-4>Connection timeout|Retry with backoff' }
```
  - Positive x shifts the box to the right; negative x shifts it left.
  - Positive y shifts the box down; negative y shifts it up.
- How the offset is applied:
  - The anchor point is the lane X coordinate and the time Y coordinate (anchorY = laneTop + time * timeStep).
  - The box center is computed as (laneX + xOffset, anchorY + yOffset) before subtracting half the box width/height.
  - The connector line is drawn from the lane/time anchor to the nearest vertical edge of the info box (right edge if the box is to the right of the lane, left edge if to the left).
- If no `<x,y>` prefix is present the renderer uses the default `<50,-50>`.
- Notes:
  - The renderer does not currently perform advanced collision avoidance for info boxes — if boxes/labels overlap, adjust offsets manually.
  - Offsets must be provided as integers in pixels and placed at the very start of the `text` string (no leading spaces).

### 8. Complex Transactions

Here's an advanced example showing 2 new features of lanes by using a different name syntax:
1. Sublanes: handy for showing a sub-component's interaction with the system. A sublane is named **`Parent.Sub`** (parent first) — e.g. for lane `HN`, a sublane is `HN.MEM`. Its **side is determined by array order**, not by the name: list the sublane *after* its parent to place it on the parent's right, or *before* the parent to place it on the left (multiple sublanes on a side stack outward). In the graphical editor you can simply drag a sublane across its parent to flip sides. (Older diagrams that used the reverse `Sub.Parent` form are migrated to `Parent.Sub` automatically on load.)

2. Medium: this is handy when describing a medium through a message may pass. This is done using underscores on both sides - "\_Lane\_"

```js
{
  title: 'Cache Coherency Conflict',
  lanes: ['CA0', '_D2D_', 'CA1', 'HN', 'HN.MEM'],
  laneGroups: [
    { label: 'Caching Agents', lanes: ['CA0','CA1'] },
    { label: 'System', lanes: ['HN','HN.MEM'] }
  ],
  infoBoxes: [
    { lane: 'HN', time: 2, text: 'Conflict detected|serialize requests' }
  ],
  messages: [
    { path: 'CA0->HN', label: 'Read|Unique(A)', color: 'red', style: 'solid', fromTime: 0, toTime: 1 },
    { path: 'CA1->HN', label: 'Read|Unique(A)', color: 'red', style: 'dashed', fromTime: 1, toTime: 2 },
    { path: 'HN->HN.MEM', label: 'Rd(A)', color: 'orange', style: 'solid', fromTime: 2, toTime: 3 },
    { path: 'HN.MEM->HN', label: 'D(A)', color: 'orange', style: 'solid', fromTime: 4, toTime: 5.5 },
    { path: 'HN->CA1', label: 'SnpInvalid(A)', color: 'purple', style: 'solid', fromTime: 2, toTime: 4 },
    { path: 'CA1->HN', label: 'SnpResp(I)', color: 'green', style: 'solid', fromTime: 4, toTime: 6 },
    { path: 'HN->CA0', label: 'CompData(A)', color: 'blue', style: 'solid', fromTime: 6, toTime: 7 },
    { path: 'HN->CA1', label: 'Retry', color: 'red', style: 'dashed', fromTime: 7, toTime: 8 }
  ],
  states: [
    { lane: 'CA0', label: 'I->UD', color: 'yellow', fromTime: 0, toTime: 0.5 },
    { lane: 'CA1', label: 'S->I', color: 'orange', fromTime: 4, toTime: 4.5 },
    { lane: 'HN', label: 'Conflict', color: 'red', fromTime: 2, toTime: 7 }
  ]
}
```

![advanced graph](images/06-cache-coherency-conflict.svg)

This complex example shows how two caching agents conflict when trying to access the same memory address simultaneously.

### 9. Legends

Add legends to explain your color coding:

```js
{
  title: 'Protocol Messages with Legend',
  lanes: ['Client', 'Router', 'Server'],
  messages: [
    { path: 'Client->Router', label: 'HTTP GET', color: 'blue', style: 'solid', fromTime: 0, toTime: 1 },
    { path: 'Router->Server', label: 'Forward', color: 'green', style: 'solid', fromTime: 1, toTime: 2 },
    { path: 'Server->Router', label: 'HTTP 200', color: 'purple', style: 'solid', fromTime: 2, toTime: 3 },
    { path: 'Router->Client', label: 'Response', color: 'orange', style: 'solid', fromTime: 3, toTime: 4 }
  ],
  legend: [
    { label: 'Request', color: 'blue', style: 'solid' },
    { label: 'Forward', color: 'green', style: 'solid' },
    { label: 'Response', color: 'purple', style: 'solid' },
    { label: 'Delivery', color: 'orange', style: 'solid' }
  ]
}
```

![legends](images/07-protocol-with-legend.svg)

Legends help readers understand what different colors and line styles represent.

## Styling & Options

The optional `options` object controls the **size** and **color** of each kind of text in the diagram. It is part of the diagram definition (just like `lanes` or `messages`), so it is saved with **Export SVG**, restored by **Load SVG**, and respected by any application that renders a Flowdrom config — not just the editor page.

Each configurable text entity is a key under `options`, holding a `textSize` and/or a `textColor`:

```js
options: {
  lane:        { textSize: 18, textColor: '#2a5eb2' },  // lane titles
  subLane:     { textSize: 12, textColor: '#2a5eb2' },  // sub-lane titles (a.b lanes)
  laneGroup:   { textSize: 14, textColor: '#6699cc' },  // lane group brackets
  message:     { textSize: 15, textColor: 'default' },  // message labels
  info:        { textSize: 12, textColor: '#333'    },  // info box text
  legend:      { textSize: 27, textColor: 'default' },  // legend item labels
  legendTitle: { textSize: 16, textColor: '#2a5eb2' },  // the word "Legend"
  state:       { textSize: 11, textColor: 'black'   },  // state box labels
  time:        { textSize: 12, textColor: '#666'    },  // T0, T1, ... time labels
  title:       { textSize: 24, textColor: '#2a5eb2' },  // the diagram title
  frame:       { textSize: 13, textColor: '#666'    },  // frame label tabs
  timeGap:     { textSize: 13, textColor: '#6b7280' },  // time-gap labels
}
```

The values above are the **defaults** — the example simply spells them out. You only need to list the entities you want to change.

- **`textSize`** — a number, in pixels. The placement logic re-flows boxes and labels around whatever size you choose, so the diagram stays readable.
- **`textColor`** — any CSS color (named or hex). For **`message`** and **`legend`**, the default `'default'` keeps each label the same color as its own arrow/entry; set a specific color to recolor them all. The other entities default to the fixed color shown above.
- Either field may be the literal string **`'default'`** (or simply omitted) to use that entity's built-in default value.

Example — bigger, high-contrast lanes and messages while leaving everything else default:

```js
{
  title: 'Custom Text Styling',
  options: {
    lane:    { textSize: 22, textColor: '#000' },
    message: { textSize: 18, textColor: 'default' }
  },
  lanes: ['CA0', 'HN'],
  messages: [
    { path: 'CA0->HN', label: 'ReadUnique(A)', color: 'red', style: 'solid', fromTime: 0, toTime: 1 }
  ]
}
```

### In the editor

Add the `options` object to your config in the JSON panel and click **Render**. Type `options` in the editor for an autocomplete snippet to get started. Because the setting lives in the config, it round-trips through Export/Load SVG.

You can also set it visually: right-click the canvas → **Styling…** opens a panel with a size/color field per element type (plus the **Graph styling** options below).

### Make it persistent (apply to every graph)

The Styling panel has a **Make persistent** toggle. When on, your current styling is saved in the browser and automatically applied to every graph you create or open — so you don't have to re-set it each time. Editing a field while it's on updates the saved styling too; turning it off forgets it.

Because persistence would otherwise silently change a diagram that has its own styling, Flowdrom asks first: when you **Load SVG** (or hand-edit the styling and press **Render**) and the diagram's styling differs from your saved one, a prompt lets you **keep the diagram's** styling or **use your saved** styling. Persistence covers **all** of the Styling panel — text styling and graph styling alike.

### Graph styling

A separate **`options.graph`** block holds whole-diagram layout aids. They're **off by default**, and — like text styling — they're part of the config, so they round-trip through Export/Load SVG and are honored by any renderer (the editor and the exported SVG always match).

```js
options: {
  graph: {
    repeatLaneLabels: true,   // repeat each lane name down the page + below its lifeline
    laneLabelInterval: 6,     // ...every N TIME units (default 5)
    opacity: 0.5,             // 0–1: how faint the repeated labels are (default 0.5)
    labelStyle: 'outline',    // 'outline' | 'white' | 'solid' (default 'outline')
    uniformStateWidth: true,  // make every state box in a lane as wide as that lane's widest
    selfMessageWidth: 70,     // self-message loop distance from the lane, px (default 60)
    laneSpacing: 320,         // lane-to-lane distance in px (default 250)
    autonumber: true          // prefix each message label with a sequence number
  }
}
```

- **`repeatLaneLabels`** — for tall diagrams, repeats each lane's name at a fixed vertical interval (and once below its lifeline) so you can tell lanes apart when scrolled away from the top. The repeats use an outlined "word-art" style and are drawn on top, so they stay legible over messages and states. They're purely visual — not editable handles.
- **`laneLabelInterval`** — spacing between repeats, in **time units** (the same scale as `fromTime`/`toTime`), so it tracks the diagram's own grid.
- **`opacity`** — fades the repeated labels (0 = invisible, 1 = solid).
- **`labelStyle`** — how the repeated labels are drawn so they read as a distinct guide: `'outline'` (hollow colored letters), `'white'` (white letters with a colored outline), or `'solid'` (colored letters with a white halo). Default `'outline'`.
- **`uniformStateWidth`** — widens every state box in a lane to match that lane's widest state, so a lane's states line up as a neat column. The width is computed per lane.
- **`selfMessageWidth`** — how far a [self message's](#self-messages--back-arrows) loop bulges from its lane, in px (default 60). One knob for the whole diagram, so loops stay visually consistent.
- **`autonumber`** — prefixes each message label with a sequence number, ordered by start time (ties broken by definition order). Computed at render time, so numbers stay correct as you add, reorder, or re-time messages — they're never written into the label text.
- **`laneSpacing`** — the horizontal distance between main lanes in px (default 250). The [PlantUML importer](#importing-from-plantuml) raises it automatically when long message labels wouldn't fit their arrows; hand-authored diagrams keep the default unless you set it.

Set these visually under right-click → **Styling…** → **Graph styling**, or edit the `options.graph` block directly.

> Persistence is stored per browser (it doesn't follow you across machines or browsers), and private/incognito windows forget it when closed.

## Importing from PlantUML

Already have a PlantUML **sequence diagram**? Copy its text (the whole
`@startuml … @enduml` block) and click **Paste** in the source panel — Flowdrom
detects PlantUML and converts it to flowdrom JSON automatically, then renders it.
From there it's a normal flowdrom diagram: drag arrows off horizontal to show
real latency, tidy it with **Arrange**, and add timing that PlantUML can't express.

What's converted:

| PlantUML | becomes |
|---|---|
| `participant/actor/database…"Name" as X` | a **lane** (referenced by its display name) |
| `A -> B : label`, `A --> B` (dashed), `A -[#red]> B` | a **message** (color + solid/dashed) |
| `A -> A` | a **self message** |
| `A <- B` | the same as `B -> A` |
| `activate A` / `deactivate A` | a thin **state** (activation bar) |
| `note over/left/right A : text` | an **info box** |
| `alt … else … end`, `loop`, `opt`, `par`, `group` | **frames** (alt/else become two stacked frames) |
| `...` / `...text...` (delay) | a **time gap** (dashed window; text becomes the label) |
| `\|\|\|` / `\|\|N\|\|` (spacer) | blank vertical space (no marker) |
| `box "Layer" … end box` | a **lane group** |
| `autonumber` | message numbering (`options.graph.autonumber`) |
| `title` | the diagram title |

Because PlantUML is order-based and Flowdrom is time-based, each message is
placed at the next whole time step (a horizontal arrow) — order is preserved,
and you add real timing afterward. Anything the importer can't map is **skipped,
not dropped silently**: the Paste button reports how many lines were skipped and
lists them in the browser console. (`skinparam`, themes, and `create/destroy`
are not converted in this version.)

## HTML / CSS named colors

You can use any standard HTML/CSS named color in your diagrams (for message colors, state backgrounds, legends, etc.). Below is the complete list of named colors and their hexadecimal values — copy the color name (for example `red` or `RebeccaPurple`) into your diagram JSON's `color` field. On GitHub Pages the table will also display a small color swatch for each name.

| Swatch | Name | Hex |
|:---:|---|---:|
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F0F8FF;vertical-align:middle"></span> | AliceBlue | #F0F8FF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FAEBD7;vertical-align:middle"></span> | AntiqueWhite | #FAEBD7 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#00FFFF;vertical-align:middle"></span> | Aqua | #00FFFF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#7FFFD4;vertical-align:middle"></span> | Aquamarine | #7FFFD4 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F0FFFF;vertical-align:middle"></span> | Azure | #F0FFFF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F5F5DC;vertical-align:middle"></span> | Beige | #F5F5DC |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFE4C4;vertical-align:middle"></span> | Bisque | #FFE4C4 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#000000;vertical-align:middle"></span> | Black | #000000 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFEBCD;vertical-align:middle"></span> | BlanchedAlmond | #FFEBCD |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#0000FF;vertical-align:middle"></span> | Blue | #0000FF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#8A2BE2;vertical-align:middle"></span> | BlueViolet | #8A2BE2 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#A52A2A;vertical-align:middle"></span> | Brown | #A52A2A |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#DEB887;vertical-align:middle"></span> | BurlyWood | #DEB887 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#5F9EA0;vertical-align:middle"></span> | CadetBlue | #5F9EA0 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#7FFF00;vertical-align:middle"></span> | Chartreuse | #7FFF00 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#D2691E;vertical-align:middle"></span> | Chocolate | #D2691E |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FF7F50;vertical-align:middle"></span> | Coral | #FF7F50 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#6495ED;vertical-align:middle"></span> | CornflowerBlue | #6495ED |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFF8DC;vertical-align:middle"></span> | Cornsilk | #FFF8DC |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#DC143C;vertical-align:middle"></span> | Crimson | #DC143C |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#00FFFF;vertical-align:middle"></span> | Cyan | #00FFFF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#00008B;vertical-align:middle"></span> | DarkBlue | #00008B |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#008B8B;vertical-align:middle"></span> | DarkCyan | #008B8B |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#B8860B;vertical-align:middle"></span> | DarkGoldenRod | #B8860B |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#A9A9A9;vertical-align:middle"></span> | DarkGray | #A9A9A9 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#A9A9A9;vertical-align:middle"></span> | DarkGrey | #A9A9A9 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#006400;vertical-align:middle"></span> | DarkGreen | #006400 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#BDB76B;vertical-align:middle"></span> | DarkKhaki | #BDB76B |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#8B008B;vertical-align:middle"></span> | DarkMagenta | #8B008B |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#556B2F;vertical-align:middle"></span> | DarkOliveGreen | #556B2F |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FF8C00;vertical-align:middle"></span> | DarkOrange | #FF8C00 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#9932CC;vertical-align:middle"></span> | DarkOrchid | #9932CC |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#8B0000;vertical-align:middle"></span> | DarkRed | #8B0000 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#E9967A;vertical-align:middle"></span> | DarkSalmon | #E9967A |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#8FBC8F;vertical-align:middle"></span> | DarkSeaGreen | #8FBC8F |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#483D8B;vertical-align:middle"></span> | DarkSlateBlue | #483D8B |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#2F4F4F;vertical-align:middle"></span> | DarkSlateGray | #2F4F4F |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#2F4F4F;vertical-align:middle"></span> | DarkSlateGrey | #2F4F4F |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#00CED1;vertical-align:middle"></span> | DarkTurquoise | #00CED1 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#9400D3;vertical-align:middle"></span> | DarkViolet | #9400D3 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FF1493;vertical-align:middle"></span> | DeepPink | #FF1493 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#00BFFF;vertical-align:middle"></span> | DeepSkyBlue | #00BFFF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#696969;vertical-align:middle"></span> | DimGray | #696969 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#696969;vertical-align:middle"></span> | DimGrey | #696969 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#1E90FF;vertical-align:middle"></span> | DodgerBlue | #1E90FF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#B22222;vertical-align:middle"></span> | FireBrick | #B22222 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFFAF0;vertical-align:middle"></span> | FloralWhite | #FFFAF0 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#228B22;vertical-align:middle"></span> | ForestGreen | #228B22 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FF00FF;vertical-align:middle"></span> | Fuchsia | #FF00FF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#DCDCDC;vertical-align:middle"></span> | Gainsboro | #DCDCDC |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F8F8FF;vertical-align:middle"></span> | GhostWhite | #F8F8FF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFD700;vertical-align:middle"></span> | Gold | #FFD700 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#DAA520;vertical-align:middle"></span> | GoldenRod | #DAA520 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#808080;vertical-align:middle"></span> | Gray | #808080 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#808080;vertical-align:middle"></span> | Grey | #808080 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#008000;vertical-align:middle"></span> | Green | #008000 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#ADFF2F;vertical-align:middle"></span> | GreenYellow | #ADFF2F |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F0FFF0;vertical-align:middle"></span> | HoneyDew | #F0FFF0 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FF69B4;vertical-align:middle"></span> | HotPink | #FF69B4 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#CD5C5C;vertical-align:middle"></span> | IndianRed | #CD5C5C |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#4B0082;vertical-align:middle"></span> | Indigo | #4B0082 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFFFF0;vertical-align:middle"></span> | Ivory | #FFFFF0 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F0E68C;vertical-align:middle"></span> | Khaki | #F0E68C |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#E6E6FA;vertical-align:middle"></span> | Lavender | #E6E6FA |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFF0F5;vertical-align:middle"></span> | LavenderBlush | #FFF0F5 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#7CFC00;vertical-align:middle"></span> | LawnGreen | #7CFC00 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFFACD;vertical-align:middle"></span> | LemonChiffon | #FFFACD |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#ADD8E6;vertical-align:middle"></span> | LightBlue | #ADD8E6 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F08080;vertical-align:middle"></span> | LightCoral | #F08080 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#E0FFFF;vertical-align:middle"></span> | LightCyan | #E0FFFF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FAFAD2;vertical-align:middle"></span> | LightGoldenRodYellow | #FAFAD2 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#D3D3D3;vertical-align:middle"></span> | LightGray | #D3D3D3 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#D3D3D3;vertical-align:middle"></span> | LightGrey | #D3D3D3 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#90EE90;vertical-align:middle"></span> | LightGreen | #90EE90 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFB6C1;vertical-align:middle"></span> | LightPink | #FFB6C1 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFA07A;vertical-align:middle"></span> | LightSalmon | #FFA07A |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#20B2AA;vertical-align:middle"></span> | LightSeaGreen | #20B2AA |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#87CEFA;vertical-align:middle"></span> | LightSkyBlue | #87CEFA |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#778899;vertical-align:middle"></span> | LightSlateGray | #778899 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#778899;vertical-align:middle"></span> | LightSlateGrey | #778899 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#B0C4DE;vertical-align:middle"></span> | LightSteelBlue | #B0C4DE |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFFFE0;vertical-align:middle"></span> | LightYellow | #FFFFE0 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#00FF00;vertical-align:middle"></span> | Lime | #00FF00 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#32CD32;vertical-align:middle"></span> | LimeGreen | #32CD32 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FAF0E6;vertical-align:middle"></span> | Linen | #FAF0E6 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FF00FF;vertical-align:middle"></span> | Magenta | #FF00FF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#800000;vertical-align:middle"></span> | Maroon | #800000 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#66CDAA;vertical-align:middle"></span> | MediumAquaMarine | #66CDAA |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#0000CD;vertical-align:middle"></span> | MediumBlue | #0000CD |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#BA55D3;vertical-align:middle"></span> | MediumOrchid | #BA55D3 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#9370DB;vertical-align:middle"></span> | MediumPurple | #9370DB |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#3CB371;vertical-align:middle"></span> | MediumSeaGreen | #3CB371 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#7B68EE;vertical-align:middle"></span> | MediumSlateBlue | #7B68EE |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#00FA9A;vertical-align:middle"></span> | MediumSpringGreen | #00FA9A |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#48D1CC;vertical-align:middle"></span> | MediumTurquoise | #48D1CC |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#C71585;vertical-align:middle"></span> | MediumVioletRed | #C71585 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#191970;vertical-align:middle"></span> | MidnightBlue | #191970 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F5FFFA;vertical-align:middle"></span> | MintCream | #F5FFFA |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFE4E1;vertical-align:middle"></span> | MistyRose | #FFE4E1 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFE4B5;vertical-align:middle"></span> | Moccasin | #FFE4B5 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFDEAD;vertical-align:middle"></span> | NavajoWhite | #FFDEAD |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#000080;vertical-align:middle"></span> | Navy | #000080 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FDF5E6;vertical-align:middle"></span> | OldLace | #FDF5E6 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#808000;vertical-align:middle"></span> | Olive | #808000 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#6B8E23;vertical-align:middle"></span> | OliveDrab | #6B8E23 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFA500;vertical-align:middle"></span> | Orange | #FFA500 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FF4500;vertical-align:middle"></span> | OrangeRed | #FF4500 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#DA70D6;vertical-align:middle"></span> | Orchid | #DA70D6 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#EEE8AA;vertical-align:middle"></span> | PaleGoldenRod | #EEE8AA |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#98FB98;vertical-align:middle"></span> | PaleGreen | #98FB98 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#AFEEEE;vertical-align:middle"></span> | PaleTurquoise | #AFEEEE |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#DB7093;vertical-align:middle"></span> | PaleVioletRed | #DB7093 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFEFD5;vertical-align:middle"></span> | PapayaWhip | #FFEFD5 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFDAB9;vertical-align:middle"></span> | PeachPuff | #FFDAB9 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#CD853F;vertical-align:middle"></span> | Peru | #CD853F |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFC0CB;vertical-align:middle"></span> | Pink | #FFC0CB |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#DDA0DD;vertical-align:middle"></span> | Plum | #DDA0DD |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#B0E0E6;vertical-align:middle"></span> | PowderBlue | #B0E0E6 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#800080;vertical-align:middle"></span> | Purple | #800080 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#663399;vertical-align:middle"></span> | RebeccaPurple | #663399 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FF0000;vertical-align:middle"></span> | Red | #FF0000 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#BC8F8F;vertical-align:middle"></span> | RosyBrown | #BC8F8F |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#4169E1;vertical-align:middle"></span> | RoyalBlue | #4169E1 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#8B4513;vertical-align:middle"></span> | SaddleBrown | #8B4513 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FA8072;vertical-align:middle"></span> | Salmon | #FA8072 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F4A460;vertical-align:middle"></span> | SandyBrown | #F4A460 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#2E8B57;vertical-align:middle"></span> | SeaGreen | #2E8B57 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFF5EE;vertical-align:middle"></span> | SeaShell | #FFF5EE |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#A0522D;vertical-align:middle"></span> | Sienna | #A0522D |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#C0C0C0;vertical-align:middle"></span> | Silver | #C0C0C0 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#87CEEB;vertical-align:middle"></span> | SkyBlue | #87CEEB |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#6A5ACD;vertical-align:middle"></span> | SlateBlue | #6A5ACD |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#708090;vertical-align:middle"></span> | SlateGray | #708090 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#708090;vertical-align:middle"></span> | SlateGrey | #708090 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFFAFA;vertical-align:middle"></span> | Snow | #FFFAFA |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#00FF7F;vertical-align:middle"></span> | SpringGreen | #00FF7F |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#4682B4;vertical-align:middle"></span> | SteelBlue | #4682B4 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#D2B48C;vertical-align:middle"></span> | Tan | #D2B48C |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#008080;vertical-align:middle"></span> | Teal | #008080 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#D8BFD8;vertical-align:middle"></span> | Thistle | #D8BFD8 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FF6347;vertical-align:middle"></span> | Tomato | #FF6347 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#40E0D0;vertical-align:middle"></span> | Turquoise | #40E0D0 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#EE82EE;vertical-align:middle"></span> | Violet | #EE82EE |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F5DEB3;vertical-align:middle"></span> | Wheat | #F5DEB3 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFFFFF;vertical-align:middle"></span> | White | #FFFFFF |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#F5F5F5;vertical-align:middle"></span> | WhiteSmoke | #F5F5F5 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#FFFF00;vertical-align:middle"></span> | Yellow | #FFFF00 |
| <span style="display:inline-block;width:1.2em;height:1.2em;border:1px solid #ccc;background:#9ACD32;vertical-align:middle"></span> | YellowGreen | #9ACD32 |

## JSON Schema Reference

### Root Object
```js
{
  title: 'string',           // Diagram title
  options: {...},            // Optional display options (see below)
  lanes: ['string'],         // Array of lane names
  laneGroups: [...],         // Optional lane groupings
  messages: [...],           // Message arrows
  states: [...],             // State changes
  infoBoxes: [...],          // Information annotations
  legend: [...]              // Legend entries
}
```

### Options Object
All optional — omit `options` entirely for the standard look. See [Styling & Options](#styling--options) for full details and defaults. Two parts:

```js
{
  // Per-entity TEXT styling: one key per text entity, each { textSize, textColor }.
  // Entities: lane, subLane, laneGroup, message, info, legend, legendTitle, state, time, title.
  // Any field may be the string 'default' (or omitted) for that entity's built-in default.
  lane: { textSize: 18, textColor: '#2a5eb2' },   // e.g.

  // Whole-diagram GRAPH styling (all off / defaulted unless set):
  graph: {
    repeatLaneLabels: false,   // repeat lane names down tall diagrams (+ a bottom label)
    laneLabelInterval: 5,      // repeat spacing, in TIME units
    opacity: 0.5,              // 0–1, faintness of the repeated labels
    labelStyle: 'outline',     // 'outline' | 'white' | 'solid'
    uniformStateWidth: false   // widen every state box in a lane to that lane's widest
  }
}
```

### Message Object
```js
{
  path: 'Source->Target',    // Lane1->Lane2; 'Lane2<-Lane1' means the same message.
                             // Same lane on both sides = self message: 'A->A' loops
                             // right, 'A<-A' loops left (loop size:
                             // options.graph.selfMessageWidth).
  label: 'Message text',     // Use | for line breaks; lead with >/< to slide the label.
                             // Self messages: lead with ^ to flip the label horizontal.
  color: 'red',              // Any CSS color name or hex
  style: 'solid|dashed',     // Line style
  fromTime: 0,               // Start time (number)
  toTime: 1                  // End time (number)
}
```

### State Object
```js
{
  lane: 'LaneName',          // Which lane
  label: 'State Name',       // State description ('^' prefix renders it vertically)
  color: 'yellow',           // Background — any CSS color name or hex (rendered as a soft tint)
  width: 14,                 // Optional: fixed box width in px (omit = auto-size to the label)
  fromTime: 0,               // Start time
  toTime: 1                  // End time
}
```
> Note: state may have a single time (i.e. Start time = End time)
> The background is drawn as a light tint of the color you give, so the black label stays readable. `yellow, red, green, blue, orange, cyan, purple, pink` have hand-tuned pastels; any other color is auto-tinted.
> A state fully inside another state's time range on the same lane draws on top of it (a sub-state / activation bar — see [Thin & nested states](#thin--nested-states-activation-bars)).

### Lane Group Object
```js
{
  label: 'Group Name',       // Group title
  lanes: ['Lane1', 'Lane2']  // Lanes to group
}
```

### Frame Object
```js
{
  label: 'loop: retry',      // Shown in the top-left tab (loop / alt / opt / …)
  lanes: ['CA0', 'HN'],      // Frame spans leftmost→rightmost of these lanes
  background: 'blue',        // Optional: fill color (drawn as a light wash)
  fromTime: 1,               // Top edge (exact time — no vertical margin)
  toTime: 4,                 // Bottom edge (exact time)
  lMargin: 40,               // Optional: px left of the leftmost lane (default 40)
  rMargin: 40                // Optional: px right of the rightmost lane (default 40)
}
```
> The top/bottom edges sit exactly on `fromTime`/`toTime` (snapped to the 0.1 time grid) — use the times themselves for vertical padding. Dragging the left/right edges adjusts that side's margin, and once you cross an adjacent lane it joins/leaves the span.

### Time Gap Object
```js
{
  fromTime: 3,                     // Top edge of the dashed window (exact time)
  toTime: 4.5,                     // Bottom edge (exact time)
  label: 'sign-off pending|≈ 3 weeks',  // Optional: caption ('|' = line break)
  background: 'gray'               // Optional: light tint wash across the band
}
```
> Spans all lanes; every lifeline dashes between `fromTime` and `toTime`. The label uses the lane-label typeface, supports `|` line breaks (the frame grows to fit), and takes its size/color from `options.timeGap.{textSize,textColor}` (see [Styling & Options](#styling--options)). Two **global** toggles under `options.graph` affect all gaps: **`timeGapLabelPan`** makes labels full-width bars, and **`timeGapHideGrid`** suppresses the time grid inside every gap window. Set the tint from the graphical editor via right-click; drag the top/bottom edges to resize, the center to move.

### Info Box Object
```js
{
  lane: 'LaneName',          // Which lane to attach to
  time: 2,                   // Time position
  background: 'yellow',      // Optional: box fill color (default white)
  tether: false,             // Optional: set false to hide the leader line to the lane
  text: 'Info text|Line 2'   // Text with | for line breaks; a leading <x,y> sets the pixel offset
}
```
> Set the background from the graphical editor via right-click → **Background…** (Custom → "none" clears it). Imported PlantUML notes get a pale-yellow fill and no leader line (`tether: false`).

### Legend Entry
```js
{
  label: 'Description',      // Legend text
  color: 'red',              // Color to show
  style: 'solid'             // Line style to show
}
```

