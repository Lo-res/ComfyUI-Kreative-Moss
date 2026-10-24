import { app } from "../../scripts/app.js";
// v2: renamed file + versioned imports so browsers can never keep an old copy.
import { createResolutionUI, normaliseState, UI_HEIGHT } from "./lib/resolution_ui.js?v=xpan1";

const LENS_URL = new URL("./lenses.json?v=xpan1", import.meta.url);
let lensDataPromise = null;

function loadLensData() {
    if (!lensDataPromise) {
        lensDataPromise = fetch(LENS_URL, { cache: "no-store" }).then((r) => r.json());
    }
    return lensDataPromise;
}

const MIN_WIDTH = 470;

app.registerExtension({
    name: "Kreative2AI.ResolutionFocalUI.v2",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "KreativeResolutionFocal") return;

        const data = await loadLensData();

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;

            const stateWidget = node.widgets?.find((w) => w.name === "ui_state");
            if (!stateWidget) return;

            // Hide the raw JSON box but keep it serialised with the workflow.
            stateWidget.computeSize = () => [0, -4];
            const hideRaw = () => {
                if (stateWidget.inputEl) stateWidget.inputEl.style.display = "none";
                if (stateWidget.element) stateWidget.element.style.display = "none";
            };
            hideRaw();

            const widget = (name) => node.widgets?.find((w) => w.name === name);

            const getState = () => {
                hideRaw();
                return normaliseState(stateWidget.value, data);
            };
            const setState = (state) => {
                stateWidget.value = JSON.stringify(state);
                app.graph?.setDirtyCanvas(true, true);
            };
            const getOptions = () => ({
                snap: Number(widget("snap_to")?.value ?? 16),
                swap: Boolean(widget("swap_w_h")?.value),
                auto: Boolean(widget("auto_ratio")?.value),
                fisheye: String(widget("fisheye_type")?.value ?? "Full-frame"),
            });
            const setOption = (name, value) => {
                const w = widget(name);
                if (!w) return;
                w.value = value;
                w.callback?.(value);
            };

            const ui = createResolutionUI({
                doc: document,
                data,
                getState,
                setState,
                getOptions,
                setOption,
            });

            // Re-draw whenever a native option changes.
            ["snap_to", "swap_w_h", "auto_ratio", "fisheye_type"].forEach((name) => {
                const w = widget(name);
                if (!w) return;
                const original = w.callback;
                w.callback = function () {
                    const result = original?.apply(this, arguments);
                    ui.render();
                    return result;
                };
            });
            // lens_detail only changes the prompt text, nothing to redraw.

            // An older cached copy of this script may have added its own panel: remove it.
            const dropOld = () => {
                const old = node.widgets?.filter((w) => w.name === "kreative_resolution_ui") || [];
                for (const w of old) {
                    try { w.onRemove?.(); } catch (e) { /* ignore */ }
                    w.element?.remove?.();
                    node.widgets.splice(node.widgets.indexOf(w), 1);
                }
                node._kreativeResolutionRender = ui.render;
            };
            setTimeout(dropOld, 0);
            setTimeout(dropOld, 300);

            const domWidget = node.addDOMWidget("kreative_resolution_ui_v2", "div", ui.root, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => UI_HEIGHT,
                getMaxHeight: () => UI_HEIGHT,
                getHeight: () => UI_HEIGHT,
            });
            domWidget.computeSize = (width) => [width, UI_HEIGHT];
            domWidget.computeLayoutSize = () => ({ minHeight: UI_HEIGHT, maxHeight: UI_HEIGHT, minWidth: MIN_WIDTH - 20 });

            node._kreativeResolutionRender = ui.render;
            setTimeout(() => ui.render(), 50);

            const wantW = Math.max(node.size?.[0] ?? 0, MIN_WIDTH);
            const wantH = Math.max(node.size?.[1] ?? 0, node.computeSize?.()[1] ?? 0, UI_HEIGHT + 190);
            node.setSize([wantW, wantH]);
        };

        // Redraw after a workflow is loaded or dragged in.
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            if (this._kreativeResolutionRender) {
                setTimeout(() => this._kreativeResolutionRender(), 50);
            }
        };
    },
});
