"""Small, non-authorizing Office source coordinates carried by indexed chunks."""

import re
from typing import Any


def office_source_locator(value: object) -> dict[str, Any] | None:
    if not isinstance(value, dict) or value.get("kind") not in {"sheet", "slide"}:
        return None
    kind = value["kind"]
    result: dict[str, Any] = {"kind": kind}
    if kind == "sheet":
        name = value.get("sheet_name")
        if not isinstance(name, str) or not name.strip() or len(name) > 128:
            return None
        result["sheet_name"] = name
        for key in ("column_name", "column_end"):
            column = value.get(key)
            if not isinstance(column, str) or re.fullmatch(r"[A-Z]{1,3}", column) is None:
                return None
            result[key] = column
    else:
        number = value.get("slide_number")
        if type(number) is not int or not 1 <= number <= 1000:
            return None
        result["slide_number"] = number
        for key in ("shape_id", "table_id"):
            if key in value:
                number = value[key]
                if type(number) is not int or number < 1:
                    return None
                result[key] = number
        if value.get("part") == "notes":
            result["part"] = "notes"
    rows = value.get("row_numbers")
    if rows is not None:
        if (not isinstance(rows, list) or not 1 <= len(rows) <= 5000
                or any(type(row) is not int or not 1 <= row <= 1_048_576 for row in rows)
                or rows != sorted(set(rows))):
            return None
        result["row_numbers"] = list(rows)
    elif kind == "sheet":
        return None
    return result


def same_source_locator(left: object, right: object, *, required: bool = False) -> bool:
    # Missing/invalid coordinates must never borrow a known locator from a
    # neighbouring chunk. Non-Office sources keep their existing page boundary.
    if left is None and right is None:
        return not required
    parsed = office_source_locator(left)
    return parsed is not None and parsed == office_source_locator(right)
