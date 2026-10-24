# ComfyUI-Kreative-Moss

Custom nodes and a ready-to-run workflow for the **Moss image model** in ComfyUI, by Kreative2AI.

v0.3.0 adds:

- **Panoramic lenses** in 1c: **XPan 45mm** (65:24) and **Widelux 26mm** (3:1). Both are always horizontal.
- New ratios **65:24** and **3:1**, new sizes **2304** and **2560**.

v0.2.0 added:

- **1c. Image Size + Focal Length**: ratio buttons, a size list and a camera lens column (8mm fisheye to 135mm) in one node. The lens adds a prompt sentence and can pick a realistic crop for you.
- **1a. Multi-Prompter that grows with your ideas**: no scrollbar, every idea always visible, plus **Remove Selected** and **Undo**.

## Install

1. Put this folder in `ComfyUI/custom_nodes/` (keep the folder name `ComfyUI-Kreative-Moss`).
2. Restart ComfyUI and hard-refresh the browser (Ctrl + F5).
3. No extra Python packages are needed beyond what ComfyUI already has.

```
cd ComfyUI/custom_nodes
git clone https://github.com/Lo-res/ComfyUI-Kreative-Moss.git
```

## The workflow

`workflows/moss-image-sft_example_v2.json` is the full Moss text-to-image workflow (prompt writer, first pass, optional second pass, sharpen, film grain, timers). Drag it onto the ComfyUI canvas.

It also needs these node packs (ComfyUI Manager: "Install Missing Custom Nodes"):

| Pack | Used for |
|---|---|
| [rgthree-comfy](https://github.com/rgthree/rgthree-comfy) | Power Lora Loader, switches, group muters |
| ComfyUI-Pixaroma | the "FINAL PROMPT" and timer text displays |
| [comfyui-propost](https://github.com/digitaljohn/comfyui-propost) | film grain (step 4c) |

You also need the Moss model files (UNET, text encoder, VAE) and a prompt-writer LLM, chosen in the loader nodes. No models are included.

`moss-image-sft_grainy_sharp_v2.json` is the author's own copy with their saved ideas and LoRA setting.

## 1c. Image Size + Focal Length

Pick a **ratio** (top), a **size** (left list) and optionally a **lens** (right list).

| Lens | What it adds to the prompt | Recommended crop |
|---|---|---|
| Off | nothing | any |
| 8mm fisheye | ultra-wide ~180 degrees, strong barrel distortion | 3:2 (full-frame) or 1:1 (circular) |
| 16mm | very wide, dramatic perspective, strong depth | 3:2 |
| 24mm | wide, generous environment, gentle exaggeration | 3:2 |
| 35mm | classic documentary view, slightly wider than the eye | 3:2 |
| 50mm | natural human field of view, true-to-life proportions | 3:2 |
| 85mm | flattering portrait perspective, compressed soft background | 4:5 |
| 135mm | tight telephoto, strong background compression | 2:3 |
| XPan 45mm (panoramic) | Hasselblad XPan: ultra-wide cinematic letterbox, straight undistorted lines | **65:24, fixed** |
| Widelux 26mm (swing lens) | 140° swing-lens panorama, horizon lines bow into gentle curves | **3:1, fixed** |

**Panoramic lenses (XPan, Widelux):** these are always horizontal and lock their own ratio. While one is picked, the ratio buttons, **auto_ratio** and **swap_w_h** are ignored. Pick a big size (**2304** or **2560**) so the picture isn't too short.

**Options below the picker**

- **auto_ratio**: *Lens picks the ratio* uses the recommended crop for the lens. Clicking a ratio yourself switches it back to manual. The size you picked in the list (the long side) is kept.
- **swap_w_h**: flips landscape and portrait. Wide-lens crops are landscape, so use this for vertical frames.
- **fisheye_type**: Full-frame or Circular, only used for 8mm.
- **lens_detail**: *Full description* or *Short tag* ("shot with a 50mm focal length lens").
- **snap_to**: sizes are rounded to a multiple of this (16 by default). The list always shows the real snapped numbers.
- **Custom Ratio** / **Custom Resolution**: type your own ratio, or exact width and height (rounded to `snap_to`, max 8192).

**Outputs**: `width`, `height`, `latent`, `lens_text`, `batch_size`. Wire `width` / `height` / `batch_size` into your latent node and `lens_text` into the prompt (the example workflow adds it right after the look description). The first three outputs sit in the same slots as the older **1c. Kreative Image Size** node.

Lens text is written in positive wording on purpose: image models often do the opposite of "no distortion", and the workflow's safety net strips "no / not / without" phrases.

The lens and ratio tables live in one file, `js/lenses.json`. Edit the wording or recommended crops there; Python and the browser UI both read it.

## 1a. Multi-Prompter

- Each idea box grows with its text and the node resizes itself, so nothing scrolls. Dragging the node taller or shorter snaps it back to fit.
- **+ Add Idea Row** adds a blank row (or jumps to the blank one already there).
- **- Remove Selected** removes the idea that is ON (Single Active mode) or the one you last clicked (Combine mode). In Single Active mode the next idea is switched ON, so a run never starts with nothing selected.
- **Undo** (appears after a removal) restores the last removed idea. Up to 10 steps, cleared when the page reloads.
- The x on a row still deletes that row. Piles of empty rows at the end collapse to one.

## Other nodes in this pack

`KreativeResolution` (older size picker), `KreativeLookSelector`, `KreativePromptPrep`, `KreativePromptFinalize`, `KreativeShowText`, `GenTimerLap`, `GenTimerReport` (writes `output/gen_times.csv`). Unchanged.

## Tests

```
python -m unittest tests.test_nodes          # Python logic, no ComfyUI or GPU needed
cd tests/js && npm install && npm test       # browser UI logic, simulated DOM
```

`tests/fixtures/size_cases.json` holds 130 size cases that both the Python and JavaScript tests must reproduce, so the two sides cannot drift apart.

The tests use simulated nodes. They cannot check how the UI looks or how tall rows render in a real browser, so if something looks off please open an issue with a screenshot.

## Credits

Film grain by [comfyui-propost](https://github.com/digitaljohn/comfyui-propost).

## Licence

MIT, see `LICENSE`.
