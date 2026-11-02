// Flow for Cavalry — a custom easing curve editor + preset library.
// Create/select/apply cubic-bezier easing to selected keyframes with one click.
// "Easy" — run from Cavalry: Window > Scripts > Easy > easy.
//
// A cubic-bezier ease is defined by two control points P1(x1,y1), P2(x2,y2) in the
// unit square (the curve always runs (0,0)->(1,1)). Same convention as CSS / AE Flow.

function log(s) { console.log(s); }

// ---- state ----
var CANVAS = 320;            // editor draw size (px)
var PAD = 24;                // inner padding so handles aren't clipped
var bez = { x1: 0.33, y1: 0.0, x2: 0.67, y2: 1.0 }; // current curve (P1, P2)
var constrainStraight = false; // toggle: lock handle drag to one axis
var dragging = null;         // "p1" | "p2" | null
var presets = [];            // [{name, bez:{x1,y1,x2,y2}}]
var PRESET_FILE = api.getScriptsFolder ? (api.getScriptsFolder() + "/Easy/presets.json") : null; // null = presets not persisted

// ---- coordinate mapping: bezier-space (0..1) <-> canvas px ----
// Cavalry's ui.Draw canvas has y=0 at the BOTTOM (y-UP), so bezier by maps
// directly to py (no 1-by flip). This makes value 0 sit at the bottom and value
// 1 at the top, matching AE/Flow's curve display.
function toPx(bx, by) {
    var w = CANVAS - PAD * 2, h = CANVAS - PAD * 2;
    return { x: PAD + bx * w, y: PAD + by * h };
}
function toBez(px, py) {
    var w = CANVAS - PAD * 2, h = CANVAS - PAD * 2;
    return { x: (px - PAD) / w, y: (py - PAD) / h };
}

// ---- the draw widget ----
var draw = new ui.Draw();
draw.setSize(CANVAS, CANVAS);
draw.useHoverEvents(false);

// Pre-build the STATIC grid path once (it never changes) — recomputing it every
// mouse-move was a big part of the drag lag.
var _gridObj = (function () {
    var grid = new cavalry.Path();
    for (var i = 0; i <= 4; i++) {
        var gx = toPx(i / 4, 0).x, gy = toPx(0, i / 4).y;
        grid.moveTo(gx, toPx(0, 0).y); grid.lineTo(gx, toPx(0, 1).y);
        grid.moveTo(toPx(0, 0).x, gy); grid.lineTo(toPx(1, 0).x, gy);
    }
    return grid.toObject();
})();

function redrawCurve() {
    draw.clearPaths();
    draw.addPath(_gridObj, { color: "#3a3a3a", stroke: true, strokeWidth: 1 });

    var p0 = toPx(0, 0), p1 = toPx(bez.x1, bez.y1), p2 = toPx(bez.x2, bez.y2), p3 = toPx(1, 1);

    // handle lines + curve in one fewer addPath where possible
    var hl = new cavalry.Path();
    hl.moveTo(p0.x, p0.y); hl.lineTo(p1.x, p1.y);
    hl.moveTo(p3.x, p3.y); hl.lineTo(p2.x, p2.y);
    draw.addPath(hl.toObject(), { color: "#2d6cdf", stroke: true, strokeWidth: 1 });

    var curve = new cavalry.Path();
    curve.moveTo(p0.x, p0.y);
    curve.cubicTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    draw.addPath(curve.toObject(), { color: "#ffffff", stroke: true, strokeWidth: 3 });

    // control-point handles as cheap SQUARES (4 lines) instead of 4-arc circles
    var dots = new cavalry.Path();
    sq(dots, p1.x, p1.y, 5); sq(dots, p2.x, p2.y, 5);
    draw.addPath(dots.toObject(), { color: "#ffd23f" });

    draw.redraw();
    updateReadout();
}
function sq(p, cx, cy, r) {
    p.moveTo(cx - r, cy - r); p.lineTo(cx + r, cy - r);
    p.lineTo(cx + r, cy + r); p.lineTo(cx - r, cy + r); p.lineTo(cx - r, cy - r);
}

function dist(ax, ay, bx, by) { return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)); }

var dragStart = null; // {x,y} bezier-space start of the handle being dragged
draw.onMousePress = function (pos, button) {
    var p1 = toPx(bez.x1, bez.y1), p2 = toPx(bez.x2, bez.y2);
    if (dist(pos.x, pos.y, p1.x, p1.y) < 14) { dragging = "p1"; dragStart = { x: bez.x1, y: bez.y1 }; }
    else if (dist(pos.x, pos.y, p2.x, p2.y) < 14) { dragging = "p2"; dragStart = { x: bez.x2, y: bez.y2 }; }
    else { dragging = null; dragStart = null; }
    draw.useHoverEvents(false);
};
// COALESCED redraw: dragging the canvas updates bezier on every onMouseMove, but
// redrawing synchronously INSIDE each event blocked the event queue → lag (numeric
// entry, which redraws once, was fluid). Cavalry has no timers, but Promise exists,
// so we defer the redraw to a microtask and collapse a burst of moves into ONE
// redraw per flush.
var _redrawPending = false;
function scheduleRedraw() {
    if (_redrawPending) return;
    _redrawPending = true;
    Promise.resolve().then(function () { _redrawPending = false; redrawCurve(); });
}
draw.onMouseMove = function (pos) {
    if (!dragging) return;
    var b = toBez(pos.x, pos.y);
    var bx = Math.max(0, Math.min(1, b.x)); // x clamped to 0..1
    var by = b.y;                            // y can overshoot (springy eases)
    if (constrainStraight && dragStart) {
        if (Math.abs(bx - dragStart.x) >= Math.abs(by - dragStart.y)) by = dragStart.y; // horizontal lock
        else bx = dragStart.x; // vertical lock
    }
    if (dragging === "p1") { bez.x1 = bx; bez.y1 = by; }
    else { bez.x2 = bx; bez.y2 = by; }
    scheduleRedraw();
};
draw.onMouseRelease = function () { dragging = null; dragStart = null; };

// ---- numeric entry fields (x1,y1,x2,y2) — precise curve values + live readout ----
function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }
var _suppressFieldEvents = false; // avoid feedback loops when we set fields ourselves
function makeNumField(key) {
    var f = new ui.NumericField(bez[key]);
    // setType(1) = NUMBER (decimals); default is integer → snapped to 0/1.
    try { f.setType(1); } catch (e) {}
    try { f.setStep(0.01); } catch (e) {}
    var isX = (key === "x1" || key === "x2");
    try { if (isX) { f.setMin(0); f.setMax(1); } else { f.setMin(-2); f.setMax(3); } } catch (e) {}
    f.onValueChanged = function () {
        if (_suppressFieldEvents) return;
        var v;
        try { v = f.getValue(); } catch (e) { return; }
        if (isX) v = Math.max(0, Math.min(1, v));
        bez[key] = v;
        redrawCurve();
    };
    return f;
}
var fX1 = makeNumField("x1"), fY1 = makeNumField("y1"), fX2 = makeNumField("x2"), fY2 = makeNumField("y2");
function updateReadout() {
    // push current bez values into the fields without retriggering their callbacks
    _suppressFieldEvents = true;
    try {
        fX1.setValue(round2(bez.x1)); fY1.setValue(round2(bez.y1));
        fX2.setValue(round2(bez.x2)); fY2.setValue(round2(bez.y2));
    } catch (e) {}
    _suppressFieldEvents = false;
}
function round2(n) { return Math.round(n * 100) / 100; }

// ---- presets ----
// Curated default easing library — standard CSS/Penner cubic-beziers plus the
// Flow signature curves (Super Smooth, Decelerate, Accelerate). All run (0,0)->(1,1).
function defaultPresets() {
    function b(x1, y1, x2, y2) { return { x1: x1, y1: y1, x2: x2, y2: y2 }; }
    return [
        // First row (4 cols): the everyday set
        { name: "Accelerate",   bez: b(1,    0,    1,    1) },      // soft start, fast end (Flow)
        { name: "Decelerate",   bez: b(0,    0,    0,    1) },      // fast start, soft stop (Flow)
        { name: "Super Smooth", bez: b(0.50, 0,    0.05, 1) },     // user's AE Flow value
        { name: "Linear",       bez: b(0,    0,    1,    1) },
        // rest of the library
        { name: "Smooth",       bez: b(0.25, 0.1,  0.25, 1) },     // CSS "ease"
        { name: "Ease In",      bez: b(0.42, 0,    1,    1) },
        { name: "Ease Out",     bez: b(0,    0,    0.58, 1) },
        { name: "Ease In-Out",  bez: b(0.42, 0,    0.58, 1) },
        { name: "Quad In",      bez: b(0.55, 0.085,0.68, 0.53) },
        { name: "Quad Out",     bez: b(0.25, 0.46, 0.45, 0.94) },
        { name: "Cubic In",     bez: b(0.55, 0.055,0.675,0.19) },
        { name: "Cubic Out",    bez: b(0.215,0.61, 0.355,1) },
        { name: "Quart In-Out", bez: b(0.77, 0,    0.175,1) },
        { name: "Expo Out",     bez: b(0.19, 1,    0.22, 1) },     // sharp snap to end
        { name: "Back In",      bez: b(0.6,  -0.28,0.735,0.045) }, // anticipate (overshoots <0)
        { name: "Back Out",     bez: b(0.175,0.885,0.32, 1.275) }  // overshoot (>1)
    ];
}
function loadPresets() {
    try {
        var s = (api.readFromFile && PRESET_FILE) ? api.readFromFile(PRESET_FILE) : null;
        if (s) presets = JSON.parse(s);
    } catch (e) { presets = []; }
    if (!presets || !presets.length) presets = defaultPresets();
    rebuildPresetGrid();
}
function savePresets() {
    try { if (api.writeToFile && PRESET_FILE) api.writeToFile(PRESET_FILE, JSON.stringify(presets), true); }
    catch (e) { log("preset save failed: " + e); }
}

// Preset library as a SINGLE Draw canvas that re-renders via redraw() (the only
// widget Cavalry refreshes reliably). Laid out as a WRAPPING GRID with a curve
// thumbnail + name label per cell. One canvas keeps delete/refresh instant.
var CELL = 58, GAP = 8, LABEL_H = 14;   // cell square, gap, label strip height
var CELL_H = CELL + LABEL_H;
var COLS = 4;                            // columns (responsive width is fixed to editor)
var presetStrip = new ui.Draw();
var selectedPreset = -1;

function gridCols() { return Math.max(1, Math.min(COLS, Math.floor((CANVAS - GAP) / (CELL + GAP)))); }
function cellXY(idx) {
    var cols = gridCols();
    var c = idx % cols, r = Math.floor(idx / cols);
    return { x: GAP + c * (CELL + GAP), y: GAP + r * (CELL_H + GAP), col: c, row: r };
}

function renderPresetStrip() {
    var cols = gridCols();
    var rows = Math.ceil(presets.length / cols);
    var W = GAP + cols * (CELL + GAP);
    var H = GAP + rows * (CELL_H + GAP);
    presetStrip.setSize(Math.max(CANVAS, W), Math.max(CELL_H + GAP, H));
    presetStrip.clearPaths();

    for (var i = 0; i < presets.length; i++) {
        var pos = cellXY(i), x0 = pos.x, y0 = pos.y;
        var pad = 9, w = CELL - pad * 2;
        // The canvas is y-up (larger y = higher on screen). Reserve the LABEL band on
        // the LOW-y side so the label renders visually BELOW the curve box. The box
        // sits at y in [y0+LABEL_H, y0+LABEL_H+CELL].
        var by0 = y0 + LABEL_H;
        var box = new cavalry.Path();
        box.moveTo(x0, by0); box.lineTo(x0 + CELL, by0); box.lineTo(x0 + CELL, by0 + CELL);
        box.lineTo(x0, by0 + CELL); box.lineTo(x0, by0);
        presetStrip.addPath(box.toObject(), { color: (i === selectedPreset ? "#2d6cdf" : "#333"), stroke: true, strokeWidth: (i === selectedPreset ? 2 : 1) });
        // curve
        var b = presets[i].bez;
        var cur = new cavalry.Path();
        cur.moveTo(x0 + pad, by0 + pad);
        cur.cubicTo(x0 + pad + b.x1 * w, by0 + pad + b.y1 * w, x0 + pad + b.x2 * w, by0 + pad + b.y2 * w, x0 + pad + w, by0 + pad + w);
        presetStrip.addPath(cur.toObject(), { color: "#ffffff", stroke: true, strokeWidth: 2 });
        // name label in the reserved low-y band (visually below the box)
        var label = new cavalry.Path();
        label.addText(clipName(presets[i].name), 11, x0 + 1, y0 + 2);
        presetStrip.addPath(label.toObject(), { color: (i === selectedPreset ? "#9bc0ff" : "#aaa") });
    }
    presetStrip.redraw();
}
function clipName(s) { return s.length > 11 ? s.slice(0, 10) + "…" : s; }

// hit-test the 2D grid: which preset index is under (px,py)?
function hitPreset(px, py) {
    var cols = gridCols();
    var col = Math.floor((px - GAP) / (CELL + GAP));
    var row = Math.floor((py - GAP) / (CELL_H + GAP));
    if (col < 0 || col >= cols || row < 0) return -1;
    var idx = row * cols + col;
    return (idx >= 0 && idx < presets.length) ? idx : -1;
}

presetStrip.onMousePress = function (pos, button) {
    var idx = hitPreset(pos.x, pos.y);
    if (idx < 0) return;
    if (button === "right") {
        var nm = presets[idx].name;
        presets.splice(idx, 1);
        if (selectedPreset === idx) selectedPreset = -1;
        else if (selectedPreset > idx) selectedPreset--;
        savePresets(); renderPresetStrip();
        setStatus("Deleted '" + nm + "'. (right-click a preset to delete)");
        return;
    }
    selectedPreset = idx;
    var p = presets[idx];
    bez = { x1: p.bez.x1, y1: p.bez.y1, x2: p.bez.x2, y2: p.bez.y2 };
    redrawCurve(); renderPresetStrip();
    setStatus("Selected '" + p.name + "'.");
};
function rebuildPresetGrid() { renderPresetStrip(); } // alias for existing callers
function shortName(s) { return s; }

// getSelectedKeyframes() returns { "<layerId>.<attrPath>": [frames] } where the
// key combines layer id ("basicShape#17") and attribute ("position.x").
// Split on the FIRST '.' after the '#<number>' (the layer-id boundary).
function splitSelKey(key) {
    var m = key.match(/^([^#]+#\d+)\.(.+)$/);
    if (m) return { layer: m[1], attr: m[2] };
    // fallback: first dot
    var i = key.indexOf(".");
    return i < 0 ? null : { layer: key.slice(0, i), attr: key.slice(i + 1) };
}

// Build a Magic Easing "Custom" EXPRESSION for the current cubic-bezier curve.
// x = normalized time (0..1) -> normalized eased value.
//
// IMPORTANT: the expression must stay SMALL. Inlining Newton iterations
// recursively explodes the string (each step ~5x longer) and FROZE Cavalry's
// evaluator. Instead we SAMPLE the bezier in JS into a lookup of (x,y) points and
// emit a compact piecewise-linear interpolation expression. 24 samples is smooth
// enough for easing and keeps the expression short + fast.
function bezierExpression(b) {
    var N = 24;
    var xs = [], ys = [];
    for (var i = 0; i <= N; i++) {
        var t = i / N;
        var mt = 1 - t;
        // standard cubic bezier with P0(0,0) P3(1,1)
        xs.push(3 * mt * mt * t * b.x1 + 3 * mt * t * t * b.x2 + t * t * t);
        ys.push(3 * mt * mt * t * b.y1 + 3 * mt * t * t * b.y2 + t * t * t);
    }
    // Build nested ternary: piecewise linear over the sampled (x,y) points.
    // segment i covers x in [xs[i], xs[i+1]] -> lerp ys.
    // Compose from the last segment backward so each is a simple ternary.
    var expr = "" + round(ys[N]); // x >= last sample -> ys[N]
    for (var s = N - 1; s >= 0; s--) {
        var x0 = round(xs[s]), x1 = round(xs[s + 1]);
        var y0 = round(ys[s]), y1 = round(ys[s + 1]);
        var dx = (x1 - x0) || 1e-6;
        // lerp: y0 + (x - x0)/(x1-x0) * (y1-y0)
        var seg = y0 + "+(x-" + x0 + ")*" + round((y1 - y0) / dx);
        expr = "(x<" + x1 + "?(" + seg + "):" + expr + ")";
    }
    return expr;
}
function round(n) { return Math.round(n * 10000) / 10000; }

// ---- apply to selected keyframes ----
function applyToSelection() {
    var sel = api.getSelectedKeyframes();
    var keys = [];
    for (var k in sel) keys.push(k);
    if (!keys.length) { setStatus("No keyframes selected — select keyframes in the timeline first."); return; }

    var expr = bezierExpression(bez);
    var applied = 0, spans = 0;
    for (var i = 0; i < keys.length; i++) {
        var parsed = splitSelKey(keys[i]);
        if (!parsed) continue;
        var frames = sel[keys[i]].slice().sort(function (a, b) { return a - b; });
        // magicEasing applies to the segment LEAVING each keyframe — so apply to all
        // but the last selected frame on this channel.
        for (var f = 0; f < frames.length; f++) {
            if (f === frames.length - 1) continue; // no segment after the last key
            try {
                api.magicEasing(parsed.layer, parsed.attr, frames[f], "Custom", expr);
                applied++;
            } catch (e) { log("magicEasing err " + parsed.attr + "@" + frames[f] + ": " + e); }
        }
        spans++;
    }
    setStatus(applied ? ("Applied custom easing to " + applied + " segment(s).") :
        "Select at least 2 keyframes on a channel (easing applies between them).");
    log("Easy: applied to " + applied + " segments");
}
function clamp01(n) { return Math.max(0, Math.min(1, n)); }

// (legacy single-key apply kept for reference; unused)
function applyBezierToKey(lid, attr, frame) {
    try {
        var md = {}; md[attr] = { frame: frame, type: 0 }; // bezier
        api.modifyKeyframe(lid, md);
        var vd = {};
        vd[attr] = {
            frame: frame,
            rightInfluence: bez.x1, rightSpeed: bez.y1,
            leftInfluence: 1 - bez.x2, leftSpeed: bez.y2
        };
        api.setKeyframeVelocity(lid, vd);
    } catch (e) { log("apply err " + attr + "@" + frame + ": " + e); }
}

// ---- build the window ----
try { if (typeof ui.setTitle === "function") ui.setTitle("Easy"); } catch (e) {}

ui.add(new ui.Label("Easing curve (drag handles, or type values below):"));
ui.add(draw);

// numeric fields row: x1 y1 x2 y2
var numRow = new ui.HLayout();
numRow.add(new ui.Label("P1:")); numRow.add(fX1); numRow.add(fY1);
numRow.add(new ui.Label("P2:")); numRow.add(fX2); numRow.add(fY2);
ui.add(numRow);

// Checkbox per docs: onValueChanged callback + getValue().
var constrainChk = new ui.Checkbox(false);
constrainChk.onValueChanged = function () { constrainStraight = constrainChk.getValue(); };
var constrainRow = new ui.HLayout();
constrainRow.add(new ui.Label("Constrain straight (lock drag to one axis)"));
constrainRow.add(constrainChk);
ui.add(constrainRow);

ui.add(new ui.Label("Presets (click to use, right-click to delete):"));
ui.add(presetStrip);

var saveBtn = new ui.Button("Save current as preset");
saveBtn.onClick = function () {
    var name = "Custom " + (presets.length + 1);
    presets.push({ name: name, bez: { x1: bez.x1, y1: bez.y1, x2: bez.x2, y2: bez.y2 } });
    selectedPreset = presets.length - 1;
    savePresets(); renderPresetStrip();
    setStatus("Saved '" + name + "'.");
};
var resetBtn = new ui.Button("Load default presets");
resetBtn.onClick = function () {
    // append any defaults not already present (by name) — non-destructive
    var have = {}; for (var i = 0; i < presets.length; i++) have[presets[i].name] = true;
    var added = 0;
    var defs = defaultPresets();
    for (var d = 0; d < defs.length; d++) { if (!have[defs[d].name]) { presets.push(defs[d]); added++; } }
    savePresets(); renderPresetStrip();
    setStatus("Added " + added + " default preset(s).");
};
var applyBtn = new ui.Button("APPLY to selected keyframes");
applyBtn.onClick = applyToSelection;

var statusLabel = new ui.Label("Select keyframes in the timeline, then Apply.");
function setStatus(s) { try { statusLabel.setText(s); } catch (e) {} log(s); }

var presetBtnRow = new ui.HLayout();
presetBtnRow.add(saveBtn); presetBtnRow.add(resetBtn);
ui.add(presetBtnRow);
ui.add(applyBtn);
ui.add(statusLabel);

loadPresets();        // populates presets[] (calls rebuildPresetGrid -> renderPresetStrip)
renderPresetStrip();
redrawCurve();
ui.show();
