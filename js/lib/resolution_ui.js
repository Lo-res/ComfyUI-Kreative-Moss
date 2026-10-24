// Image size + focal length: pure logic and DOM builder.
// No ComfyUI imports in here so the logic can be unit-tested in plain Node.
// The Python side (nodes.py) implements the same maths, keep them in step.

export const CUSTOM_RATIO = "Custom Ratio";
export const CUSTOM_RES = "Custom Resolution";
export const MAX_DIM = 8192;

export function snapValue(value, snap) {
    const s = Math.max(1, Math.floor(snap) || 1);
    return Math.max(s, Math.floor(value / s + 0.5) * s);
}

export function parseRatio(key) {
    const m = /^(\d+):(\d+)$/.exec(String(key).trim());
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a > 0 && b > 0 ? [a, b] : null;
}

export function sizeForRatio(rw, rh, longSide, snap) {
    let w;
    let h;
    if (rw >= rh) {
        w = longSide;
        h = (longSide * rh) / rw;
    } else {
        h = longSide;
        w = (longSide * rw) / rh;
    }
    return [snapValue(w, snap), snapValue(h, snap)];
}

function clampInt(value, lo, hi, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
}

export function defaultState(data) {
    const idx = data.long_sides.indexOf(1632);
    return {
        ratio: "2:3",
        size_index: idx >= 0 ? idx : 0,
        custom_ratio: [3, 2],
        custom_res: [1024, 1024],
        focal: "Off",
    };
}

export function normaliseState(raw, data) {
    const state = defaultState(data);
    let src = raw;
    if (typeof raw === "string") {
        try {
            src = JSON.parse(raw);
        } catch (e) {
            src = {};
        }
    }
    if (!src || typeof src !== "object" || Array.isArray(src)) src = {};

    if (data.ratios.includes(src.ratio) || src.ratio === CUSTOM_RATIO || src.ratio === CUSTOM_RES) {
        state.ratio = src.ratio;
    }
    state.size_index = clampInt(src.size_index, 0, data.long_sides.length - 1, state.size_index);
    if (Array.isArray(src.custom_ratio) && src.custom_ratio.length === 2) {
        state.custom_ratio = [clampInt(src.custom_ratio[0], 1, 99, 3), clampInt(src.custom_ratio[1], 1, 99, 2)];
    }
    if (Array.isArray(src.custom_res) && src.custom_res.length === 2) {
        state.custom_res = [clampInt(src.custom_res[0], 64, MAX_DIM, 1024), clampInt(src.custom_res[1], 64, MAX_DIM, 1024)];
    }
    state.focal = data.focal_lengths.some((l) => l.id === src.focal) ? src.focal : "Off";
    return state;
}

export function findLens(data, id) {
    return data.focal_lengths.find((l) => l.id === id) || data.focal_lengths[0];
}

export function recommendedRatio(data, focal, fisheyeType) {
    const lens = findLens(data, focal);
    if (!lens || !lens.ratio) return "";
    if (focal === "8mm" && fisheyeType === "Circular" && lens.ratio_circular) return lens.ratio_circular;
    return lens.ratio;
}

// Which ratio is really in force (the lens can override the manual choice).
export function effectiveRatio(state, opts, data) {
    const fixedLens = state.focal !== "Off" ? findLens(data, state.focal) : null;
    if (fixedLens && fixedLens.fixed_ratio) return fixedLens.ratio; // XPan / Widelux lock the frame
    if (opts.auto && state.focal !== "Off") {
        const rec = recommendedRatio(data, state.focal, opts.fisheye);
        if (rec) return rec;
    }
    return state.ratio;
}

// The sizes shown in the list for a ratio.
export function listSizes(ratioKey, snap, data, state) {
    let pair = null;
    if (ratioKey === CUSTOM_RATIO) pair = state.custom_ratio;
    else if (ratioKey !== CUSTOM_RES) pair = parseRatio(ratioKey);
    if (!pair) return [];
    return data.long_sides.map((L) => sizeForRatio(pair[0], pair[1], L, snap));
}

export function resolveSize(state, opts, data) {
    const snap = Math.max(1, Math.floor(opts.snap) || 16);
    const ratioKey = effectiveRatio(state, opts, data);
    let w;
    let h;
    let label;
    if (ratioKey === CUSTOM_RES) {
        w = snapValue(state.custom_res[0], snap);
        h = snapValue(state.custom_res[1], snap);
        label = "custom";
    } else {
        let pair;
        if (ratioKey === CUSTOM_RATIO) {
            pair = state.custom_ratio;
            label = `${pair[0]}:${pair[1]}`;
        } else {
            pair = parseRatio(ratioKey) || [2, 3];
            label = ratioKey;
        }
        [w, h] = sizeForRatio(pair[0], pair[1], data.long_sides[state.size_index], snap);
    }
    w = Math.min(w, MAX_DIM);
    h = Math.min(h, MAX_DIM);
    const fixed = state.focal !== "Off" && findLens(data, state.focal)?.fixed_ratio;
    if (opts.swap && !fixed) [w, h] = [h, w];
    return { width: w, height: h, ratioKey, label };
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const C = {
    panel: "rgba(0,0,0,0.30)",
    btn: "#2b2b2b",
    btnBorder: "#454545",
    text: "#d6d6d6",
    dim: "#8a8a8a",
    accent: "#f26a4b",
    accentDark: "#3a2420",
    hint: "#6bb7ff",
};

function el(doc, tag, style, text) {
    const e = doc.createElement(tag);
    if (style) Object.assign(e.style, style);
    if (text !== undefined) e.textContent = text;
    return e;
}

function ratioIcon(doc, key) {
    const pair = parseRatio(key) || [1, 1];
    const max = 14;
    const k = max / Math.max(pair[0], pair[1]);
    return el(doc, "span", {
        display: "inline-block",
        width: `${Math.max(4, Math.round(pair[0] * k))}px`,
        height: `${Math.max(4, Math.round(pair[1] * k))}px`,
        border: "1.5px solid currentColor",
        borderRadius: "2px",
        marginRight: "6px",
        flex: "0 0 auto",
    });
}

export const UI_HEIGHT = 620;

/**
 * Builds the node body.
 *  getState()        -> current state object (already normalised)
 *  setState(state)   -> persist
 *  getOptions()      -> { snap, swap, auto, fisheye }
 *  setOption(n, v)   -> change a native widget (used to switch auto-ratio off)
 */
export function createResolutionUI({ doc, data, getState, setState, getOptions, setOption }) {
    const root = el(doc, "div", {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "6px",
        background: C.panel,
        border: "1px solid #3a4a3a",
        borderRadius: "6px",
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        color: C.text,
        fontFamily: "sans-serif",
        fontSize: "12px",
        userSelect: "none",
        overflow: "hidden",
    });

    const refs = {};

    function btnStyle(active) {
        return {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "28px",
            background: active ? C.accent : C.btn,
            color: active ? "#fff" : C.text,
            border: `1px solid ${active ? C.accent : C.btnBorder}`,
            borderRadius: "5px",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: active ? "bold" : "normal",
            boxSizing: "border-box",
            padding: "0 4px",
        };
    }

    function numberInput(value, min, max, onChange, onCommit) {
        const input = el(doc, "input", {
            width: "64px",
            background: "#161616",
            color: "#fff",
            border: `1px solid ${C.btnBorder}`,
            borderRadius: "4px",
            padding: "3px 5px",
            fontSize: "12px",
            textAlign: "center",
        });
        input.type = "number";
        input.min = String(min);
        input.max = String(max);
        input.value = String(value);
        input.addEventListener("input", () => {
            const n = Number(input.value);
            if (Number.isFinite(n)) onChange(n);
        });
        input.addEventListener("change", () => {
            const n = clampInt(input.value, min, max, value);
            input.value = String(n);
            onChange(n);
            onCommit();
        });
        return input;
    }

    function persist(state) {
        setState(state);
    }

    function updateSummary() {
        const state = getState();
        const opts = getOptions();
        const r = resolveSize(state, opts, data);
        if (refs.summary) {
            refs.summary.textContent = `${r.width} × ${r.height}`;
            refs.summarySub.textContent = r.label === "custom" ? "custom resolution" : `${r.label}  ·  ${(r.width * r.height / 1e6).toFixed(2)} MP`;
        }
    }

    function render() {
        const state = getState();
        const opts = getOptions();
        const lens = findLens(data, state.focal);
        const eff = effectiveRatio(state, opts, data);
        const autoOn = opts.auto && state.focal !== "Off" && recommendedRatio(data, state.focal, opts.fisheye);
        const rec = state.focal !== "Off" ? recommendedRatio(data, state.focal, opts.fisheye) : "";

        root.textContent = "";

        // --- ratio grid -------------------------------------------------
        const grid = el(doc, "div", { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "5px" });
        data.ratios.forEach((key) => {
            const active = eff === key;
            const b = el(doc, "div", btnStyle(active));
            b.appendChild(ratioIcon(doc, key));
            b.appendChild(el(doc, "span", null, key));
            b.dataset.ratio = key;
            if (rec === key && !active) {
                b.style.outline = `1px dashed ${C.hint}`;
                b.style.outlineOffset = "-3px";
            }
            if (rec === key) b.title = `${lens.label}: recommended ${key}`;
            b.addEventListener("click", () => {
                const s = getState();
                s.ratio = key;
                if (getOptions().auto) setOption("auto_ratio", false);
                persist(s);
                render();
            });
            grid.appendChild(b);
        });
        root.appendChild(grid);

        // --- custom buttons ----------------------------------------------
        const customRow = el(doc, "div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" });
        [CUSTOM_RATIO, CUSTOM_RES].forEach((key) => {
            const b = el(doc, "div", btnStyle(eff === key), key);
            b.dataset.ratio = key;
            b.addEventListener("click", () => {
                const s = getState();
                s.ratio = key;
                if (getOptions().auto) setOption("auto_ratio", false);
                persist(s);
                render();
            });
            customRow.appendChild(b);
        });
        root.appendChild(customRow);

        // --- status / custom input row (constant height) -----------------
        const statusRow = el(doc, "div", {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            minHeight: "30px",
            maxHeight: "30px",
        });
        if (eff === CUSTOM_RATIO) {
            statusRow.appendChild(el(doc, "span", { color: C.dim }, "Ratio W"));
            statusRow.appendChild(numberInput(state.custom_ratio[0], 1, 99,
                (n) => { const s = getState(); s.custom_ratio[0] = n; persist(s); updateSummary(); },
                () => render()));
            statusRow.appendChild(el(doc, "span", { color: C.dim }, ":  H"));
            statusRow.appendChild(numberInput(state.custom_ratio[1], 1, 99,
                (n) => { const s = getState(); s.custom_ratio[1] = n; persist(s); updateSummary(); },
                () => render()));
        } else if (eff === CUSTOM_RES) {
            statusRow.appendChild(el(doc, "span", { color: C.dim }, "W"));
            statusRow.appendChild(numberInput(state.custom_res[0], 64, MAX_DIM,
                (n) => { const s = getState(); s.custom_res[0] = n; persist(s); updateSummary(); },
                () => render()));
            statusRow.appendChild(el(doc, "span", { color: C.dim }, "×  H"));
            statusRow.appendChild(numberInput(state.custom_res[1], 64, MAX_DIM,
                (n) => { const s = getState(); s.custom_res[1] = n; persist(s); updateSummary(); },
                () => render()));
        } else {
            const note = lens && lens.fixed_ratio && state.focal !== "Off"
                ? `${lens.label} fixes the frame at ${lens.ratio}, always horizontal`
                : autoOn
                ? `${lens.label} is choosing the ratio (Auto ratio ON)`
                : "Pick a ratio, a size and (optionally) a lens";
            statusRow.appendChild(el(doc, "span", { color: autoOn ? C.hint : C.dim, fontSize: "11px" }, note));
        }
        root.appendChild(statusRow);

        // --- lists: sizes (left) + focal lengths (right) ------------------
        const lists = el(doc, "div", { display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: "6px" });

        const sizeCol = el(doc, "div", {
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            opacity: eff === CUSTOM_RES ? "0.3" : "1",
            pointerEvents: eff === CUSTOM_RES ? "none" : "auto",
        });
        const sizes = listSizes(eff, opts.snap, data, state);
        data.long_sides.forEach((_, i) => {
            const sel = i === state.size_index;
            const label = sizes[i] ? `${sizes[i][0]} × ${sizes[i][1]}` : "-";
            const item = el(doc, "div", {
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "28px",
                background: sel ? C.accentDark : "#1c1c1c",
                color: sel ? C.accent : C.text,
                border: `1px solid ${sel ? "#6b3a30" : "#2f2f2f"}`,
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12.5px",
                boxSizing: "border-box",
            }, label);
            item.dataset.sizeIndex = String(i);
            item.addEventListener("click", () => {
                const s = getState();
                s.size_index = i;
                persist(s);
                render();
            });
            sizeCol.appendChild(item);
        });
        lists.appendChild(sizeCol);

        const lensCol = el(doc, "div", { display: "flex", flexDirection: "column", gap: "3px" });
        data.focal_lengths.forEach((l) => {
            const sel = l.id === state.focal;
            const item = el(doc, "div", {
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "28px",
                background: sel ? C.accentDark : "#1c1c1c",
                color: sel ? C.accent : (l.id === "Off" ? C.dim : C.text),
                border: `1px solid ${sel ? "#6b3a30" : "#2f2f2f"}`,
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12.5px",
                boxSizing: "border-box",
            }, l.label);
            item.dataset.focal = l.id;
            item.addEventListener("click", () => {
                const s = getState();
                s.focal = l.id;
                persist(s);
                render();
            });
            lensCol.appendChild(item);
        });
        lists.appendChild(lensCol);
        root.appendChild(lists);

        // --- info panel ---------------------------------------------------
        const info = el(doc, "div", {
            background: "rgba(0,0,0,0.25)",
            border: "1px solid #333",
            borderRadius: "5px",
            padding: "6px 8px",
            lineHeight: "1.35",
            fontSize: "11px",
            flex: "1 1 auto",
            overflow: "hidden",
        });
        if (state.focal === "Off") {
            info.appendChild(el(doc, "div", { color: C.dim }, "Lens: Off. No camera text is added to the prompt."));
        } else {
            const head = el(doc, "div", { fontWeight: "bold", color: "#fff", marginBottom: "2px" }, lens.label);
            info.appendChild(head);
            const p1 = el(doc, "div");
            p1.appendChild(el(doc, "span", { color: C.accent }, "Perspective: "));
            p1.appendChild(doc.createTextNode(lens.perspective));
            const p2 = el(doc, "div");
            p2.appendChild(el(doc, "span", { color: C.accent }, "Field of view: "));
            p2.appendChild(doc.createTextNode(lens.field_of_view));
            const p3 = el(doc, "div", { color: C.hint });
            p3.textContent = `Crop: ${lens.crop_note}`;
            info.appendChild(p1);
            info.appendChild(p2);
            info.appendChild(p3);
        }
        root.appendChild(info);

        // --- result ---------------------------------------------------------
        const result = el(doc, "div", {
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            padding: "0 4px",
        });
        refs.summary = el(doc, "span", { fontSize: "16px", fontWeight: "bold", color: "#fff" });
        refs.summarySub = el(doc, "span", { fontSize: "11px", color: C.dim });
        result.appendChild(refs.summary);
        result.appendChild(refs.summarySub);
        root.appendChild(result);

        updateSummary();
    }

    return { root, render, updateSummary };
}
