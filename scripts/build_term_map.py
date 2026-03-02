from __future__ import annotations

import argparse
import json
import math
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[1]
TERMS_DIR = ROOT / "data" / "terms" / "en"


@dataclass(frozen=True)
class TermDoc:
    term_id: str
    term: str
    text: str


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_term_docs() -> list[TermDoc]:
    items: list[TermDoc] = []
    for path in sorted(TERMS_DIR.glob("*.yaml")):
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"Invalid YAML object in {path}")
        term = str(payload.get("term") or "").strip()
        definition = str(payload.get("definition") or "").strip()
        key_intuition = str(payload.get("key_intuition") or "").strip()
        use_cases = str(payload.get("use_cases") or "").strip()
        if not term or not definition or not key_intuition:
            raise ValueError(f"Missing term/definition/key_intuition in {path}")

        parts = [
            f"Term: {term}",
            "",
            "Definition:",
            definition,
            "",
            "Key intuition:",
            key_intuition,
        ]
        if use_cases:
            parts += ["", "Use cases:", use_cases]

        items.append(TermDoc(term_id=path.stem, term=term, text="\n".join(parts).strip()))
    if not items:
        raise ValueError(f"No terms found in {TERMS_DIR}")
    return items


def _post_json(url: str, payload: dict[str, Any], timeout_s: int) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as r:
        return json.loads(r.read().decode("utf-8"))


def embed_texts(
    texts: list[str],
    *,
    base_url: str,
    model: str,
    batch_size: int,
    timeout_s: int,
) -> list[list[float]]:
    embeddings: list[list[float]] = []
    endpoint = base_url.rstrip("/") + "/embeddings"

    for start in range(0, len(texts), batch_size):
        chunk = texts[start : start + batch_size]
        payload = {"model": model, "input": chunk}
        resp = _post_json(endpoint, payload, timeout_s)
        if not isinstance(resp, dict) or "data" not in resp:
            raise ValueError("Unexpected embeddings response")

        data = resp.get("data")
        if not isinstance(data, list) or len(data) != len(chunk):
            raise ValueError("Embeddings response length mismatch")

        # ensure stable ordering
        data_sorted = sorted(data, key=lambda item: int(item.get("index", 0)))
        for item in data_sorted:
            emb = item.get("embedding")
            if not isinstance(emb, list) or not emb:
                raise ValueError("Invalid embedding vector")
            embeddings.append([float(x) for x in emb])

        # gentle pacing (some servers spike on rapid calls)
        time.sleep(0.05)

    if len(embeddings) != len(texts):
        raise ValueError("Embedding count mismatch")
    return embeddings


def angular_distance_matrix(vectors: list[list[float]]) -> list[list[float]]:
    n = len(vectors)
    norms = [math.sqrt(sum(v * v for v in vec)) or 1.0 for vec in vectors]
    dist = [[0.0 for _ in range(n)] for _ in range(n)]
    for i in range(n):
        vi = vectors[i]
        ni = norms[i]
        for j in range(i + 1, n):
            vj = vectors[j]
            nj = norms[j]
            dot = 0.0
            for k in range(len(vi)):
                dot += vi[k] * vj[k]
            cos = dot / (ni * nj)
            cos = max(-1.0, min(1.0, cos))
            d = math.acos(cos) / math.pi
            dist[i][j] = d
            dist[j][i] = d
    return dist


def mds_2d(
    distances: list[list[float]],
    *,
    seed: int,
    iters: int,
    lr: float,
    weight_power: float,
) -> list[tuple[float, float]]:
    # Simple gradient-descent MDS (stress minimization) for small N.
    n = len(distances)

    rng = _lcg(seed)
    xs = [(rng() * 2.0 - 1.0) for _ in range(n)]
    ys = [(rng() * 2.0 - 1.0) for _ in range(n)]

    eps = 1e-9
    for t in range(iters):
        gx = [0.0 for _ in range(n)]
        gy = [0.0 for _ in range(n)]

        # learning rate decay keeps it stable.
        step = lr * (0.985 ** (t / 50))

        for i in range(n):
            for j in range(i + 1, n):
                dij = distances[i][j]
                dx = xs[i] - xs[j]
                dy = ys[i] - ys[j]
                dist_ij = math.hypot(dx, dy) + eps
                diff = dist_ij - dij

                w = 1.0 / (max(0.03, dij) ** weight_power)
                fac = (2.0 * w * diff) / dist_ij

                gx[i] += fac * dx
                gy[i] += fac * dy
                gx[j] -= fac * dx
                gy[j] -= fac * dy

        for i in range(n):
            xs[i] -= step * gx[i]
            ys[i] -= step * gy[i]

        # recenter
        mx = sum(xs) / n
        my = sum(ys) / n
        for i in range(n):
            xs[i] -= mx
            ys[i] -= my

        # keep scale roughly stable
        s = math.sqrt(sum(x * x + y * y for x, y in zip(xs, ys)) / n) or 1.0
        target = 1.0
        scale = target / s
        for i in range(n):
            xs[i] *= scale
            ys[i] *= scale

    return list(zip(xs, ys))


def _lcg(seed: int):
    # Deterministic PRNG (linear congruential generator) to avoid importing random.
    state = seed & 0xFFFFFFFF

    def next_float() -> float:
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return state / 2**32

    return next_float


def normalize_to_unit(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    rx = (max_x - min_x) or 1.0
    ry = (max_y - min_y) or 1.0
    out: list[tuple[float, float]] = []
    for x, y in points:
        out.append(((x - min_x) / rx, (y - min_y) / ry))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a semantic term map (2D) into docs/term_map.json")
    parser.add_argument("--base-url", default="http://127.0.0.1:1234/v1", help="LM Studio base URL")
    parser.add_argument("--model", default="text-embedding-nomic-embed-text-v1.5", help="Embeddings model id")
    parser.add_argument("--out", default=str(ROOT / "docs" / "term_map.json"), help="Output JSON path")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--iters", type=int, default=2200)
    parser.add_argument("--lr", type=float, default=0.016)
    parser.add_argument("--weight-power", type=float, default=0.6)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    docs = load_term_docs()
    vectors = embed_texts(
        [d.text for d in docs],
        base_url=args.base_url,
        model=args.model,
        batch_size=max(1, args.batch_size),
        timeout_s=max(5, args.timeout),
    )

    dist = angular_distance_matrix(vectors)
    pts = mds_2d(
        dist,
        seed=args.seed,
        iters=max(200, args.iters),
        lr=args.lr,
        weight_power=max(0.2, args.weight_power),
    )
    unit = normalize_to_unit(pts)

    neighbors: dict[str, list[str]] = {}
    n = len(docs)
    for i, doc in enumerate(docs):
        ranks = sorted(range(n), key=lambda j: dist[i][j])
        neighbors[doc.term_id] = [docs[j].term_id for j in ranks[1:4]]

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "source_lang": "en",
        "created_at": _utc_now_iso(),
        "embedding": {
            "provider": "lm-studio",
            "base_url": args.base_url,
            "model": args.model,
        },
        "neighbors": neighbors,
        "items": {
            doc.term_id: {"x": float(x), "y": float(y)}
            for doc, (x, y) in zip(docs, unit)
        },
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} ({len(docs)} terms)")


if __name__ == "__main__":
    main()
