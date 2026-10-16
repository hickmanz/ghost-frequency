"""Run: python -m server  (from the python/ directory)"""

from __future__ import annotations

import uvicorn

from .config import host, port


def main() -> None:
    uvicorn.run("server.app:app", host=host(), port=port(), reload=False)


if __name__ == "__main__":
    main()
