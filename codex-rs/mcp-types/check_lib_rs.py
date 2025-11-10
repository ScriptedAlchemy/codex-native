#!/usr/bin/env python3

import shutil
import subprocess
import sys
from pathlib import Path

MIN_VERSION = (3, 10)


def version_ok() -> bool:
    return sys.version_info >= MIN_VERSION


def python_for_generator() -> str:
    if version_ok():
        return sys.executable

    for candidate in ("python3.12", "python3.11", "python3.10", "python3"):
        path = shutil.which(candidate)
        if not path or path == sys.executable:
            continue

        result = subprocess.run(
            [path, "-c", "import sys; exit(0 if sys.version_info >= (3, 10) else 1)"],
            check=False,
        )
        if result.returncode == 0:
            return path

    raise RuntimeError(
        "Python 3.10+ is required to generate MCP types. "
        "Install Python 3.10 or newer and ensure it is discoverable as python3."
    )


def main() -> int:
    crate_dir = Path(__file__).resolve().parent
    generator = crate_dir / "generate_mcp_types.py"

    python_exe = python_for_generator()

    result = subprocess.run(
        [python_exe, str(generator), "--check"],
        cwd=crate_dir,
        check=False,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
