#!/usr/bin/env python3
# pyright: basic
"""Call a whitelisted PandaData SDK method and write JSON to stdout."""

import json
import importlib
import os
import sys
from typing import NoReturn


ALLOWED_METHODS = {
    "get_stock_daily",
    "get_fund_daily",
    "get_index_daily",
    "get_stock_detail",
    "get_fund_detail",
    "get_us_daily",
    "get_hk_daily",
}


def fail(message: str, *, retryable: bool = False, exit_code: int = 1) -> NoReturn:
    print(json.dumps({"error": message, "retryable": retryable}))
    raise SystemExit(exit_code)


def main() -> None:
    if len(sys.argv) < 2:
        fail("missing method name")

    method = sys.argv[1]
    if method not in ALLOWED_METHODS:
        fail(f"method not whitelisted: {method}")

    try:
        params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        if not isinstance(params, dict):
            fail("parameters must be a JSON object")
    except json.JSONDecodeError:
        fail("invalid JSON parameters")

    username = os.environ.get("DEFAULT_USERNAME", "")
    password = os.environ.get("DEFAULT_PASSWORD", "")
    base_url = os.environ.get("JAVA_SERVICE_BASE_URL", "")
    if not username or not password or not base_url:
        fail("missing credentials")

    try:
        panda_data = importlib.import_module("panda_data")
        panda_data.init_token(username=username, password=password, base_url=base_url)
        result = getattr(panda_data, method)(**params)
        if hasattr(result, "to_json"):
            print(result.to_json(orient="records"))
        elif hasattr(result, "__iter__") and not isinstance(result, (str, bytes, dict)):
            print(json.dumps(list(result), default=str))
        else:
            print(json.dumps(result, default=str))
    except ImportError:
        fail("panda_data not installed", exit_code=2)
    except Exception as error:
        fail(str(error), retryable=True)


if __name__ == "__main__":
    main()
