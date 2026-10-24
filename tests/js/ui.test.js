import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "js", "lenses.json"), "utf8"));
const cases = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "size_cases.json"), "utf8"));

// The lib files are ES modules with no package.json of their own; copy them next to a tiny one so Node loads them.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kreative-js-"));
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
for (const f of ["resolution_ui.js", "promptmulti_ui.js"]) {
    fs.copyFileSync(path.join(root, "js", "lib", f), path.join(tmp, f));
}
const R = await import(pathToFileURL(path.join(tmp, "resolution_ui.js")).href);
const P = await import(pathToFileURL(path.join(tmp, "promptmulti_ui.js")).href);

// ---------------------------------------------------------------- size maths
test("JS size maths matches the Python fixture exactly", () => {
    assert.ok(cases.length > 100);
    for (const c of cases) {
        const st = R.normaliseState(c.state, data);
        const r = R.resolveSize(st, { snap: c.snap, swap: c.swap, auto: c.auto, fisheye: c.fisheye }, data);
        assert.deepEqual([r.width, r.height, r.label], c.expect, JSON.stringify(c));
    }
});

test("Moss default is 1088 x 1632", () => {
    const r = R.resolveSize(R.defaultState(data), { snap: 16, swap: false, auto: false, fisheye: "Full-frame" }, data);
    assert.deepEqual([r.width, r.height], [1088, 1632]);
});

test("bad state falls back to defaults", () => {
    for (const raw of ["nope", "[]", "null", '{"ratio":"banana","size_index":99,"focal":"1mm"}', undefined]) {
        const st = R.normaliseState(raw, data);
        assert.ok(data.long_sides[st.size_index] !== undefined);
        assert.ok(data.focal_lengths.some((l) => l.id === st.focal));
    }
});

// ---------------------------------------------------------------- resolution UI (clicks)
function buildResolutionUI(initial = {}, opts = {}) {
    const dom = new JSDOM("<!doctype html><body></body>");
    const doc = dom.window.document;
    let stored = JSON.stringify({ ...R.defaultState(data), ...initial });
    const options = { snap: 16, swap: false, auto: false, fisheye: "Full-frame", ...opts };
    const setOptionCalls = [];
    const ui = R.createResolutionUI({
        doc, data,
        getState: () => R.normaliseState(stored, data),
        setState: (s) => { stored = JSON.stringify(s); },
        getOptions: () => options,
        setOption: (n, v) => { setOptionCalls.push([n, v]); if (n === "auto_ratio") options.auto = v; },
    });
    doc.body.appendChild(ui.root);
    ui.render();
    return { doc, ui, state: () => JSON.parse(stored), options, setOptionCalls,
        click: (sel) => doc.querySelector(sel).dispatchEvent(new dom.window.Event("click", { bubbles: true })) };
}

test("UI shows 13 ratio buttons, 10 sizes and 10 lens entries", () => {
    const t = buildResolutionUI();
    assert.equal(t.doc.querySelectorAll("[data-ratio]").length, 13);
    assert.equal(t.doc.querySelectorAll("[data-size-index]").length, 10);
    const lenses = [...t.doc.querySelectorAll("[data-focal]")].map((e) => e.textContent);
    assert.deepEqual(lenses, ["Off", "8mm fisheye", "16mm", "24mm", "35mm", "50mm", "85mm", "135mm", "XPan 45mm (panoramic)", "Widelux 26mm (swing lens)"]);
});

test("clicking a ratio, a size and a lens updates state and readout", () => {
    const t = buildResolutionUI();
    t.click('[data-ratio="3:2"]');
    t.click('[data-size-index="2"]');
    t.click('[data-focal="50mm"]');
    assert.equal(t.state().ratio, "3:2");
    assert.equal(t.state().size_index, 2);
    assert.equal(t.state().focal, "50mm");
    assert.match(t.doc.body.textContent, /1152 × 768/);
    assert.match(t.doc.body.textContent, /Matches a natural human field of view with little to no distortion\./);
    assert.match(t.doc.body.textContent, /Keeps the background in a realistic, proportional size to the subject\./);
});

test("size list follows the chosen ratio", () => {
    const t = buildResolutionUI({ ratio: "3:2" });
    const labels = [...t.doc.querySelectorAll("[data-size-index]")].map((e) => e.textContent);
    assert.equal(labels[0], "768 × 512");
    assert.equal(labels[7], "1920 × 1280");
});

test("auto ratio: lens drives the ratio; picking a ratio by hand switches auto off", () => {
    const t = buildResolutionUI({ ratio: "2:3", focal: "85mm" }, { auto: true });
    assert.match(t.doc.body.textContent, /85mm is choosing the ratio/);
    t.click('[data-ratio="16:9"]');
    assert.deepEqual(t.setOptionCalls.at(-1), ["auto_ratio", false]);
    assert.equal(t.state().ratio, "16:9");
});

test("circular fisheye recommends 1:1", () => {
    const t = buildResolutionUI({ focal: "8mm" }, { fisheye: "Circular" });
    assert.equal(R.recommendedRatio(data, "8mm", "Circular"), "1:1");
    assert.ok(t.doc.querySelector('[data-ratio="1:1"]').title.includes("recommended 1:1"));
});

test("custom resolution and custom ratio show two inputs", () => {
    const a = buildResolutionUI({ ratio: "Custom Resolution" });
    assert.equal(a.doc.querySelectorAll("input[type=number]").length, 2);
    const b = buildResolutionUI({ ratio: "Custom Ratio", custom_ratio: [5, 4] });
    assert.equal(b.doc.querySelectorAll("input[type=number]").length, 2);
    assert.match(b.doc.body.textContent, /5:4/);
});

// ---------------------------------------------------------------- prompt rows
const row = (text, enabled = false) => ({ enabled, text });

test("trailing empty rows collapse to one", () => {
    const out = P.trimTrailingBlanks([row("a"), row("b", true), row(""), row(""), row(""), row("")]);
    assert.equal(out.length, 3);
});

test("empty rows in the middle are left alone; ON rows never trimmed", () => {
    assert.equal(P.trimTrailingBlanks([row("a"), row(""), row("c"), row("")]).length, 4);
    assert.equal(P.trimTrailingBlanks([row("a"), row("", true), row("")]).length, 3);
});

test("radio mode keeps one ON row", () => {
    const out = P.normaliseRows([row("a", true), row("b", true)], true);
    assert.deepEqual(out.map((r) => r.enabled), [true, false]);
});

test("remove selected (radio): removes the ON row and selects the next idea", () => {
    const rows = [row("a"), row("b", true), row("c"), row("")];
    const idx = P.pickRemoveIndex(rows, true, null);
    assert.equal(idx, 1);
    const res = P.removeRow(rows, idx, true);
    assert.deepEqual(res.rows.map((r) => r.text), ["a", "c", ""]);
    assert.deepEqual(res.rows.map((r) => r.enabled), [false, true, false]);
});

test("removing the last idea selects the one before, never the blank row", () => {
    const res = P.removeRow([row("a"), row("b"), row("c", true), row("")], 2, true);
    assert.deepEqual(res.rows.map((r) => r.text), ["a", "b", ""]);
    assert.equal(res.selected, 1);
    assert.equal(res.rows[1].enabled, true);
});

test("removing the only row clears it", () => {
    const res = P.removeRow([row("only", true)], 0, true);
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].text, "");
});

test("combine mode: removes the row you last touched, other ON rows stay", () => {
    const rows = [row("a", true), row("b", true), row("c")];
    assert.equal(P.pickRemoveIndex(rows, false, 1), 1);
    assert.equal(P.pickRemoveIndex(rows, false, null), 1);
    assert.deepEqual(P.removeRow(rows, 1, false).rows.map((r) => r.enabled), [true, false]);
});

test("nothing to remove in radio mode when no row is ON", () => {
    assert.equal(P.pickRemoveIndex([row("a"), row("b")], true, null), -1);
});

// ---------------------------------------------------------------- prompt UI (clicks)
function buildPromptUI(initialRows, mode = P.RADIO_MODE) {
    const dom = new JSDOM("<!doctype html><body></body>");
    const doc = dom.window.document;
    let rows = initialRows.map((r) => ({ ...r }));
    let changes = 0;
    const ui = P.createPromptMultiUI({
        doc,
        getRows: () => P.normaliseRows(rows, mode === P.RADIO_MODE),
        setRows: (r) => { rows = r.map((x) => ({ ...x })); },
        getMode: () => mode,
        onChange: () => { changes++; },
    });
    doc.body.appendChild(ui.outer);
    ui.render();
    const ev = (n) => new dom.window.Event(n, { bubbles: true });
    return { doc, ui, rows: () => rows, changes: () => changes,
        click: (sel) => doc.querySelector(sel).dispatchEvent(ev("click")),
        clickAt: (sel, i) => doc.querySelectorAll(sel)[i].dispatchEvent(ev("click")),
        type: (i, text) => { const ta = doc.querySelectorAll("textarea")[i]; ta.value = text; ta.dispatchEvent(ev("input")); } };
}

test("prompt UI: empty pile shown as one row; textareas auto-grow, no scroll", () => {
    const t = buildPromptUI([row("one", true), row("two"), row(""), row(""), row(""), row("")]);
    assert.equal(t.doc.querySelectorAll("textarea").length, 3);
    for (const ta of t.doc.querySelectorAll("textarea")) {
        assert.equal(ta.style.overflow, "hidden");
        assert.equal(ta.style.resize, "none");
    }
    assert.equal(t.ui.inner.style.overflowY, "");
    assert.equal(t.ui.inner.style.maxHeight, "");
});

test("prompt UI: Remove Selected removes the ON idea and selects another", () => {
    const t = buildPromptUI([row("one"), row("two", true), row("three"), row("")]);
    t.click('[data-action="remove"]');
    assert.deepEqual(t.rows().map((r) => r.text), ["one", "three", ""]);
    assert.deepEqual(t.rows().map((r) => r.enabled), [false, true, false]);
    assert.ok(t.changes() > 0);
});

test("prompt UI: Undo brings the removed idea back", () => {
    const t = buildPromptUI([row("one"), row("two", true), row("")]);
    t.click('[data-action="remove"]');
    t.click('[data-action="undo"]');
    assert.deepEqual(t.rows().map((r) => r.text), ["one", "two", ""]);
    assert.equal(t.rows()[1].enabled, true);
});

test("prompt UI: Add Idea Row adds one, but not a second empty one", () => {
    const t = buildPromptUI([row("one", true)]);
    t.click('[data-action="add"]');
    t.click('[data-action="add"]');
    assert.equal(t.rows().length, 2);
});

test("prompt UI: ON selects in radio mode; typing saves; x deletes", () => {
    const t = buildPromptUI([row("one", true), row("two"), row("")]);
    t.clickAt('[data-action="toggle"]', 1);
    assert.deepEqual(t.rows().map((r) => r.enabled), [false, true, false]);
    t.type(2, "a brand new idea");
    assert.equal(t.rows()[2].text, "a brand new idea");
    t.clickAt('[data-action="delete"]', 0);
    assert.equal(t.rows().length, 2);
});
