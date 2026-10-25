import sys
import types
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1]
if str(DATA_DIR) not in sys.path:
    sys.path.insert(0, str(DATA_DIR))


def install_stub_module(name: str, **attrs) -> types.ModuleType:
    """Registers a fake third-party module (e.g. browser_cookie3, playwright) so scripts that import it at module level can be loaded in CI without the real dependency."""
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module
