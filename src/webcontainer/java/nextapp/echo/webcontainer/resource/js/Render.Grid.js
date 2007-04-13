/**
 * Component rendering peer: Grid
 */
EchoRender.ComponentSync.Grid = function() {
};
  
EchoRender.ComponentSync.Grid.prototype = new EchoRender.ComponentSync;

EchoRender.ComponentSync.Grid.prototype.getContainerElement = function(component) {
    return document.getElementById(this.component.renderId + "_" + component.renderId);
};

EchoRender.ComponentSync.Grid.prototype.renderAdd = function(update, parentElement) {
    var gridProcessor = new EchoRender.ComponentSync.Grid.Processor(this.component);
    var columnCount = gridProcessor.getColumnCount();
    var rowCount = gridProcessor.getRowCount();
    
    var defaultInsets = this.component.getRenderProperty("insets", "0");
    var defaultBorder = this.component.getRenderProperty("border", "");

    var tableElement = document.createElement("div");
    tableElement.id = this.component.renderId;
    tableElement.style.outlineStyle = "none";
    tableElement.tabIndex = "-1";
    
    EchoRender.Property.Color.renderFB(this.component, tableElement);
    EchoRender.Property.Border.render(defaultBorder, tableElement);
    tableElement.style.borderCollapse = "collapse";
    EchoRender.Property.Insets.renderComponentProperty(this.component, "insets", null, tableElement, "padding");
    
    var tbodyElement = document.createElement("tbody");
    tableElement.appendChild(tbodyElement);
    
    var size = parseInt(this.component.getRenderProperty("size", 2));
    
    var trElement;
    var renderedComponentIds = new Object();
    
    var xSpan, ySpan;
    if (gridProcessor.horizontalOrientation) {
        xSpan = "colspan";
        ySpan = "rowspan"; 
    } else {
        xSpan = "rowspan";
        ySpan = "colspan"; 
    }
    
    for (var rowIndex = 0; rowIndex < rowCount; ++rowIndex) {
        trElement = document.createElement("tr");
        tbodyElement.appendChild(trElement);
        
        for (var columnIndex = 0; columnIndex < columnCount; ++columnIndex) {
            var cell = gridProcessor.getCell(columnIndex, rowIndex);
            if (cell == null) {
                var tdElement = document.createElement("td");
                trElement.appendChild(tdElement);
                continue;
            }
            if (renderedComponentIds[cell.component.renderId]) {
                // Cell already rendered.
                continue;
            }
            renderedComponentIds[cell.component.renderId] = true;
            
            var tdElement = document.createElement("td");
            tdElement.id = this.component.renderId + "_" + cell.component.renderId;
            if (cell.xSpan > 1) {
                tdElement.setAttribute(xSpan, cell.xSpan);
            }
            if (cell.ySpan > 1) {
                tdElement.setAttribute(ySpan, cell.ySpan);
            }
            
            var layoutData = cell.component.getRenderProperty("layoutData");
            if (layoutData) {
                EchoRender.Property.Color.renderComponentProperty(layoutData, "background", "", tdElement, "backgroundColor");
            }
            
            EchoRender.Property.Border.render(defaultBorder, tdElement);
            tdElement.style.padding = defaultInsets.toString();
            EchoRender.renderComponentAdd(update, cell.component, tdElement);
            trElement.appendChild(tdElement);
        }
    }
    
    parentElement.appendChild(tableElement);
};

EchoRender.ComponentSync.Grid.prototype.renderDispose = function(update) { 
    var tableElement = document.getElementById(this.component.renderId);
};

EchoRender.ComponentSync.Grid.prototype.renderUpdate = function(update) {
    var fullRender = false;
    EchoRender.Util.renderRemove(update, update.parent);
    var containerElement = EchoRender.Util.getContainerElement(update.parent);
    this.renderAdd(update, containerElement);
    return fullRender;
};

EchoRender.ComponentSync.Grid.Processor = function(grid) {
    this.grid = grid;
    this.cellArrays = new Array();
    this.horizontalOrientation = true;
    
    var cells = this.createCells();
    if (cells == null) {
        // Special case: empty Grid.
        this.gridXSize = 0;
        this.gridYSize = 0;
        return;
    }

    this.renderCellMatrix(cells);
    
    this.calculateExtents();
};

EchoRender.ComponentSync.Grid.Processor.prototype.calculateExtents = function() {
    var xProperty = this.horizontalOrientation ? "columnWidth" : "rowHeight";
    var yProperty = this.horizontalOrientation ? "rowHeight" : "columnWidth";
    
    this.xExtents = new Array();
    for (var i = 0; i < this.gridXSize; ++i) {
        this.xExtents.push(this.grid.getRenderIndexedProperty(xProperty, i));
    }

    this.yExtents = new Array();
    for (var i = 0; i < this.gridYSize; ++i) {
        this.yExtents.push(this.grid.getRenderIndexedProperty(yProperty, i));
    }
};

EchoRender.ComponentSync.Grid.Processor.prototype.createCells = function() {
    var childCount = this.grid.getComponentCount();
    if (childCount == 0) {
        // Abort if Grid is empty.
        return null;
    }
    
    var cells = new Array();
    for (var i = 0; i < childCount; ++i) {
        var child = this.grid.getComponent(i);
        var layoutData = child.getRenderProperty("layoutData");
        if (layoutData) {
            var xSpan = layoutData.getProperty(this.horizontalOrientation ? "columnSpan" : "rowSpan"); 
            var ySpan = layoutData.getProperty(this.horizontalOrientation ? "rowSpan" : "columnSpan"); 
            cells.push(new EchoRender.ComponentSync.Grid.Processor.Cell(child, i, xSpan ? xSpan : 1, ySpan ? ySpan : 1));
        } else {
            cells.push(new EchoRender.ComponentSync.Grid.Processor.Cell(child, i, 1, 1));
        }
    }
    return cells;
};

EchoRender.ComponentSync.Grid.Processor.prototype.getCellArray = function(y, expand) {
    while (expand && y >= this.cellArrays.length) {
        this.cellArrays.push(new Array(this.gridXSize));
    }
    return this.cellArrays[y]; 
};

/**
 * Returns the number of columns that should be rendered.
 * 
 * @return the number of rendered columns
 * @type Integer
 */
EchoRender.ComponentSync.Grid.Processor.prototype.getColumnCount = function() {
    return this.horizontalOrientation ? this.gridXSize : this.gridYSize;
};

/**
 * Returns the cell that should be rendered at the
 * specified position.
 * 
 * @param {Integer} column the column index
 * @param {Integer} row the row index
 * @return the cell
 * @type EchoRender.ComponentSync.Grid.Processor.Cell
 */
EchoRender.ComponentSync.Grid.Processor.prototype.getCell = function(column, row) {
    if (this.horizontalOrientation) {
        return this.getCellArray(row, false)[column];
    } else {
        return this.getCellArray(column, false)[row];
    }
}

/**
 * Returns the number of rows that should be rendered.
 * 
 * @return the number of rendered rows
 * @type Integer
 */
EchoRender.ComponentSync.Grid.Processor.prototype.getRowCount = function() {
    return this.horizontalOrientation ? this.gridYSize : this.gridXSize;
};

EchoRender.ComponentSync.Grid.Processor.prototype.renderCellMatrix = function(cells) {
    this.gridXSize = parseInt(this.grid.getRenderProperty("size", 2));
    var x = 0, y = 0;
    var yCells = this.getCellArray(y, true);
    
    for (var componentIndex = 0; componentIndex < cells.length; ++componentIndex) {
        
        // Set x-span to fill remaining size in the event SPAN_FILL has been specified or if the cell would
        // otherwise extend past the specified size.
        if (cells[componentIndex].xSpan == EchoApp.Grid.SPAN_FILL || cells[componentIndex].xSpan > this.gridXSize - x) {
            cells[componentIndex].xSpan = this.gridXSize - x;
        }
        
        // Set x-span of any cell INCORRECTLY set to negative value to 1 (note that SPAN_FILL has already been handled).
        if (cells[componentIndex].xSpan < 1) {
            cells[componentIndex].xSpan = 1;
        }
        // Set y-span of any cell INCORRECTLY set to negative value (or more likely SPAN_FILL) to 1.
        if (cells[componentIndex].ySpan < 1) {
            cells[componentIndex].ySpan = 1;
        }
        
        if (cells[componentIndex].xSpan != 1 || cells[componentIndex].ySpan != 1) {
            // Scan to ensure no y-spans are blocking this x-span.
            // If a y-span is blocking, shorten the x-span to not
            // interfere.
            for (var xIndex = 1; xIndex < cells[componentIndex].xSpan; ++xIndex) {
                if (yCells[x + xIndex] != null) {
                    // Blocking component found.
                    cells[componentIndex].xSpan = xIndex;
                    break;
                }
            }
            for (var yIndex = 0; yIndex < cells[componentIndex].ySpan; ++yIndex) {
                var yIndexCells = this.getCellArray(y + yIndex, true);
                for (var xIndex = 0; xIndex < cells[componentIndex].xSpan; ++xIndex) {
                    yIndexCells[x + xIndex] = cells[componentIndex];
                }
            }
        }
        yCells[x] = cells[componentIndex];

        if (componentIndex < cells.length - 1) {
            // Move rendering cursor.
            var nextRenderPointFound = false;
            while (!nextRenderPointFound) {
                if (x < this.gridXSize - 1) {
                    ++x;
                } else {
                    // Move cursor to next line.
                    x = 0;
                    ++y;
                    yCells = this.getCellArray(y, true);
                    
                }
                nextRenderPointFound = yCells[x] == null;
            }
        }
    }

    // Store actual 'y' dimension.
    this.gridYSize = this.cellArrays.length;
};

EchoRender.ComponentSync.Grid.Processor.Cell = function(component, index, xSpan, ySpan) {
    this.component = component;
    this.index = index;
    this.xSpan = xSpan;
    this.ySpan = ySpan;
};

EchoRender.registerPeer("Grid", EchoRender.ComponentSync.Grid);
