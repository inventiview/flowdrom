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

## Feature Examples

### 1. Two-Lane Communication
#### simple-two-lane-communication
Let's start with the simplest possible diagram - two entities exchanging a message:

```json
{
  "title": "Basic Request-Response",
  "lanes": ["Client", "Server"],
  "messages": [
    { 
      "path": "Client->Server", 
      "label": "Request", 
      "color": "blue", 
      "style": "solid", 
      "fromTime": 0, 
      "toTime": 1 
    },
    { 
      "path": "Server->Client", 
      "label": "Response", 
      "color": "green", 
      "style": "solid", 
      "fromTime": 1, 
      "toTime": 2 
    }
  ]
}
```

![Basic Request-Response](images/01-basic-request-response.svg)

This creates a simple sequence showing a client sending a request to a server and receiving a response.

#### unordered-two-lane-communication
Since flowdrom is not just a sequence graph generator but actually has timing parameters, it opens the possibilities to create unordered sequences / non linear sequences.
```json
{
  "title": "Unordered traffic",
  "lanes": ["CA0" , "HN"],
  "messages": [
    { "path": "CA0->HN", "label": "RdData(k1)", "color": "red", "style": "solid", "fromTime": 0, "toTime": 4 },
    { "path": "HN->CA0",  "label": "Data (k1)", "color": "red", "style": "solid", "fromTime": 4, "toTime": 6 },
    { "path": "CA0->HN", "label": "RdData(k2)", "color": "purple", "style": "solid", "fromTime": 0.5, "toTime": 2 },
    { "path": "HN->CA0",  "label": "Data (k2)", "color": "purple", "style": "solid", "fromTime": 2, "toTime": 7}
  ]
}
```

![Unordered traffic](images/01-unordered-traffic.svg)

Here source and target sequences are different. 

### 2. Adding States

Now let's add state changes to show what happens inside each entity:

```json
{
  "title": "Request-Response with States",
  "lanes": ["Client", "Server"],
  "messages": [
    { 
      "path": "Client->Server", 
      "label": "Request", 
      "color": "blue", 
      "style": "solid", 
      "fromTime": 0, 
      "toTime": 1 
    },
    { 
      "path": "Server->Client", 
      "label": "Response", 
      "color": "green", 
      "style": "solid", 
      "fromTime": 2, 
      "toTime": 3 
    }
  ],
  "states": [
    { 
      "lane": "Client", 
      "label": "Waiting", 
      "color": "yellow", 
      "fromTime": 1, 
      "toTime": 3 
    },
    { 
      "lane": "Server", 
      "label": "Processing", 
      "color": "orange", 
      "fromTime": 1, 
      "toTime": 2 
    }
  ]
}
```

![Request response states](images/02-request-response-states.svg)

The states show that the client waits while the server processes the request.

### 3. Multi-Lane Systems

Real systems often involve multiple components. Here's a three-lane system:

```json
{
  "title": "Three-Tier Architecture",
  "lanes": ["Frontend", "Backend", "Database"],
  "messages": [
    { 
      "path": "Frontend->Backend", 
      "label": "API Call", 
      "color": "blue", 
      "style": "solid", 
      "fromTime": 0, 
      "toTime": 1 
    },
    { 
      "path": "Backend->Database", 
      "label": "Query", 
      "color": "purple", 
      "style": "solid", 
      "fromTime": 1, 
      "toTime": 2 
    },
    { 
      "path": "Database->Backend", 
      "label": "Results", 
      "color": "orange", 
      "style": "solid", 
      "fromTime": 3, 
      "toTime": 4 
    },
    { 
      "path": "Backend->Frontend", 
      "label": "JSON Response", 
      "color": "green", 
      "style": "solid", 
      "fromTime": 4, 
      "toTime": 5 
    }
  ],
  "states": [
    { 
      "lane": "Backend", 
      "label": "Processing", 
      "color": "yellow", 
      "fromTime": 1, 
      "toTime": 4 
    },
    { 
      "lane": "Database", 
      "label": "Query Execution", 
      "color": "cyan", 
      "fromTime": 2, 
      "toTime": 3 
    }
  ]
}
```

![multi lane diagram](images/03-three-tier-architecture.svg)

This shows a typical web application flow: frontend → backend → database → backend → frontend.

### 4. Lane Groups

For complex systems, you can group related lanes visually:

```json
{
  "title": "Microservices Architecture",
  "lanes": ["Client", "API Gateway", "Auth Service", "User Service", "Database"],
  "laneGroups": [
    { 
      "label": "Client Layer", 
      "lanes": ["Client"] 
    },
    { 
      "label": "Service Layer", 
      "lanes": ["API Gateway", "Auth Service", "User Service"] 
    },
    { 
      "label": "Data Layer", 
      "lanes": ["Database"] 
    }
  ],
  "messages": [
    { 
      "path": "Client->API Gateway", 
      "label": "Login Request", 
      "color": "blue", 
      "style": "solid", 
      "fromTime": 0, 
      "toTime": 1 
    },
    { 
      "path": "API Gateway->Auth Service", 
      "label": "Validate", 
      "color": "purple", 
      "style": "solid", 
      "fromTime": 1, 
      "toTime": 2 
    },
    { 
      "path": "Auth Service->User Service", 
      "label": "Get User", 
      "color": "orange", 
      "style": "solid", 
      "fromTime": 2, 
      "toTime": 3 
    },
    { 
      "path": "User Service->Database", 
      "label": "Query User", 
      "color": "red", 
      "style": "solid", 
      "fromTime": 3, 
      "toTime": 4 
    }
  ]
}
```

![grouping lanes together](images/04-microservices-groups.svg)

Lane groups help organize complex diagrams by showing architectural boundaries.

### 5. Information Boxes

Add contextual information with info boxes:

```json
{
  "title": "Error Handling Example",
  "lanes": ["Client", "Server", "Database"],
  "infoBoxes": [
    { 
      "lane": "Server", 
      "time": 2, 
      "text": "Connection timeout|Retry with |exponential backoff" 
    },
    { 
      "lane": "Client", 
      "time": 4, 
      "text": "Display |error message|to user" 
    }
  ],
  "messages": [
    { 
      "path": "Client->Server", 
      "label": "Data Request", 
      "color": "blue", 
      "style": "solid", 
      "fromTime": 0, 
      "toTime": 1 
    },
    { 
      "path": "Server->Database", 
      "label": "Query", 
      "color": "purple", 
      "style": "solid", 
      "fromTime": 1, 
      "toTime": 2 
    },
    { 
      "path": "Server->Client", 
      "label": "Timeout Error", 
      "color": "red", 
      "style": "dashed", 
      "fromTime": 3, 
      "toTime": 4 
    }
  ],
  "states": [
    { 
      "lane": "Server", 
      "label": "Error State", 
      "color": "red", 
      "fromTime": 2, 
      "toTime": 3 
    }
  ]
}
```

![Adding info boxes for clarity](images/05-error-handling-info.svg)

Info boxes provide additional context about what's happening at specific points in time. Use `|` for line breaks in the text.

### 6. Complex Transactions

Here's an advanced example showing 2 new features of lanes by using a different name syntax:
1. Sublanes: these are handy to show a sub component interaction with the system. A lane may have 2 sublanes (one on each side).
The Syntax for a sublane is to use one of the lane names and add a "." concatination either on the left or the right. For example for Lane="HN", a sublane on the right is given by using "HN.MEM" (MEM.HN would place it on the left).

2. Medium: this is handy when describing a medium through a message may pass. This is done using underscores on both sides - "\_Lane\_"

```json
{
  "title": "Cache Coherency Conflict",
  "lanes": ["CA0", "_D2D_", "CA1", "HN", "HN.MEM"],
  "laneGroups": [
    { "label": "Caching Agents", "lanes": ["CA0", "CA1"] },
    { "label": "System", "lanes": ["HN", "HN.MEM"] }
  ],
  "infoBoxes": [
    { "lane": "HN", "time": 2, "text": "Conflict detected|serialize requests" }
  ],
  "messages": [
    { "path": "CA0->HN", "label": "Read|Unique(A)", "color": "red", "style": "solid", "fromTime": 0, "toTime": 1 },
    { "path": "CA1->HN", "label": "Read|Unique(A)", "color": "red", "style": "dashed", "fromTime": 1, "toTime": 2 },
    { "path": "HN->HN.MEM", "label": "Rd(A)", "color": "orange", "style": "solid", "fromTime": 2, "toTime": 3 },
    { "path": "HN.MEM->HN", "label": "D(A)", "color": "orange", "style": "solid", "fromTime": 4, "toTime": 5.5 },
    { "path": "HN->CA1", "label": "SnpInvalid(A)", "color": "purple", "style": "solid", "fromTime": 2, "toTime": 4 },
    { "path": "CA1->HN", "label": "SnpResp(I)", "color": "green", "style": "solid", "fromTime": 4, "toTime": 6 },
    { "path": "HN->CA0", "label": "CompData(A)", "color": "blue", "style": "solid", "fromTime": 6, "toTime": 7 },
    { "path": "HN->CA1", "label": "Retry", "color": "red", "style": "dashed", "fromTime": 7, "toTime": 8 }
  ],
  "states": [
    { "lane": "CA0", "label": "I->UD", "color": "yellow", "fromTime": 0, "toTime": 0.5 },
    { "lane": "CA1", "label": "S->I", "color": "orange", "fromTime": 4, "toTime": 4.5 },
    { "lane": "HN", "label": "Conflict", "color": "red", "fromTime": 2, "toTime": 7 }
  ]
}
```

![advanced graph](images/06-cache-coherency-conflict.svg)

This complex example shows how two caching agents conflict when trying to access the same memory address simultaneously.

### 7. Legends

Add legends to explain your color coding:

```json
{
  "title": "Protocol Messages with Legend",
  "lanes": ["Client", "Router", "Server"],
  "messages": [
    { "path": "Client->Router", "label": "HTTP GET", "color": "blue", "style": "solid", "fromTime": 0, "toTime": 1 },
    { "path": "Router->Server", "label": "Forward", "color": "green", "style": "solid", "fromTime": 1, "toTime": 2 },
    { "path": "Server->Router", "label": "HTTP 200", "color": "purple", "style": "solid", "fromTime": 2, "toTime": 3 },
    { "path": "Router->Client", "label": "Response", "color": "orange", "style": "solid", "fromTime": 3, "toTime": 4 }
  ],
  "legend": [
    { "label": "Request", "color": "blue", "style": "solid" },
    { "label": "Forward", "color": "green", "style": "solid" },
    { "label": "Response", "color": "purple", "style": "solid" },
    { "label": "Delivery", "color": "orange", "style": "solid" }
  ]
}
```

![legends](images/07-protocol-with-legend.svg)

Legends help readers understand what different colors and line styles represent.

## JSON Schema Reference

### Root Object
```json
{
  "title": "string",           // Diagram title
  "lanes": ["string"],         // Array of lane names
  "laneGroups": [...],         // Optional lane groupings
  "messages": [...],           // Message arrows
  "states": [...],             // State changes
  "infoBoxes": [...],          // Information annotations
  "legend": [...]              // Legend entries
}
```

### Message Object
```json
{
  "path": "Source->Target",    // Lane1->Lane2 format
  "label": "Message text",     // Use | for line breaks
  "color": "red|blue|green|purple|orange", // Message color
  "style": "solid|dashed",     // Line style
  "fromTime": 0,               // Start time (number)
  "toTime": 1                  // End time (number)
}
```

### State Object
```json
{
  "lane": "LaneName",          // Which lane
  "label": "State Name",       // State description
  "color": "yellow|red|green|blue|orange|cyan", // Background color
  "fromTime": 0,               // Start time
  "toTime": 1                  // End time
}
```
> Note: state may have a single time (i.e. Start time = End time)

### Lane Group Object
```json
{
  "label": "Group Name",       // Group title
  "lanes": ["Lane1", "Lane2"]  // Lanes to group
}
```

### Info Box Object
```json
{
  "lane": "LaneName",          // Which lane to attach to
  "time": 2,                   // Time position
  "text": "Info text|Line 2"   // Text with | for line breaks
}
```

### Legend Entry
```json
{
  "label": "Description",      // Legend text
  "color": "red",              // Color to show
  "style": "solid"             // Line style to show
}
```

