import { app } from "../../scripts/app.js";
import { createPromptMultiUI, normaliseRows, RADIO_MODE } from "./lib/promptmulti_ui.js";

const DEFAULT_ROWS = [
    { enabled: true, text: "A middle-aged man repairing a bicycle on a wet pavement in the rain" },
    { enabled: false, text: "A young woman reading a paperback on a crowded commuter train at sunrise" },
    { enabled: false, text: "An elderly fisherman mending a net on a harbour wall at dawn, gulls overhead" },
    { enabled: false, text: "Two friends laughing over coffee at a sunlit cafe window table" },
    { enabled: false, text: "A street musician playing violin under a railway arch at night, rain on the cobbles" },
    { enabled: false, text: "A child in a yellow raincoat jumping in a puddle outside a corner shop" },
    { enabled: false, text: "A baker pulling fresh loaves from a wood-fired oven in a small village bakery" }
];

const MIN_WIDTH = 520;

app.registerExtension({
    name: "Kreative2AI.PromptMultiUI",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "KreativePromptMulti") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;

            const dataWidget = node.widgets?.find((w) => w.name === "prompt_data");
            const modeWidget = node.widgets?.find((w) => w.name === "selection_mode");
            if (!dataWidget) return;

            // Hide the raw JSON backing textarea while keeping ComfyUI serialization intact
            dataWidget.computeSize = () => [0, -4];
            const hideRawInput = () => {
                if (dataWidget.inputEl) dataWidget.inputEl.style.display = "none";
                if (dataWidget.element) dataWidget.element.style.display = "none";
            };
            hideRawInput();

            const isRadio = () => !modeWidget || modeWidget.value === RADIO_MODE;

            const readRows = () => {
                hideRawInput();
                let rows = null;
                try {
                    if (dataWidget.value && dataWidget.value.trim().startsWith("[")) {
                        const parsed = JSON.parse(dataWidget.value);
                        if (Array.isArray(parsed) && parsed.length > 0) rows = parsed;
                    }
                } catch (e) {
                    // fall through to the saved properties / defaults
                }
                if (!rows && node.properties?.promptMultiState?.rows?.length) {
                    rows = node.properties.promptMultiState.rows;
                }
                if (!rows) rows = JSON.parse(JSON.stringify(DEFAULT_ROWS));
                return normaliseRows(rows, isRadio());
            };

            const writeRows = (rows) => {
                dataWidget.value = JSON.stringify(rows);
                if (!node.properties) node.properties = {};
                node.properties.promptMultiState = { version: 2, mode: "queue", rows };
                app.graph?.setDirtyCanvas(true, true);
            };

            // ---- auto height ------------------------------------------------
            let contentH = 300;
            const widgetHeight = () => contentH + 4;
            let fitting = false;

            const fit = () => {
                if (fitting) return;
                const top = domWidget.y ?? domWidget.last_y;
                let newH;
                if (typeof top === "number" && top > 0) newH = top + widgetHeight() + 10;
                else newH = node.computeSize?.()[1] ?? node.size[1];
                if (Math.abs(newH - node.size[1]) > 1) {
                    fitting = true;
                    node.setSize([Math.max(node.size[0], MIN_WIDTH), newH]);
                    fitting = false;
                    app.graph?.setDirtyCanvas(true, true);
                }
            };

            const ui = createPromptMultiUI({
                doc: document,
                getRows: readRows,
                setRows: writeRows,
                getMode: () => (modeWidget ? modeWidget.value : RADIO_MODE),
                onChange: () => requestAnimationFrame(() => measure()),
            });

            const measure = () => {
                const h = Math.ceil(ui.inner.offsetHeight);
                if (h > 0 && h !== contentH) {
                    contentH = h;
                    fit();
                }
            };

            const domWidget = node.addDOMWidget("kreative_multiprompt_ui", "div", ui.outer, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => widgetHeight(),
                getMaxHeight: () => widgetHeight(),
                getHeight: () => widgetHeight(),
            });
            domWidget.computeSize = (width) => [width, widgetHeight()];
            domWidget.computeLayoutSize = () => ({
                minHeight: widgetHeight(),
                maxHeight: widgetHeight(),
                minWidth: 300,
            });

            // Re-measure whenever the content size changes (typing, add/remove, width change).
            if (typeof ResizeObserver !== "undefined") {
                let lastW = 0;
                const ro = new ResizeObserver(() => {
                    const w = ui.inner.offsetWidth;
                    if (w && w !== lastW) {
                        lastW = w;
                        ui.growAll(); // text re-wraps when the node is made wider or narrower
                    }
                    measure();
                });
                ro.observe(ui.inner);
                const onRemoved = node.onRemoved;
                node.onRemoved = function () {
                    ro.disconnect();
                    onRemoved?.apply(this, arguments);
                };
            }

            // Keep every prompt visible: snap the height back to the content if someone drags it.
            const onResize = node.onResize;
            node.onResize = function () {
                onResize?.apply(this, arguments);
                requestAnimationFrame(() => fit());
            };

            // Same mode switch as before: re-draw so a stray extra ON row is tidied in radio mode.
            if (modeWidget) {
                const cb = modeWidget.callback;
                modeWidget.callback = function () {
                    const r = cb?.apply(this, arguments);
                    ui.render();
                    return r;
                };
            }

            node._kreativeRenderRows = () => {
                ui.render();
                requestAnimationFrame(() => measure());
            };

            setTimeout(() => node._kreativeRenderRows(), 50);
            if (node.size[0] < MIN_WIDTH) node.setSize([MIN_WIDTH, node.size[1]]);
        };

        // Re-render rows whenever a workflow JSON is loaded / dragged into ComfyUI
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            if (this._kreativeRenderRows) {
                setTimeout(() => this._kreativeRenderRows(), 50);
            }
        };
    },
});
