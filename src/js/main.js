let currentConfig = {};

function renderGraph() {
  const svgContainer = document.getElementById("svg-container");
  
  const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  tempSvg.setAttribute("id", "temp-graph");
  document.body.appendChild(tempSvg);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  tempSvg.appendChild(defs);

  try {
    const input = JSON5.parse(document.getElementById("input").value);
    currentConfig = input;

    const lanes = input.lanes;
    const messages = input.messages;
    const states = input.states || [];
    const legend = input.legend || [];
    const laneGroups = input.laneGroups || [];
    const infoBoxes = input.infoBoxes || [];
    const laneSpacing = 250;
    const timeStep = 50;
    const showGrid = true;
    const showTimeLabels = true;
    const showStates = true;

    const startX = 150;
    const maxMessageTime = Math.max(...messages.map(m => m.toTime));
    const maxStateTime = Math.max(...states.map(s => s.toTime));
    const maxInfoBoxTime = Math.max(...infoBoxes.map(i => i.time));

    // Calculate the overall maximum time
    const maxTime = Math.max(maxMessageTime, maxStateTime, maxInfoBoxTime);   
    
    // Lane Positioning Logic
    const lanePositions = {};
    let currentMainLaneIndex = 0;
    const mainLanes = new Set();

    // Pass 1: Identify and position main lanes
    lanes.forEach(lane => {
      if (!lane.includes('.')) {
        mainLanes.add(lane);
        lanePositions[lane] = startX + currentMainLaneIndex * laneSpacing;
        currentMainLaneIndex++;
      }
    });

    // Pass 2: Position all lanes (main and sub-lanes)
    lanes.forEach(lane => {
      const parts = lane.split('.');
      let x;
      const isSubLane = parts.length === 2 && (mainLanes.has(parts[0]) || mainLanes.has(parts[1]));
  
      if (isSubLane) {
        const [part1, part2] = parts;
        let parentLane = null;
        let isLeftSide = false;
        
        if (mainLanes.has(part1)) {
          parentLane = part1;
          isLeftSide = false;
        } else if (mainLanes.has(part2)) {
          parentLane = part2;
          isLeftSide = true;
        }
        
        if (parentLane && lanePositions[parentLane] !== undefined) {
          const parentX = lanePositions[parentLane];
          x = isLeftSide ? parentX - (laneSpacing / 3) : parentX + (laneSpacing / 3);
        } else {
          console.warn(`Parent lane for ${lane} not found. Defaulting position.`);
          x = startX + lanes.indexOf(lane) * laneSpacing;
        }
      } else {
        x = lanePositions[lane];
      }
      
      lanePositions[lane] = x;
    });

    // Calculate lane group hierarchy
    let laneGroupLevels = 0;
    let groupHierarchy = [];
    
    if (laneGroups.length > 0) {
      groupHierarchy = laneGroups.map(group => ({
        ...group,
        level: 0,
        lanes: group.lanes.filter(lane => lanes.includes(lane)),
        leftmostX: 0,
        rightmostX: 0
      }));
      
      groupHierarchy.forEach(group => {
        if (group.lanes.length > 0) {
          const groupPositions = group.lanes.map(lane => lanePositions[lane]).filter(pos => pos !== undefined);
          if (groupPositions.length > 0) {
            group.leftmostX = Math.min(...groupPositions);
            group.rightmostX = Math.max(...groupPositions);
          }
        }
      });
      
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
    
    // FIXED: Much more compact spacing calculation
    const titleHeight = 40;
    const laneGroupHeight = laneGroupLevels * 30;
    const spaceBetweenTitleAndGroups = 10;
    const spaceBetweenGroupsAndLanes = 20;
    
    const laneTop = titleHeight + spaceBetweenTitleAndGroups + laneGroupHeight + spaceBetweenGroupsAndLanes;
    
    const bottomPadding = 30;
    const svgHeight = laneTop + (maxTime + 1) * timeStep + bottomPadding;

    // Draw lanes
    lanes.forEach(lane => {
      const x = lanePositions[lane];
      const parts = lane.split('.');
      const isSubLane = parts.length === 2 && (mainLanes.has(parts[0]) || mainLanes.has(parts[1]));
      const isSpecialLane = lane.startsWith('_') && lane.endsWith('_');

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x);
      line.setAttribute("y1", laneTop);
      line.setAttribute("x2", x);
      line.setAttribute("y2", laneTop + maxTime * timeStep);
      
      line.setAttribute("stroke", isSubLane ? "#666" :  isSpecialLane ? "LightGray" : "#333");
      line.setAttribute("stroke-width", isSubLane ? "2" :  isSpecialLane ? "16" :"3");
      tempSvg.appendChild(line);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", x);
      text.setAttribute("y", laneTop - 10);
      text.setAttribute("class", isSubLane ? "sub-lane-label" : "lane-label");
      if (isSubLane) {
        text.setAttribute("fill", "#2a5eb2");
      }
      text.textContent = lane;
      tempSvg.appendChild(text);
    });

    // Draw Lane Groups
    if (groupHierarchy.length > 0) {
      groupHierarchy.forEach((group, groupIndex) => {
        if (group.lanes.length === 0) return;

        const groupPositions = group.lanes.map(lane => lanePositions[lane]).filter(pos => pos !== undefined);
        if (groupPositions.length === 0) return;

        const leftmostX = Math.min(...groupPositions);
        const rightmostX = Math.max(...groupPositions);
        const centerX = (leftmostX + rightmostX) / 2;

        const levelFromBottom = laneGroupLevels - 1 - group.level;
        const groupLabelY = laneTop - spaceBetweenGroupsAndLanes - (levelFromBottom * 30) - 20;
        const bracketY = laneTop - spaceBetweenGroupsAndLanes - (levelFromBottom * 30);
        const bracketHeight = 15;

        const groupLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        groupLabel.setAttribute("x", centerX);
        groupLabel.setAttribute("y", groupLabelY);
        groupLabel.setAttribute("class", "lane-group-label");
        groupLabel.textContent = group.label;
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
        
        const opacity = 1 - (group.level * 0.15);
        bracket.setAttribute("opacity", Math.max(opacity, 0.4));
        groupLabel.setAttribute("opacity", Math.max(opacity, 0.4));
        
        tempSvg.appendChild(bracket);
      });
    }

    // Calculate legend position
    let rightmostLaneX = 0;
    if (lanes.length > 0) {
        rightmostLaneX = Math.max(...Object.values(lanePositions));
    }
    const legendX = rightmostLaneX + laneSpacing;

    const legendWidth = legend.length > 0 ? 360 : 0;
    const svgWidth = legendX + legendWidth + 20;

    tempSvg.setAttribute('width', svgWidth);
    tempSvg.setAttribute('height', svgHeight);
    tempSvg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
    tempSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    tempSvg.style.maxWidth = '100%';
    tempSvg.style.height = 'auto';

    // Add title with minimal spacing
    const titleY = 25;
    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    title.setAttribute("x", (svgWidth / 2) - 120);
    title.setAttribute("y", titleY);
    title.setAttribute("text-anchor", "middle");
    title.setAttribute("font-size", "24");
    title.setAttribute("font-weight", "bold");
    title.setAttribute("fill", "#2a5eb2");
    title.textContent = input.title || "Enhanced Transaction Graph";
    tempSvg.appendChild(title);

    // Draw grid
    if (showGrid) {
      for (let t = 0; t <= maxTime; t++) {
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

    // Draw messages with space-based label positioning
    messages.forEach((msg, msgIndex) => {
      const [from, to] = msg.path.split("->").map(x => x.trim());
      const fromX = lanePositions[from] || startX;
      const toX = lanePositions[to] || startX;
      const fromY = laneTop + msg.fromTime * timeStep;
      const toY = laneTop + msg.toTime * timeStep;

      // Draw the message line
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", fromX);
      line.setAttribute("y1", fromY);
      line.setAttribute("x2", toX);
      line.setAttribute("y2", toY);
      line.setAttribute("stroke", msg.color || "black");
      line.setAttribute("class", "arrow" + (msg.style === "dashed" ? " dashed" : ""));
      messageGroup.appendChild(line);

      const arrowId = `arrowhead-${(msg.color || 'black').replace('#', '')}`;
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
        polygon.setAttribute("fill", msg.color || "black");
        marker.appendChild(polygon);
        defs.appendChild(marker);
      }
      line.setAttribute("marker-end", `url(#${arrowId})`);

      // Calculate label position based on spaces
      const labelPosition = calculateLabelPosition(msg.label, fromX, fromY, toX, toY);
      
      // Only create label if there's actual text content
      if (labelPosition.cleanLabel) {
        // Calculate arrow angle for text rotation
        const dx = toX - fromX;
        const dy = toY - fromY;
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle > 90 || angle < -90) {
          angle += 180;
        }

        const fontSize = 15;
        const lines = labelPosition.cleanLabel.split('|');
        const lineHeight = fontSize * 1.2;
        const paddingX = 6;
        const paddingY = 4;
        const textHeight = lines.length * lineHeight;

        // Create label group with rotation
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("transform", `rotate(${angle}, ${labelPosition.x}, ${labelPosition.y})`);

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

        // Create background rectangle
        const maxLineLength = Math.max(...lines.map(line => line.length));
        const estimatedTextWidth = Math.max(maxLineLength * fontSize * 0.55, 30);
        
        const labelBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const bgX = labelPosition.x - estimatedTextWidth / 2 - paddingX;
        const bgY = labelPosition.y - textHeight / 2 - paddingY;
        labelBg.setAttribute("x", bgX);
        labelBg.setAttribute("y", bgY);
        labelBg.setAttribute("width", estimatedTextWidth + 2 * paddingX);
        labelBg.setAttribute("height", textHeight + 2 * paddingY);
        labelBg.setAttribute("class", "label-box");

        group.appendChild(labelBg);
        group.appendChild(text);
        messageGroup.appendChild(group);
      }
    });

    // Draw states (unchanged)
    states.forEach((state, stateIndex) => {
      if (!showStates) return;
      
      const laneX = lanePositions[state.lane] || startX;
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
        return colorMap[color.toLowerCase()] || '#ffffcc';
      }
      
      const stateSubGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const stateFontSize = 11;
      const stateLines = state.label.split('|');
      const numberOfLines = stateLines.length;                        
      const stateLineHeight = stateFontSize * 1.2;
      const stateTextHeight = numberOfLines * stateLineHeight;
      
      const stateText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      stateText.setAttribute("x", laneX);
      stateText.setAttribute("y", fromY + 8 + stateLineHeight / 2);
      stateText.setAttribute("class", "state-label");

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
      let stateBoxWidth;
      let shouldUseFixedStateWidth = true;

      for (const line of stateLines) {
        if (line.length >= 6) {
          shouldUseFixedStateWidth = false;
          break;
        }
      }

      if (shouldUseFixedStateWidth) {
        stateBoxWidth = minStateBoxWidth;
      } else {
        stateBoxWidth = stateBbox.width + 2 * paddingX;
      }

      const stateBoxX = laneX - (stateBoxWidth / 2);
      
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", stateBoxX);
      rect.setAttribute("width", stateBoxWidth);
      
      if (state.fromTime === state.toTime) {
        const gridY = laneTop + state.fromTime * timeStep;
        rect.setAttribute("y", gridY);
        rect.setAttribute("height", stateBbox.height + 8);
        stateText.setAttribute("y", gridY + stateLineHeight / 2 + 4);
      } else {
        const fromGridY = laneTop + state.fromTime * timeStep;
        const toGridY = laneTop + state.toTime * timeStep;
        
        const boxTop = Math.min(fromGridY, toGridY);
        const boxBottom = Math.max(fromGridY, toGridY);
        const boxHeight = boxBottom - boxTop;
        
        const minHeight = stateBbox.height + 8;
        const finalHeight = Math.max(boxHeight, minHeight);
        
        rect.setAttribute("y", boxTop - (finalHeight > boxHeight ? (finalHeight - boxHeight) / 2 : 0));
        rect.setAttribute("height", finalHeight);
        
        const boxCenter = boxTop + finalHeight / 2;
        stateText.setAttribute("y", boxCenter + (stateLineHeight / 2)  + 4  -  (stateTextHeight / 2) );
      }
      
      rect.setAttribute("fill", getPastelColor(state.color || 'yellow'));
      rect.setAttribute("stroke", "#aaa");
      rect.setAttribute("stroke-width", "1");
      rect.setAttribute("rx", "4");
      rect.setAttribute("ry", "4");

      stateSubGroup.innerHTML = '';
      stateSubGroup.appendChild(rect);
      stateSubGroup.appendChild(stateText);
      stateGroup.appendChild(stateSubGroup);
    });

    // Draw info boxes (unchanged from original)
    if (infoBoxes.length > 0) {
      const occupiedAreas = [];
      const messageLines = [];
      const stateAreas = [];

      messages.forEach((msg) => {
        const [from, to] = msg.path.split("->").map(x => x.trim());
        const fromX = lanePositions[from] || startX;
        const toX = lanePositions[to] || startX;
        const fromY = laneTop + msg.fromTime * timeStep;
        const toY = laneTop + msg.toTime * timeStep;
        
        const buffer = 25;
        messageLines.push({
          x: Math.min(fromX, toX) - buffer,
          y: Math.min(fromY, toY) - buffer,
          width: Math.abs(toX - fromX) + 2 * buffer,
          height: Math.abs(toY - fromY) + 2 * buffer
        });
      });

      states.forEach((state) => {
        const laneX = lanePositions[state.lane];
        if (laneX === undefined) return;
        
        const fromY = laneTop + state.fromTime * timeStep;
        const toY = laneTop + state.toTime * timeStep;
        
        const stateFontSize = 11;
        const stateLines = state.label.split('|');
        const stateLineHeight = stateFontSize * 1.2;
        const paddingX = 6;
        const minStateBoxWidth = 50;
        
        const maxLineLength = Math.max(...stateLines.map(line => line.length));
        const estimatedTextWidth = maxLineLength * stateFontSize * 0.6;
        const stateBoxWidth = Math.max(estimatedTextWidth + 2 * paddingX, minStateBoxWidth);
        
        let stateBoxHeight, stateBoxY;
        if (state.fromTime === state.toTime) {
          stateBoxHeight = stateLines.length * stateLineHeight + 8;
          stateBoxY = fromY;
        } else {
          const calculatedHeight = Math.abs(toY - fromY);
          const minHeight = stateLines.length * stateLineHeight + 8;
          stateBoxHeight = Math.max(calculatedHeight, minHeight);
          stateBoxY = Math.min(fromY, toY) - (stateBoxHeight > calculatedHeight ? (stateBoxHeight - calculatedHeight) / 2 : 0);
        }
        
        const stateBoxX = laneX - (stateBoxWidth / 2);
        
        const stateBuffer = 10;
        stateAreas.push({
          x: stateBoxX - stateBuffer,
          y: stateBoxY - stateBuffer,
          width: stateBoxWidth + 2 * stateBuffer,
          height: stateBoxHeight + 2 * stateBuffer
        });
      });

      function rectanglesOverlap(rect1, rect2) {
        return !(rect1.x + rect1.width < rect2.x || 
                 rect2.x + rect2.width < rect1.x || 
                 rect1.y + rect1.height < rect2.y || 
                 rect2.y + rect2.height < rect1.y);
      }

      function intersectsMessageLines(rect) {
        for (const messageLine of messageLines) {
          if (rectanglesOverlap(rect, messageLine)) {
            return true;
          }
        }
        return false;
      }

      function intersectsStateAreas(rect) {
        for (const stateArea of stateAreas) {
          if (rectanglesOverlap(rect, stateArea)) {
            return true;
          }
        }
        return false;
      }

      function intersectsExistingBoxes(rect) {
        for (const occupied of occupiedAreas) {
          if (rectanglesOverlap(rect, occupied)) {
            return true;
          }
        }
        return false;
      }

      function findBestPosition(anchorX, anchorY, boxWidth, boxHeight, svgWidth, svgHeight) {
        const baseDistance = 35;
        const positions = [];
        
        for (let distance = baseDistance; distance <= 150; distance += 15) {
          positions.push({ x: anchorX + distance, y: anchorY - boxHeight/2 });
          positions.push({ x: anchorX + distance, y: anchorY - boxHeight - 10 });
          positions.push({ x: anchorX + distance, y: anchorY + 10 });
          
          positions.push({ x: anchorX - boxWidth - distance, y: anchorY - boxHeight/2 });
          positions.push({ x: anchorX - boxWidth - distance, y: anchorY - boxHeight - 10 });
          positions.push({ x: anchorX - boxWidth - distance, y: anchorY + 10 });
          
          positions.push({ x: anchorX - boxWidth/2, y: anchorY - boxHeight - distance });
          positions.push({ x: anchorX + 10, y: anchorY - boxHeight - distance });
          positions.push({ x: anchorX - boxWidth - 10, y: anchorY - boxHeight - distance });
          
          positions.push({ x: anchorX - boxWidth/2, y: anchorY + distance });
          positions.push({ x: anchorX + 10, y: anchorY + distance });
          positions.push({ x: anchorX - boxWidth - 10, y: anchorY + distance });

          positions.push({ x: anchorX + distance, y: anchorY - boxHeight/2 + distance});
          positions.push({ x: anchorX + distance, y: anchorY - boxHeight - 10 + distance});
          positions.push({ x: anchorX + distance, y: anchorY + 10 + distance});
          
          positions.push({ x: anchorX - boxWidth - distance, y: anchorY - boxHeight/2 - distance});
          positions.push({ x: anchorX - boxWidth - distance, y: anchorY - boxHeight - 10 - distance});
          positions.push({ x: anchorX - boxWidth - distance, y: anchorY + 10 - distance});
          
          positions.push({ x: anchorX + distance - boxWidth/2, y: anchorY - boxHeight - distance });
          positions.push({ x: anchorX + distance + 10, y: anchorY - boxHeight - distance });
          positions.push({ x: anchorX + distance - boxWidth - 10, y: anchorY - boxHeight - distance });
          
          positions.push({ x: anchorX  - distance - boxWidth/2, y: anchorY + distance });
          positions.push({ x: anchorX - distance  + 10, y: anchorY + distance });
          positions.push({ x: anchorX  - distance - boxWidth - 10, y: anchorY + distance });

    }

        for (const pos of positions) {
          const testRect = { x: pos.x, y: pos.y, width: boxWidth, height: boxHeight };
          
          if (testRect.x < 0 || testRect.y < laneTop || 
              testRect.x + testRect.width > svgWidth - 50 || 
              testRect.y + testRect.height > laneTop + maxTime * timeStep + 100) {
            continue;
          }
          
          if (!intersectsExistingBoxes(testRect) && 
              !intersectsMessageLines(testRect) && 
              !intersectsStateAreas(testRect)) {
            return pos;
          }
        }
        
        return { x: anchorX + 180, y: anchorY - boxHeight/2 };
      }

      infoBoxes.forEach((info, index) => {
        const laneX = lanePositions[info.lane];
        if (laneX === undefined) return;
        
        const anchorY = laneTop + info.time * timeStep;
        const lines = (info.text || '').split('|');
        const fontSize = 12;
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
        
        const position = findBestPosition(laneX, anchorY, boxWidth, boxHeight, svgWidth, svgHeight);
        const boxX = position.x;
        const boxY = position.y;
        
        occupiedAreas.push({ x: boxX, y: boxY, width: boxWidth, height: boxHeight });
        
        const connectLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        connectLine.setAttribute("x1", laneX);
        connectLine.setAttribute("y1", anchorY);
        connectLine.setAttribute("x2", boxX + (boxX > laneX ? 0 : boxWidth));
        connectLine.setAttribute("y2", boxY + boxHeight/2);
        connectLine.setAttribute("class", "info-box-line");
        tempSvg.appendChild(connectLine);
        
        const infoBox = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        infoBox.setAttribute("x", boxX);
        infoBox.setAttribute("y", boxY);
        infoBox.setAttribute("width", boxWidth);
        infoBox.setAttribute("height", boxHeight);
        infoBox.setAttribute("class", "info-box");
        tempSvg.appendChild(infoBox);
        
        const infoText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        infoText.setAttribute("x", boxX + padding);
        infoText.setAttribute("y", boxY + padding + fontSize);
        infoText.setAttribute("class", "info-box-text");
        
        lines.forEach((line, i) => {
          const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          tspan.setAttribute("x", boxX + padding);
          tspan.setAttribute("dy", i === 0 ? 0 : lineHeight);
          tspan.textContent = line;
          infoText.appendChild(tspan);
        });
        
        tempSvg.appendChild(infoText);
      });
    }

    tempSvg.appendChild(stateGroup);
    tempSvg.appendChild(messageGroup);

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
      tempSvg.appendChild(legendBox);
      
      const legendTitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
      legendTitle.setAttribute("x", legendX + (arrowLength + 2 * arrowMargin) / 2);
      legendTitle.setAttribute("y", legendY - 40);
      legendTitle.setAttribute("text-anchor", "middle");
      legendTitle.setAttribute("class", "legend-title");
      legendTitle.setAttribute("font-size", "24");
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
          
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          const fontSize = 27;
          const lines = labelPosition.cleanLabel.split('|');
          const lineHeight = fontSize * 1.2;
          const paddingX = 6;
          const paddingY = 4;
          const textHeight = lines.length * lineHeight;
          
          const textYPosition = labelPosition.y - (textHeight - lineHeight) / 2;

          text.setAttribute("x", labelPosition.x);
          text.setAttribute("y", textYPosition);
          text.setAttribute("class", "legend-label");
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

    const exportedSvg = exportSVG(false, tempSvg);
    svgContainer.innerHTML = exportedSvg;
    document.body.removeChild(tempSvg);

  } catch (e) {
    console.error("Error parsing JSON: " + e.message);
    svgContainer.innerHTML = `<div style="color: red; padding: 20px;">Error parsing JSON: ${e.message}. Please check your input.</div>`;
    
    const tempSvg = document.getElementById("temp-graph");
    if (tempSvg) {
      document.body.removeChild(tempSvg);
    }
  }
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
  const cssStyles = `
    .label-box { fill: white; stroke: none; }
    .state-box { fill: #ffffcc; stroke: #aaa; rx: 4; ry: 4; }
    .lane-label { font-weight: bold; font-size: 18px; text-anchor: middle; fill: #2a5eb2; }
    .sub-lane-label { font-weight: bold; font-size: 12px; text-anchor: middle; fill: #2a5eb2; }
    .lane-group-label { font-weight: bold; font-size: 14px; text-anchor: middle; fill: #6699cc; }
    .lane-group-bracket { stroke: #6699cc; stroke-width: 2; stroke-dasharray: 4,4; fill: none; }
    .message-label { font-size: 15px; font-family: 'Courier New', monospace; dominant-baseline: middle; font-weight: bold; }
    .state-label { font-size: 11px; fill: black; font-family: sans-serif; text-anchor: middle; }
    .arrow { stroke-width: 2; }
    .dashed { stroke-dasharray: 5,5; }
    .time-label { font-size: 12px; fill: #666; font-family: sans-serif; }
    .grid-line { stroke: #eee; stroke-width: 1; }
    .legend-box { fill: white; stroke: #ccc; stroke-width: 1; rx: 6; ry: 6; }
    .legend-title { font-weight: bold; font-size: 16px; fill: #2a5eb2; }
    .legend-label { font-size: 27px; font-family: 'Courier New', monospace; dominant-baseline: middle; }
    .info-box { fill: white; stroke: #333; stroke-width: 1; rx: 4; ry: 4; }
    .info-box-text { font-size: 12px; font-family: 'Segoe UI', sans-serif; fill: #333; }
    .info-box-line { stroke: #333; stroke-width: 1; stroke-dasharray: 3,3; fill: none; }
  `;
  
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
    
    const cssStyles = `
      .label-box { fill: white; stroke: none; }
      .state-box { fill: #ffffcc; stroke: #aaa; rx: 4; ry: 4; }
      .lane-label { font-weight: bold; font-size: 18px; text-anchor: middle; fill: #2a5eb2; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
      .sub-lane-label { font-weight: bold; font-size: 12px; text-anchor: middle; fill: #2a5eb2; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
      .lane-group-label { font-weight: bold; font-size: 14px; text-anchor: middle; fill: #6699cc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
      .lane-group-bracket { stroke: #6699cc; stroke-width: 2; stroke-dasharray: 4,4; fill: none; }
      .message-label { font-size: 15px; font-family: 'Courier New', monospace; dominant-baseline: middle; font-weight: bold; }
      .state-label { font-size: 11px; fill: black; font-family: sans-serif; text-anchor: middle; }
      .arrow { stroke-width: 2; }
      .dashed { stroke-dasharray: 5,5; }
      .time-label { font-size: 12px; fill: #666; font-family: sans-serif; }
      .grid-line { stroke: #eee; stroke-width: 1; }
      .legend-box { fill: white; stroke: #ccc; stroke-width: 1; rx: 6; ry: 6; }
      .legend-title { font-weight: bold; font-size: 16px; fill: #2a5eb2; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
      .legend-label { font-size: 27px; font-family: 'Courier New', monospace; dominant-baseline: middle; }
      .info-box { fill: white; stroke: #333; stroke-width: 1; rx: 4; ry: 4; }
      .info-box-text { font-size: 12px; font-family: 'Segoe UI', sans-serif; fill: #333; }
      .info-box-line { stroke: #333; stroke-width: 1; stroke-dasharray: 3,3; fill: none; }
    `;
    
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
      const svgContent = e.target.result;
      
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
        
        function formatCompactJson(obj, indent = 0) {
          const spaces = '  '.repeat(indent);
          
          if (Array.isArray(obj)) {
            if (obj.length === 0) return '[]';
            
            const allSimple = obj.every(item => 
              typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
            );
            
            if (allSimple) {
              return `[${obj.map(item => JSON5.stringify(item)).join(', ')}]`;
            } else {
              const items = obj.map(item => {
                if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                  const pairs = Object.keys(item).map(key => 
                    `${key}: ${JSON5.stringify(item[key])}`
                  );
                  return `${spaces}  { ${pairs.join(', ')} }`;
                } else {
                  return `${spaces}  ${formatCompactJson(item, indent + 1)}`;
                }
              });
              return `[\n${items.join(',\n')}\n${spaces}]`;
            }
          } else if (typeof obj === 'object' && obj !== null) {
            const keys = Object.keys(obj);
            if (keys.length === 0) return '{}';
            
            const items = keys.map(key => {
              const value = formatCompactJson(obj[key], indent + 1);
              return `${spaces}  ${key}: ${value}`;
            });
            return `{\n${items.join(',\n')}\n${spaces}}`;
          } else {
            return JSON5.stringify(obj);
          }
        }
        
        const compactJson = formatCompactJson(jsonData);
        document.getElementById('input').value = compactJson;
        
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
