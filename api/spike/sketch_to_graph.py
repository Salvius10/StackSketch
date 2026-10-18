"""Phase 0 spike: can a vision model turn messy sketches into the right graph?

Put pairs of files in a folder:
    checkout.png    a photo or export of a hand-drawn sketch (.png/.jpg/.webp)
    checkout.json   the graph you expect, in StackSketch graph JSON

Then run, from the api/ directory:
    uv run python spike/sketch_to_graph.py path/to/sketches

Each sketch is scored on nodes (matched by label, then type) and edges
(matched by endpoints and direction, then kind). A sketch counts as correct
when node and edge F1 both reach the thresholds. The exit check in the build
spec is at least 8 of 10 correct; that threshold is a starting guess.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import re
import sys
from pathlib import Path

from stacksketch_api.llm import LLM
from stacksketch_api.main import load_settings
from stacksketch_api.models import Graph

MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def norm(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", label.lower())


def f1(tp: int, expected: int, got: int) -> float:
    if expected == 0 and got == 0:
        return 1.0
    p = tp / got if got else 0.0
    r = tp / expected if expected else 0.0
    return 2 * p * r / (p + r) if p + r else 0.0


def score(expected: Graph, got: Graph) -> dict:
    # Match nodes by normalised label; fall back to one label containing the other.
    exp_by_label = {norm(n.label): n for n in expected.nodes}
    mapping: dict[str, str] = {}
    for n in got.nodes:
        key = norm(n.label)
        match = exp_by_label.get(key) or next((e for k, e in exp_by_label.items() if k and key and (k in key or key in k)), None)
        if match and match.id not in mapping.values():
            mapping[n.id] = match.id
    node_tp = len(mapping)
    type_ok = sum(1 for gid, eid in mapping.items() if got.node(gid).type == expected.node(eid).type)

    exp_edges = {(e.from_, e.to): e for e in expected.edges}
    edge_tp = kind_ok = 0
    for e in got.edges:
        key = (mapping.get(e.from_), mapping.get(e.to))
        if key in exp_edges:
            edge_tp += 1
            kind_ok += exp_edges[key].kind == e.kind
    return {
        "node_f1": round(f1(node_tp, len(expected.nodes), len(got.nodes)), 3),
        "type_accuracy": round(type_ok / node_tp, 3) if node_tp else 0.0,
        "edge_f1": round(f1(edge_tp, len(expected.edges), len(got.edges)), 3),
        "kind_accuracy": round(kind_ok / edge_tp, 3) if edge_tp else 0.0,
    }


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", type=Path)
    ap.add_argument("--node-f1", type=float, default=0.9)
    ap.add_argument("--edge-f1", type=float, default=0.8)
    ap.add_argument("--out", type=Path, default=Path("spike/results"))
    args = ap.parse_args()

    load_settings()
    llm = LLM()
    if not llm.enabled:
        print("Put OPENROUTER_API_KEY or ANTHROPIC_API_KEY in .env (or run `ant auth login`) first.", file=sys.stderr)
        return 2
    print(f"Reading sketches with {llm.provider} / {llm.model}")
    sketches = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in MEDIA and p.with_suffix(".json").exists())
    if not sketches:
        print(f"No sketch + .json pairs found in {args.folder}", file=sys.stderr)
        return 2

    args.out.mkdir(parents=True, exist_ok=True)
    correct = 0
    for img in sketches:
        expected = Graph.model_validate(json.loads(img.with_suffix(".json").read_text(encoding="utf-8")))
        data = base64.standard_b64encode(img.read_bytes()).decode()
        got, notes = await llm.read_sketch(data, MEDIA[img.suffix.lower()])
        s = score(expected, got)
        ok = s["node_f1"] >= args.node_f1 and s["edge_f1"] >= args.edge_f1
        correct += ok
        (args.out / f"{img.stem}.graph.json").write_text(json.dumps(got.dump(), indent=2), encoding="utf-8")
        print(f"{'PASS' if ok else 'FAIL'}  {img.name:30} {s}")

    print(f"\n{correct}/{len(sketches)} sketches read correctly (node F1 >= {args.node_f1}, edge F1 >= {args.edge_f1}).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
