import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "Kreative2AI.MossNodesUI",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // Live readout for KreativeShowText and GenTimerReport
        if (nodeData.name === "KreativeShowText") {
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                onExecuted?.apply(this, arguments);
                const w = this.widgets?.find((w) => w.name === "text");
                if (w && message?.text) {
                    w.value = Array.isArray(message.text)
                        ? message.text.join("\n")
                        : String(message.text);
                    if (w.inputEl) {
                        w.inputEl.readOnly = true;
                    }
                    app.graph.setDirtyCanvas(true, true);
                }
            };
        }
    }
});
