#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012


def resolve_pointer(document, pointer: str):
    target = document
    for token in pointer.lstrip("/").split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        target = target[int(token)] if isinstance(target, list) else target[token]
    return target


def build_registry(schema_dir: Path) -> Registry:
    resources = []
    for path in schema_dir.rglob("*.json"):
        contents = json.loads(path.read_text(encoding="utf-8"))
        uri = contents.get("$id")
        if not uri:
            continue
        resources.append((uri, Resource.from_contents(contents, default_specification=DRAFT202012)))
    return Registry().with_resources(resources)


class Runner:
    def __init__(self, registry: Registry):
        self.registry = registry
        self.passed = 0
        self.failed = 0
        self.known = 0

    def errors(self, schema_ref: str, instance, prefix: list) -> list:
        validator = Draft202012Validator({"$ref": schema_ref}, registry=self.registry)
        found = []
        for e in validator.iter_errors(instance):
            parts = prefix + [str(p) for p in e.path]
            loc = "$." + ".".join(parts) if parts else "$"
            found.append((loc, e.validator, e.message))
        return sorted(found)

    def collect(self, label: str, entry: dict, document) -> list | None:
        pointer = entry.get("instance_pointer", "")
        try:
            target = resolve_pointer(document, pointer) if pointer else document
        except Exception as exc:
            print(f"  [XX] {label}  instance_pointer {pointer!r} not found: {exc}")
            return None
        prefix = [t for t in pointer.lstrip("/").split("/") if t] if pointer else []
        if not entry.get("each"):
            return self.errors(entry["ref"], target, prefix)
        if not isinstance(target, list) or not target:
            print(f"  [XX] {label}  instance_pointer {pointer!r} is not a non-empty array")
            return None
        found = []
        for index, item in enumerate(target):
            found += self.errors(entry["ref"], item, prefix + [str(index)])
        return found

    def check(self, label: str, entry: dict, document, known: dict | None) -> None:
        found = self.collect(label, entry, document)
        if found is None:
            self.failed += 1
            return
        actual = sorted({(loc, keyword) for loc, keyword, _ in found})
        expected = sorted(tuple(v) for v in (known or {}).get("violations", []))
        if actual == expected and not expected:
            print(f"  [ok] {label}")
            self.passed += 1
            return
        if actual == expected:
            print(f"  [kv] {label}  {len(expected)} known deviation(s): {known.get('reason', '')}")
            for loc, keyword in expected:
                print(f"      - {loc} ({keyword})")
            self.passed += 1
            self.known += len(expected)
            return
        self.failed += 1
        print(f"  [XX] {label}  ({len(found)} error(s))")
        for loc, keyword, message in found[:8]:
            print(f"      - {loc} ({keyword}): {message}")
        for loc, keyword in sorted(set(expected) - set(actual)):
            print(f"      - expected known deviation not raised: {loc} ({keyword})")


def entry_name(path: Path) -> str:
    stem = path.stem
    return stem.split("__", 1)[0] if "__" in stem else stem


def run_fixtures(runner: Runner, mapping: dict, fixtures: Path) -> None:
    files = sorted(fixtures.glob("*.json"))
    if not files:
        runner.failed += 1
        print(f"  [XX] no fixtures in {fixtures}")
        return
    for path in files:
        name = entry_name(path)
        entry = mapping.get(name) if name != "known_deviations" else None
        if entry is None:
            runner.failed += 1
            print(f"  [XX] {path.name}  no schema-map entry {name!r}")
            continue
        document = json.loads(path.read_text(encoding="utf-8"))
        runner.check(path.name, entry, document, mapping.get("known_deviations", {}).get(path.name))


def http_json(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def run_live(runner: Runner, mapping: dict, base_url: str, ucp_api: str) -> None:
    _, disc = http_json("GET", f"{base_url}/.well-known/ucp")
    runner.check("/.well-known/ucp", mapping["profile"], disc, None)
    _, created = http_json("POST", f"{ucp_api}/checkout-sessions", {"line_items": [{"item": {"id": "1"}, "quantity": 1}]})
    if created.get("id"):
        _, session = http_json("GET", f"{ucp_api}/checkout-sessions/{created['id']}")
        runner.check("checkout session", mapping["checkout"], session, None)
    else:
        runner.check("checkout create error", mapping["error"], created, None)


def main() -> int:
    parser = argparse.ArgumentParser(description="UCP schema conformance")
    parser.add_argument("--ucp-version", required=True)
    parser.add_argument("--schema-dir", required=True)
    parser.add_argument("--schema-map", required=True)
    parser.add_argument("--fixtures")
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", "http://localhost:8080"))
    parser.add_argument("--ucp-api", default=os.environ.get("UCP_API", ""), help="UCP REST base URL, required in live mode")
    args = parser.parse_args()

    maps = json.loads(Path(args.schema_map).read_text(encoding="utf-8"))
    if args.ucp_version not in maps:
        print(f"conformance: unknown version {args.ucp_version}")
        print("conformance: 1 failures")
        return 1
    mapping = maps[args.ucp_version]
    runner = Runner(build_registry(Path(args.schema_dir)))

    print(f"UCP schema conformance {args.ucp_version}")
    if args.fixtures:
        run_fixtures(runner, mapping, Path(args.fixtures))
    else:
        if not args.ucp_api:
            print("conformance: live mode needs --ucp-api or UCP_API")
            print("conformance: 1 failures")
            return 1
        run_live(runner, mapping, args.base_url.rstrip("/"), args.ucp_api.rstrip("/"))

    print(f"PASS={runner.passed} FAIL={runner.failed}")
    print(f"conformance: {runner.known} known deviations")
    print(f"conformance: {runner.failed} failures")
    return 0 if runner.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
