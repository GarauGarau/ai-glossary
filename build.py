from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data" / "terms"
OUT_DIR = ROOT / "docs"
ACTIVE_LANGS = ["en", "it"]
REQUIRED_FIELDS = {
    "term": str,
    "category": str,
    "difficulty": str,
    "definition": str,
    "key_intuition": str,
    "use_cases": str,
    "tags": list,
    "links": list,
}
VALID_DIFFICULTY = {"beginner", "intermediate", "advanced"}
VALID_LINK_TYPES = {"explainer", "technical", "video", "reference", "official"}


def read_yaml(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except yaml.YAMLError as exc:
        raise ValueError(f"Invalid YAML in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"Expected object in {path}")
    return data


def validate_term(path: Path, payload: dict[str, Any]) -> None:
    for field, expected_type in REQUIRED_FIELDS.items():
        if field not in payload:
            raise ValueError(f"Missing required field '{field}' in {path}")
        if not isinstance(payload[field], expected_type):
            raise ValueError(f"Field '{field}' must be {expected_type.__name__} in {path}")

    aliases = payload.get("aliases", [])
    related = payload.get("related", [])
    if aliases is not None and not isinstance(aliases, list):
        raise ValueError(f"Field 'aliases' must be list in {path}")
    if related is not None and not isinstance(related, list):
        raise ValueError(f"Field 'related' must be list in {path}")

    if payload["difficulty"] not in VALID_DIFFICULTY:
        raise ValueError(f"Invalid difficulty '{payload['difficulty']}' in {path}")

    tags = payload.get("tags")
    if not tags:
        raise ValueError(f"Field 'tags' cannot be empty in {path}")
    for idx, tag in enumerate(tags):
        if not isinstance(tag, str) or not tag.strip():
            raise ValueError(f"tags[{idx}] must be non-empty string in {path}")

    links = payload["links"]
    if not links:
        raise ValueError(f"Field 'links' cannot be empty in {path}")
    for idx, item in enumerate(links):
        if not isinstance(item, dict):
            raise ValueError(f"links[{idx}] must be object in {path}")
        for key in ("title", "url", "type"):
            if key not in item or not isinstance(item[key], str) or not item[key].strip():
                raise ValueError(f"links[{idx}].{key} missing/invalid in {path}")
        if item["type"] not in VALID_LINK_TYPES:
            raise ValueError(f"links[{idx}].type invalid in {path}: {item['type']}")


def load_language(lang: str) -> dict[str, dict[str, Any]]:
    lang_dir = DATA_DIR / lang
    if not lang_dir.exists():
        raise ValueError(f"Missing language directory: {lang_dir}")

    items: dict[str, dict[str, Any]] = {}
    for path in sorted(lang_dir.glob("*.yaml")):
        term_id = path.stem
        payload = read_yaml(path)
        validate_term(path, payload)
        payload.setdefault("aliases", [])
        payload.setdefault("related", [])
        payload["id"] = term_id
        items[term_id] = payload
    return items


def validate_cross_language(data: dict[str, dict[str, dict[str, Any]]]) -> None:
    base_ids = set(data[ACTIVE_LANGS[0]].keys())
    for lang in ACTIVE_LANGS[1:]:
        ids = set(data[lang].keys())
        missing = sorted(base_ids - ids)
        extras = sorted(ids - base_ids)
        if missing:
            raise ValueError(f"Language '{lang}' missing term IDs: {', '.join(missing)}")
        if extras:
            raise ValueError(f"Language '{lang}' has extra term IDs: {', '.join(extras)}")


def write_artifacts(data: dict[str, dict[str, dict[str, Any]]]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Disable Jekyll processing on GitHub Pages.
    (OUT_DIR / ".nojekyll").write_text("\n", encoding="utf-8")

    manifest = {
        "version": "1.0.0-beta",
        "active_languages": ACTIVE_LANGS,
        "counts": {lang: len(data[lang]) for lang in ACTIVE_LANGS},
        "files": {lang: f"glossary.{lang}.json" for lang in ACTIVE_LANGS},
        "issue_base_url": os.getenv("ISSUE_BASE_URL", ""),
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    for lang in ACTIVE_LANGS:
        payload = {
            "lang": lang,
            "terms": list(data[lang].values()),
        }
        (OUT_DIR / f"glossary.{lang}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


def main() -> None:
    all_data = {lang: load_language(lang) for lang in ACTIVE_LANGS}
    validate_cross_language(all_data)
    write_artifacts(all_data)
    print(f"Build complete: {len(all_data['en'])} terms x {len(ACTIVE_LANGS)} languages")


if __name__ == "__main__":
    main()
