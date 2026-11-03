#!/usr/bin/env python3
"""Apply a GAHI label approval to one fixed repo, then read the labels back.

Usage: apply-labels.py approval.json [--dry-run]    or    apply-labels.py --self-test
The approval is untrusted data: every value is checked against live GitHub
before anything is written, and one bad value stops the whole run.
"""
import json
import subprocess
import sys
from datetime import datetime, timezone

REPO = "bekhruzbekswe/odatchik"
MAX_ITEMS = 100


def validate(doc, open_numbers, valid_labels):
    """Return a list of problems. An empty list means the approval is safe to apply."""
    if not isinstance(doc, dict):
        return ["approval is not an object"]
    problems = []
    if doc.get("repo") != REPO:
        problems.append(f"repo must be {REPO}")
    if not isinstance(doc.get("id"), str) or not doc["id"]:
        problems.append("missing approval id")
    extra = set(doc) - {"id", "repo", "labels", "approvedAt"}
    if extra:
        problems.append(f"unexpected fields: {sorted(extra)}")
    items = doc.get("labels")
    if not isinstance(items, list) or not items or len(items) > MAX_ITEMS:
        return problems + ["labels must be a non-empty list of a sensible size"]
    seen = set()
    for item in items:
        if not isinstance(item, dict) or set(item) != {"number", "add"}:
            problems.append(f"bad item: {item!r}")
            continue
        number, add = item["number"], item["add"]
        if type(number) is not int or number not in open_numbers:
            problems.append(f"not an open issue: {number!r}")
        if number in seen:
            problems.append(f"issue listed twice: {number!r}")
        seen.add(number)
        if not isinstance(add, list) or not add:
            problems.append(f"no labels for issue {number!r}")
            continue
        for name in add:
            if not isinstance(name, str) or name not in valid_labels:
                problems.append(f"not a repo label: {name!r}")
    return problems


def gh(*args):
    # Arguments go straight to gh with no shell, so approval values can't run as commands.
    return subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60)


def gh_json(*args):
    res = gh(*args)
    if res.returncode:
        raise RuntimeError(res.stderr.strip())
    return json.loads(res.stdout)


def label_names(number):
    data = gh_json("issue", "view", str(number), "-R", REPO, "--json", "labels")
    return [label["name"] for label in data["labels"]]


def apply(doc, dry_run):
    issues = gh_json("issue", "list", "-R", REPO, "--state", "open", "--limit", "200", "--json", "number")
    labels = gh_json("label", "list", "-R", REPO, "--limit", "200", "--json", "name")
    problems = validate(doc, {i["number"] for i in issues}, {l["name"] for l in labels})
    if problems:
        print(json.dumps({"refused": problems}, indent=1))
        return 2
    rows = []
    for item in doc["labels"]:
        before = label_names(item["number"])
        add = [n for n in dict.fromkeys(item["add"]) if n not in before]
        row = {"number": item["number"], "added": add, "alreadyHad": [n for n in item["add"] if n in before], "after": before}
        if add and not dry_run:
            args = ["issue", "edit", str(item["number"]), "-R", REPO]
            for name in add:
                args += ["--add-label", name]
            res = gh(*args)
            after = label_names(item["number"])
            row["after"] = after
            row["added"] = [n for n in add if n in after]
            if res.returncode or set(add) - set(after):
                row["error"] = (res.stderr.strip() or "labels missing after the read-back")[:300]
        rows.append(row)
    failed = [r for r in rows if "error" in r]
    status = "failed" if len(failed) == len(rows) else "partly" if failed else "applied"
    print(json.dumps({
        "approvalId": doc["id"],
        "status": "dry-run" if dry_run else status,
        "issues": rows,
        "appliedAt": datetime.now(timezone.utc).isoformat(),
    }, indent=1))
    return 1 if failed else 0


def self_test():
    ok = {"id": "a", "repo": REPO, "approvedAt": "x", "labels": [{"number": 8, "add": ["enhancement"]}]}
    opened, valid = {8, 16}, {"enhancement", "bug"}
    assert validate(ok, opened, valid) == []
    for bad in [
        {**ok, "repo": "bekhruzbekswe/gahi"},
        {**ok, "id": ""},
        {**ok, "close": [8]},
        {**ok, "labels": []},
        {**ok, "labels": [{"number": 999, "add": ["bug"]}]},
        {**ok, "labels": [{"number": True, "add": ["bug"]}]},
        {**ok, "labels": [{"number": "8", "add": ["bug"]}]},
        {**ok, "labels": [{"number": 8, "add": ["made-up"]}]},
        {**ok, "labels": [{"number": 8, "add": ["--repo=x/y"]}]},
        {**ok, "labels": [{"number": 8, "add": []}]},
        {**ok, "labels": [{"number": 8, "add": ["bug"], "comment": "hi"}]},
        {**ok, "labels": [{"number": 8, "add": ["bug"]}, {"number": 8, "add": ["bug"]}]},
        "not an object",
    ]:
        assert validate(bad, opened, valid), f"should refuse {bad!r}"
    print("self-test passed")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    else:
        with open(sys.argv[1]) as f:
            sys.exit(apply(json.load(f), "--dry-run" in sys.argv))
