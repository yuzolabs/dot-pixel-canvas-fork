#!/usr/bin/env python3
"""Validate Cloudflare Worker input validation via HTTP requests.

Usage:
    WORKER_URL=https://your-worker.example.com python3 scripts/validate_worker.py

The script sends several test cases to POST /exchange and prints status/body.
No external dependencies are required (uses stdlib urllib).
"""

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, List, Tuple

DEFAULT_URL = "https://dot-pixel-canvas-api.yuzorayu-cloudflare.workers.dev/exchange"
# Wranglerの許可オリジン一覧のうち1つをデフォルトに採用
DEFAULT_ORIGIN = "https://yuzolabs.github.io"


def make_request(url: str, payload: Dict[str, Any], origin: str) -> Tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Origin": origin,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, body
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def valid_pixels(color: str = "#ffb7b2") -> List[str]:
    return [color for _ in range(16)]


def run_case(name: str, payload: Dict[str, Any], url: str, origin: str) -> None:
    status, body = make_request(url, payload, origin)
    print(f"[{name}] status={status}\n{body}\n{'-' * 60}")


def main() -> None:
    url = os.environ.get("WORKER_URL", DEFAULT_URL)
    origin = os.environ.get("ORIGIN", DEFAULT_ORIGIN)
    if not url.endswith("/exchange"):
        url = url.rstrip("/") + "/exchange"

    cases = {
        "valid": {
            "title": "ok",
            "pixels": valid_pixels(),
        },
        "too_long_title": {
            "title": "123456",  # 6 chars > 5
            "pixels": valid_pixels(),
        },
        "wrong_length_pixels": {
            "title": "ok",
            "pixels": valid_pixels()[:15],  # 15 instead of 16
        },
        "invalid_color_format": {
            "title": "ok",
            "pixels": ["red"] + valid_pixels()[1:],
        },
        "non_array_pixels": {
            "title": "ok",
            "pixels": "not-an-array",
        },
        "not_json_body": None,  # handled separately
    }

    for name, payload in cases.items():
        if name == "not_json_body":
            req = urllib.request.Request(
                url,
                data=b"not-json",
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Origin": origin,
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    body = resp.read().decode("utf-8", errors="replace")
                    status = resp.status
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                status = e.code
            except Exception as e:  # noqa: BLE001
                body = str(e)
                status = 0
            print(f"[not_json_body] status={status}\n{body}\n{'-' * 60}")
        else:
            run_case(name, payload, url, origin)


if __name__ == "__main__":
    if sys.version_info < (3, 8):
        print("Python 3.8+ is recommended.", file=sys.stderr)
    main()
