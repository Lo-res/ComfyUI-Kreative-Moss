# Changelog

## 0.3.0
- **KreativeResolutionFocal**: panoramic lenses **XPan 45mm** (65:24) and **Widelux 26mm** (3:1) with `fixed_ratio`: always horizontal, ignore auto ratio and swap.
- New ratios 65:24 and 3:1; new sizes 2304 and 2560.
- Picker UI is taller (540 → 620) to fit the new entries.
- Live UI script is now `js/kreative_resolution_v2.js` (beats browser caching); `js/kreative_resolution.js` is an empty stub.

## 0.2.0
- New node **KreativeResolutionFocal** ("1c. Kreative Image Size + Focal Length"): ratio buttons, size list, focal-length column (8mm fisheye to 135mm), auto-ratio, fisheye type, short/full lens text, custom ratio and resolution.
- **KreativePromptMulti**: boxes auto-grow with no scrollbar, node height follows content, **Remove Selected**, **Undo**, trailing empty rows collapse to one.
- Default example ideas replaced with neutral ones (saved workflows keep their own ideas).
- Example workflows added: `moss-image-sft_example_v2.json` (shareable) and `moss-image-sft_grainy_sharp_v2.json`.
- Python and JavaScript tests, GitHub Actions workflow.
- UI code split into `js/kreative_*.js` (ComfyUI wiring) and `js/lib/` (testable logic).

## 0.1.x
- Initial nodes: multi-prompter, resolution, look selector, prompt prep/finalize, show text, timers.
