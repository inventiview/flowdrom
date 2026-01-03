# Flowdrom User Guide

**Flowdrom** is a web-based tool for creating transaction timing diagrams and sequence charts. It uses JSON-based definitions to generate visual diagrams that can be exported as SVG or PNG files.

## Table of Contents
- [Getting Started](#getting-started)
- [Basic Concepts](#basic-concepts)
- [Feature Examples](#feature-examples)
  - [1. Two-Lane Communication](#1-two-lane-communication)
    - [Simple Two-Lane Communication](#simple-two-lane-communication)
    - [Unordered Two-Lane Communication](#unordered-two-lane-communication)
  - [2. Adding States](#2-adding-states)
  - [3. Multi-Lane Systems](#3-multi-lane-systems)
  - [4. Lane Groups](#4-lane-groups)
  - [5. Information Boxes](#5-information-boxes)
  - [6. Complex Transactions](#6-complex-transactions)
  - [7. Legends](#7-legends)
- [JSON Schema Reference](#json-schema-reference)

## Getting Started

1. Open Flowdrom in your web browser
2. Edit the JSON in the top panel to define your diagram
3. Click **"Render"** to generate the visual diagram
4. Use **"Export SVG"** or **"Export PNG"** to save your diagram
5. Use **"Load SVG"** to edit existing diagrams

## Basic Concepts

Flowdrom diagrams consist of:
- **Lanes**: Vertical columns representing entities (processors, agents, memory, etc.)
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

## Feature Examples

### 1. Two-Lane Communication
#### simple-two-lane-communication
Let's start with the simplest possible diagram - two entities exchanging a message:

```js
{
  title: 'Hello world',
  lanes: ['Source', 'Target'],
  messages: [
    { path: 'Source->Target', label: 'Hello', fromTime: 0, toTime: 1 },
    { path: 'Target->Source', label: 'World', fromTime: 1, toTime: 2 },
  ],  
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

#### unordered-two-lane-communication
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

#### message label syntax

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

### 5. Information Boxes

Add contextual information with info boxes:

```js
{
  title: 'Error Handling Example',
  lanes: ['Client', 'Server', 'Database'],
  infoBoxes: [
    { lane: 'Server', time: 2, text: 'Connection timeout|Retry with |exponential backoff' },
    { lane: 'Client', time: 4, text: 'Display |error message|to user' }
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

### 6. Complex Transactions

Here's an advanced example showing 2 new features of lanes by using a different name syntax:
1. Sublanes: these are handy to show a sub component interaction with the system. A lane may have 2 sublanes (one on each side).
The Syntax for a sublane is to use one of the lane names and add a "." concatination either on the left or the right. For example for Lane="HN", a sublane on the right is given by using "HN.MEM" (MEM.HN would place it on the left).

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

### 7. Legends

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
  lanes: ['string'],         // Array of lane names
  laneGroups: [...],         // Optional lane groupings
  messages: [...],           // Message arrows
  states: [...],             // State changes
  infoBoxes: [...],          // Information annotations
  legend: [...]              // Legend entries
}
```

### Message Object
```js
{
  path: 'Source->Target',    // Lane1->Lane2 format
  label: 'Message text',     // Use | for line breaks
  color: 'red|blue|green|purple|orange', // Message color
  style: 'solid|dashed',     // Line style
  fromTime: 0,               // Start time (number)
  toTime: 1                  // End time (number)
}
```

### State Object
```js
{
  lane: 'LaneName',          // Which lane
  label: 'State Name',       // State description
  color: 'yellow|red|green|blue|orange|cyan', // Background color
  fromTime: 0,               // Start time
  toTime: 1                  // End time
}
```
> Note: state may have a single time (i.e. Start time = End time)

### Lane Group Object
```js
{
  label: 'Group Name',       // Group title
  lanes: ['Lane1', 'Lane2']  // Lanes to group
}
```

### Info Box Object
```js
{
  lane: 'LaneName',          // Which lane to attach to
  time: 2,                   // Time position
  text: 'Info text|Line 2'   // Text with | for line breaks
}
```

### Legend Entry
```js
{
  label: 'Description',      // Legend text
  color: 'red',              // Color to show
  style: 'solid'             // Line style to show
}
```

