import os
import re
import time
import csv
import json
import math
import torch
import folder_paths


class AnyType(str):
    """Wildcard type that matches any ComfyUI socket."""
    def __ne__(self, __value: object) -> bool:
        return False


ANY_TYPE = AnyType("*")

# Global timer tracking across a single generation run
_TIMER_SESSION = {
    "start_time": 0.0,
    "last_lap_time": 0.0,
    "laps": [],
    "active": False,
}


def _ensure_timer_started():
    global _TIMER_SESSION
    now = time.time()
    if not _TIMER_SESSION.get("active", False) or (now - _TIMER_SESSION.get("start_time", 0.0)) > 600:
        _TIMER_SESSION["start_time"] = now
        _TIMER_SESSION["last_lap_time"] = now
        _TIMER_SESSION["laps"] = []
        _TIMER_SESSION["active"] = True


DEFAULT_PROMPTS_LIST = [
    {
        "enabled": True,
        "text": "A middle-aged man repairing a bicycle on a wet pavement in the rain"
    },
    {
        "enabled": False,
        "text": "A young woman reading a paperback on a crowded commuter train at sunrise"
    },
    {
        "enabled": False,
        "text": "An elderly fisherman mending a net on a harbour wall at dawn, gulls overhead"
    },
    {
        "enabled": False,
        "text": "Two friends laughing over coffee at a sunlit cafe window table"
    },
    {
        "enabled": False,
        "text": "A street musician playing violin under a railway arch at night, rain on the cobbles"
    },
    {
        "enabled": False,
        "text": "A child in a yellow raincoat jumping in a puddle outside a corner shop"
    },
    {
        "enabled": False,
        "text": "A baker pulling fresh loaves from a wood-fired oven in a small village bakery"
    }
]

DEFAULT_PROMPTS_JSON = json.dumps(DEFAULT_PROMPTS_LIST, ensure_ascii=False)

DEFAULT_SYSTEM_PROMPT = (
    "You write image descriptions for a text-to-image model. The user message holds an idea inside <idea> tags.\n\n"
    "TASK: Turn the idea into ONE paragraph of 140 to 180 words that describes a single photograph. "
    "Open with the subject and what they are doing. Then cover pose and expression, clothing, the setting from "
    "foreground to background, light, and colours. Every sentence states something visible in the frame. "
    "Keep every fact from the idea exactly as given and add only details that fit it naturally. "
    "Describe the scene itself only; the camera and film look are added elsewhere.\n\n"
    "EXAMPLE\n"
    "<idea>a man repairing a bicycle on a wet pavement</idea>\n"
    "A middle-aged man in a faded green raincoat crouches beside an upturned bicycle, one hand steadying the rear "
    "wheel while the other turns a small wrench on the axle. His brow is furrowed in concentration and rain beads "
    "on his dark cap. The pavement glistens around him, reflecting the amber glow of a shopfront whose shutters "
    "are half lowered. Behind him a row of terraced houses fades into soft grey drizzle, with a red postbox "
    "standing at the corner. Cool daylight falls evenly from an overcast sky, picking out the chrome of the spokes "
    "and the wet sheen on his sleeves. Muted greens, greys and a single warm amber highlight give the street a "
    "quiet, lived-in mood.\n\n"
    "Reply with the paragraph only."
)


class KreativePromptMulti:
    """Multi-Prompter with interactive ON/OFF buttons in the ComfyUI frontend."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "selection_mode": (
                    ["Single Active (Radio)", "Combine All ON Rows", "One image per ON row"],
                    {"default": "Single Active (Radio)"}
                ),
                "delimiter": ("STRING", {"default": " ", "multiline": False}),
                "prompt_data": ("STRING", {"default": DEFAULT_PROMPTS_JSON, "multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("text", "prompts")
    FUNCTION = "get_prompt"
    CATEGORY = "Kreative2AI/Moss"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def get_prompt(self, selection_mode: str, delimiter: str, prompt_data: str):
        global _TIMER_SESSION
        now = time.time()
        _TIMER_SESSION["start_time"] = now
        _TIMER_SESSION["last_lap_time"] = now
        _TIMER_SESSION["laps"] = []
        _TIMER_SESSION["active"] = True

        rows = []
        if prompt_data and prompt_data.strip():
            try:
                parsed = json.loads(prompt_data)
                if isinstance(parsed, list):
                    rows = parsed
            except Exception:
                rows = [{"enabled": True, "text": prompt_data.strip()}]

        if not rows:
            rows = DEFAULT_PROMPTS_LIST

        enabled_texts = [
            str(r.get("text", "")).strip()
            for r in rows
            if isinstance(r, dict) and r.get("enabled", False) and str(r.get("text", "")).strip()
        ]

        if not enabled_texts:
            for r in reversed(rows):
                if isinstance(r, dict) and str(r.get("text", "")).strip():
                    enabled_texts = [str(r["text"]).strip()]
                    break

        if not enabled_texts:
            return ("", "")

        # "One image per ON row": pressing Run queues one run per ON row (js/kreative_promptmulti.js),
        # so each run arrives here with a single row ON. If several do arrive (e.g. via the API), use the first.
        if selection_mode in ("Single Active (Radio)", "One image per ON row"):
            final_text = enabled_texts[0]
        else:
            sep = delimiter.replace("\\n", "\n") if delimiter else "\n\n"
            final_text = sep.join(enabled_texts)

        return (final_text, "\n---\n".join(enabled_texts))


class KreativeResolution:
    """Aspect-ratio & resolution selector with 16px snapping (replaces PixaromaResolution)."""

    PRESETS = {
        "2:3 Portrait (1088x1632) [Moss Default]": (1088, 1632),
        "3:2 Landscape (1632x1088)": (1632, 1088),
        "1:1 Square (1024x1024)": (1024, 1024),
        "3:4 Portrait (1024x1360)": (1024, 1360),
        "4:3 Landscape (1360x1024)": (1360, 1024),
        "4:5 Portrait (1024x1280)": (1024, 1280),
        "16:9 Cinema (1536x864)": (1536, 864),
        "9:16 Vertical (864x1536)": (864, 1536),
        "Custom": (1024, 1024),
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "preset": (list(cls.PRESETS.keys()), {"default": "2:3 Portrait (1088x1632) [Moss Default]"}),
                "swap_w_h": ("BOOLEAN", {"default": False, "label_on": "Swapped (W<->H)", "label_off": "Normal"}),
                "custom_width": ("INT", {"default": 1088, "min": 256, "max": 4096, "step": 16}),
                "custom_height": ("INT", {"default": 1632, "min": 256, "max": 4096, "step": 16}),
                "snap_to": ("INT", {"default": 16, "min": 8, "max": 64, "step": 8}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "LATENT")
    RETURN_NAMES = ("width", "height", "latent")
    FUNCTION = "get_resolution"
    CATEGORY = "Kreative2AI/Moss"

    def get_resolution(self, preset: str, swap_w_h: bool, custom_width: int, custom_height: int, snap_to: int):
        if preset == "Custom":
            w, h = custom_width, custom_height
        else:
            w, h = self.PRESETS.get(preset, (1088, 1632))

        if swap_w_h:
            w, h = h, w

        w = int(max(snap_to, round(w / snap_to) * snap_to))
        h = int(max(snap_to, round(h / snap_to) * snap_to))
        latent = {"samples": torch.zeros([1, 4, h // 8, w // 8])}
        return (w, h, latent)


# ---------------------------------------------------------------------------
# Image size + focal length
# ---------------------------------------------------------------------------

_LENS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "js", "lenses.json")


def load_lens_data(path: str = _LENS_FILE) -> dict:
    """Lens / ratio / size tables. Shared with the browser UI so both sides always agree."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


LENS_DATA = load_lens_data()
LONG_SIDES = list(LENS_DATA["long_sides"])
RATIOS = list(LENS_DATA["ratios"])
LENSES = {item["id"]: item for item in LENS_DATA["focal_lengths"]}
FOCAL_IDS = [item["id"] for item in LENS_DATA["focal_lengths"]]
CUSTOM_RATIO = "Custom Ratio"
CUSTOM_RES = "Custom Resolution"
MAX_DIM = 8192

DEFAULT_RES_STATE = {
    "ratio": "2:3",
    "size_index": LONG_SIDES.index(1632) if 1632 in LONG_SIDES else 0,
    "custom_ratio": [3, 2],
    "custom_res": [1024, 1024],
    "focal": "Off",
}
DEFAULT_RES_STATE_JSON = json.dumps(DEFAULT_RES_STATE)


def snap_value(value: float, snap: int) -> int:
    """Round to the nearest multiple of snap (halves round up, identical to the JS UI)."""
    snap = max(1, int(snap))
    return int(max(snap, math.floor(value / snap + 0.5) * snap))


def parse_ratio(key: str):
    m = re.fullmatch(r"(\d+):(\d+)", str(key).strip())
    if not m:
        return None
    a, b = int(m.group(1)), int(m.group(2))
    return (a, b) if a > 0 and b > 0 else None


def size_for_ratio(rw: int, rh: int, long_side: int, snap: int):
    """Long side is fixed, the short side follows the ratio. Both are snapped."""
    if rw >= rh:
        w, h = float(long_side), long_side * rh / rw
    else:
        h, w = float(long_side), long_side * rw / rh
    return snap_value(w, snap), snap_value(h, snap)


def _clamp_int(value, lo, hi, fallback):
    try:
        v = int(round(float(value)))
    except (TypeError, ValueError):
        return fallback
    return max(lo, min(hi, v))


def normalise_res_state(raw) -> dict:
    """Parse the JSON blob written by the UI. Anything odd falls back to safe defaults."""
    state = json.loads(json.dumps(DEFAULT_RES_STATE))
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except Exception:
            data = {}
    if not isinstance(data, dict):
        data = {}

    ratio = data.get("ratio")
    if ratio in RATIOS or ratio in (CUSTOM_RATIO, CUSTOM_RES):
        state["ratio"] = ratio
    state["size_index"] = _clamp_int(data.get("size_index"), 0, len(LONG_SIDES) - 1, state["size_index"])

    cr = data.get("custom_ratio")
    if isinstance(cr, (list, tuple)) and len(cr) == 2:
        state["custom_ratio"] = [_clamp_int(cr[0], 1, 99, 3), _clamp_int(cr[1], 1, 99, 2)]
    cres = data.get("custom_res")
    if isinstance(cres, (list, tuple)) and len(cres) == 2:
        state["custom_res"] = [_clamp_int(cres[0], 64, MAX_DIM, 1024), _clamp_int(cres[1], 64, MAX_DIM, 1024)]

    focal = data.get("focal")
    state["focal"] = focal if focal in LENSES else "Off"
    return state


def recommended_ratio(focal: str, fisheye_type: str = "Full-frame") -> str:
    lens = LENSES.get(focal)
    if not lens or not lens.get("ratio"):
        return ""
    if focal == "8mm" and fisheye_type == "Circular" and lens.get("ratio_circular"):
        return lens["ratio_circular"]
    return lens["ratio"]


def resolve_resolution(state, swap_w_h=False, snap_to=16, auto_ratio=False, fisheye_type="Full-frame"):
    """Returns (width, height, ratio_label)."""
    st = normalise_res_state(state)
    snap = max(1, int(snap_to))
    ratio_key = st["ratio"]

    if auto_ratio and st["focal"] != "Off":
        rec = recommended_ratio(st["focal"], fisheye_type)
        if rec:
            ratio_key = rec

    fixed = bool(LENSES.get(st["focal"], {}).get("fixed_ratio"))
    if fixed:  # panoramic lenses (XPan, Widelux) lock their own ratio, always horizontal
        ratio_key = LENSES[st["focal"]]["ratio"]

    if ratio_key == CUSTOM_RES:
        w = snap_value(st["custom_res"][0], snap)
        h = snap_value(st["custom_res"][1], snap)
        label = "custom"
    else:
        if ratio_key == CUSTOM_RATIO:
            rw, rh = st["custom_ratio"]
            label = f"{rw}:{rh}"
        else:
            rw, rh = parse_ratio(ratio_key) or (2, 3)
            label = ratio_key
        w, h = size_for_ratio(rw, rh, LONG_SIDES[st["size_index"]], snap)

    w, h = min(w, MAX_DIM), min(h, MAX_DIM)
    if swap_w_h and not fixed:
        w, h = h, w
    return w, h, label


def lens_text(focal: str, fisheye_type: str = "Full-frame", detail: str = "Full description") -> str:
    lens = LENSES.get(focal)
    if not lens or focal == "Off":
        return ""
    circular = focal == "8mm" and fisheye_type == "Circular"
    if detail == "Short tag":
        return (lens.get("short_circular") if circular else lens.get("short")) or ""
    return (lens.get("prompt_circular") if circular else lens.get("prompt")) or ""


class KreativeResolutionFocal:
    """Image size picker (ratio buttons + size list) with a built-in focal length selector.

    The look of the node is drawn by js/kreative_resolution.js. The choices are stored in the
    hidden `ui_state` JSON so they save with the workflow like any other widget.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ui_state": ("STRING", {"default": DEFAULT_RES_STATE_JSON, "multiline": True}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 64}),
                "snap_to": ("INT", {"default": 16, "min": 8, "max": 64, "step": 8}),
                "swap_w_h": ("BOOLEAN", {"default": False, "label_on": "Swapped (W<->H)", "label_off": "Normal"}),
                "auto_ratio": ("BOOLEAN", {"default": False, "label_on": "Lens picks the ratio", "label_off": "Manual ratio"}),
                "fisheye_type": (["Full-frame", "Circular"], {"default": "Full-frame"}),
                "lens_detail": (["Full description", "Short tag"], {"default": "Full description"}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "LATENT", "STRING", "INT")
    RETURN_NAMES = ("width", "height", "latent", "lens_text", "batch_size")
    FUNCTION = "get_resolution"
    CATEGORY = "Kreative2AI/Moss"

    def get_resolution(self, ui_state: str, batch_size: int, snap_to: int, swap_w_h: bool,
                       auto_ratio: bool, fisheye_type: str, lens_detail: str):
        state = normalise_res_state(ui_state)
        w, h, _ = resolve_resolution(state, swap_w_h, snap_to, auto_ratio, fisheye_type)
        text = lens_text(state["focal"], fisheye_type, lens_detail)
        batch = max(1, int(batch_size))
        # Placeholder latent kept for compatibility with KreativeResolution. The Moss workflow
        # feeds width/height into EmptyFlux2LatentImage instead.
        latent = {"samples": torch.zeros([batch, 4, h // 8, w // 8])}
        return (w, h, latent, text, batch)


class KreativeLookSelector:
    """Single-node Look Switcher replacing the 7-node Look A/B muter + switch setup."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "active_look": (
                    ["Look A - 1970s Kodachrome", "Look B - Cheap iPhone"],
                    {"default": "Look A - 1970s Kodachrome"}
                ),
                "look_a_prefix": ("STRING", {
                    "default": "A candid 1970s kodachrome photograph.",
                    "multiline": False
                }),
                "look_a_description": ("STRING", {
                    "default": "Candid 1970s Kodachrome snapshot on 35mm film: authentic film grain, slightly desaturated muted colors, warm faded tones, soft natural vignetting, mild halation around bright highlights, unposed amateur framing.",
                    "multiline": True
                }),
                "look_b_prefix": ("STRING", {
                    "default": "Cheap phone iPhone grainy amateur.",
                    "multiline": False
                }),
                "look_b_description": ("STRING", {
                    "default": "Cheap old iPhone snapshot: heavy digital grain, noise and compression artifacts, soft imperfect focus, slight motion blur, blown-out highlights, harsh on-camera flash if night, smudged lens, casual off-center framing.",
                    "multiline": True
                }),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("look_prefix", "look_description")
    FUNCTION = "select_look"
    CATEGORY = "Kreative2AI/Moss"

    def select_look(self, active_look: str, look_a_prefix: str, look_a_description: str, look_b_prefix: str, look_b_description: str):
        if active_look.startswith("Look A"):
            return (look_a_prefix.strip(), look_a_description.strip())
        return (look_b_prefix.strip(), look_b_description.strip())


class KreativePromptPrep:
    """Replaces the 3 StringConcatenate nodes before TextGenerate (system prompt + <idea> tags)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "idea": ("STRING", {"forceInput": True}),
                "system_prompt": ("STRING", {"default": DEFAULT_SYSTEM_PROMPT, "multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("system_prompt", "user_prompt")
    FUNCTION = "prep"
    CATEGORY = "Kreative2AI/Moss"

    def prep(self, idea: str, system_prompt: str):
        wrapped = f"<idea>\n{idea.strip()}\n</idea>\n\nWrite one paragraph that describes only what is visible in the frame."
        return (system_prompt, wrapped)


class KreativePromptFinalize:
    """Replaces the 2 RegexReplace safety nets and 2 StringConcatenate look mergers after TextGenerate."""

    NEG_PATTERN = r"(?:[,;—–]\s*)?\b(?:no|not|nothing|nobody|never|without|devoid of|free of|lacking|absent)\b[^.,;—–\n]*"
    PUNCT_PATTERN = r"(?<=\.)\s*\.+|\s*[,;—–]+\s*(?=\.)|\s+(?=[.,;])"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "generated_text": ("STRING", {"forceInput": True}),
                "look_prefix": ("STRING", {"forceInput": True}),
                "look_description": ("STRING", {"forceInput": True}),
                "strip_negative_phrases": ("BOOLEAN", {"default": True}),
                "tidy_punctuation": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("final_prompt",)
    FUNCTION = "finalize"
    CATEGORY = "Kreative2AI/Moss"

    def finalize(self, generated_text: str, look_prefix: str, look_description: str, strip_negative_phrases: bool, tidy_punctuation: bool):
        cleaned = generated_text.strip()
        if strip_negative_phrases:
            cleaned = re.sub(self.NEG_PATTERN, "", cleaned, flags=re.IGNORECASE)
        if tidy_punctuation:
            cleaned = re.sub(self.PUNCT_PATTERN, "", cleaned, flags=re.IGNORECASE)

        parts = [p.strip() for p in (look_prefix, cleaned, look_description) if p and p.strip()]
        return (" ".join(parts),)


class KreativeShowText:
    """Displays incoming text on the node and passes the STRING through (replaces PixaromaShowText)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source": (ANY_TYPE, {}),
            },
            "optional": {
                "text": ("STRING", {"default": "", "multiline": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_NODE = True
    FUNCTION = "notify"
    CATEGORY = "Kreative2AI/Moss"

    def notify(self, source=None, text="", unique_id=None, extra_pnginfo=None):
        if isinstance(source, (list, tuple)):
            out_str = "\n".join(str(x) for x in source)
        elif source is None:
            out_str = str(text or "")
        else:
            out_str = str(source)

        return {"ui": {"text": [out_str]}, "result": (out_str,)}


class GenTimerLap:
    """Measures lap execution time and passes data through."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (ANY_TYPE, {}),
                "label": ("STRING", {"default": "Lap"}),
            }
        }

    RETURN_TYPES = (ANY_TYPE,)
    RETURN_NAMES = ("value",)
    FUNCTION = "lap"
    CATEGORY = "Kreative2AI/Moss"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def lap(self, value, label="Lap"):
        global _TIMER_SESSION
        _ensure_timer_started()
        now = time.time()
        step_time = now - _TIMER_SESSION["last_lap_time"]
        total_elapsed = now - _TIMER_SESSION["start_time"]
        _TIMER_SESSION["last_lap_time"] = now
        _TIMER_SESSION["laps"].append({
            "label": str(label),
            "step": step_time,
            "total": total_elapsed,
        })
        return (value,)


class GenTimerReport:
    """Aggregates timer laps, outputs generation report string, and logs to CSV."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (ANY_TYPE, {}),
                "run_note": ("STRING", {"default": ""}),
                "log_csv": ("BOOLEAN", {"default": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("timing",)
    OUTPUT_NODE = True
    FUNCTION = "report"
    CATEGORY = "Kreative2AI/Moss"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def report(self, image, run_note="", log_csv=True, unique_id=None, extra_pnginfo=None):
        global _TIMER_SESSION
        _ensure_timer_started()
        now = time.time()
        total_time = now - _TIMER_SESSION["start_time"]

        lines = ["=== GENERATION TIMES ==="]
        if run_note and run_note.strip():
            lines.append(f"Note: {run_note.strip()}")

        for item in _TIMER_SESSION.get("laps", []):
            lines.append(f"{item['label']}: {item['step']:.2f}s (elapsed: {item['total']:.2f}s)")

        lines.append(f"Total: {total_time:.2f}s")
        final_text = "\n".join(lines)

        if log_csv:
            try:
                output_dir = folder_paths.get_output_directory()
                csv_path = os.path.join(output_dir, "gen_times.csv")
                file_exists = os.path.exists(csv_path)
                with open(csv_path, mode="a", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)
                    if not file_exists:
                        writer.writerow(["Timestamp", "Run Note", "Total Time (s)", "Laps"])
                    laps_summary = "; ".join(
                        f"{x['label']}={x['step']:.2f}s" for x in _TIMER_SESSION.get("laps", [])
                    )
                    writer.writerow([
                        time.strftime("%Y-%m-%d %H:%M:%S"),
                        run_note.strip(),
                        f"{total_time:.2f}",
                        laps_summary,
                    ])
            except Exception as e:
                print(f"[ComfyUI-Kreative-Moss] CSV log warning: {e}")

        # Mark session inactive so the next run starts fresh even if prompt nodes are cached
        _TIMER_SESSION["active"] = False

        return {"ui": {"text": [final_text]}, "result": (final_text,)}


NODE_CLASS_MAPPINGS = {
    "KreativePromptMulti": KreativePromptMulti,
    "KreativeResolution": KreativeResolution,
    "KreativeResolutionFocal": KreativeResolutionFocal,
    "KreativeLookSelector": KreativeLookSelector,
    "KreativePromptPrep": KreativePromptPrep,
    "KreativePromptFinalize": KreativePromptFinalize,
    "KreativeShowText": KreativeShowText,
    "GenTimerLap": GenTimerLap,
    "GenTimerReport": GenTimerReport,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KreativePromptMulti": "1a. Kreative Multi-Prompter (ON/OFF)",
    "KreativeResolution": "1c. Kreative Image Size",
    "KreativeResolutionFocal": "1c. Kreative Image Size + Focal Length",
    "KreativeLookSelector": "1b. Kreative Look Selector (Kodachrome / iPhone)",
    "KreativePromptPrep": "2a. Kreative Prompt Prep (System + Idea Tags)",
    "KreativePromptFinalize": "2b. Kreative Prompt Finalize (Safety + Look Merger)",
    "KreativeShowText": "Kreative Show Text",
    "GenTimerLap": "TIMER - Lap",
    "GenTimerReport": "TIMER REPORT - Summary & CSV Log",
}
