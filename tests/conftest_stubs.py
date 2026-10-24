"""Lightweight stand-ins so nodes.py can be imported outside ComfyUI (no torch / folder_paths needed)."""
import sys
import types


def install():
    if "folder_paths" not in sys.modules:
        fp = types.ModuleType("folder_paths")
        fp.get_output_directory = lambda: "."
        sys.modules["folder_paths"] = fp

    try:
        import torch  # noqa: F401
    except ImportError:
        class _FakeTensor:
            def __init__(self, shape):
                self.shape = tuple(shape)

        torch = types.ModuleType("torch")
        torch.zeros = lambda shape: _FakeTensor(shape)
        sys.modules["torch"] = torch
