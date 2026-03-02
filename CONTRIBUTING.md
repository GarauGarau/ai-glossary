# Contributing

Thanks for helping improve the glossary.

## Add a new term

1) Pick a stable `term_id` (kebab-case). Example: `mixture-of-experts`.

2) Add TWO files (same `term_id`):

- `data/terms/en/<term_id>.yaml`
- `data/terms/it/<term_id>.yaml`

3) Use this schema (required fields):

```yaml
term: ""
aliases: []
category: ""
difficulty: beginner  # beginner | intermediate | advanced
tags:
  - ""
definition: |
  
key_intuition: |
  
use_cases: ""
links:
  - title: ""
    url: ""
    type: explainer  # explainer | technical | video | reference | official
related: []
```

Notes:
- `tags` must be a non-empty list.
- `links` must contain at least one item.
- Keep `definition` clear and compact; make `key_intuition` memorable.

4) Build the site:

```bash
pip install -r requirements.txt
python build.py
```

5) Commit your YAML + the updated generated files:

- `docs/manifest.json`
- `docs/glossary.en.json`
- `docs/glossary.it.json`

You do NOT need to regenerate the map (`docs/term_map.json`) for normal term edits.
Maintainers can refresh it periodically.

6) Open a Pull Request.

## Improve a term / translation

Edit the relevant YAML file(s) in `data/terms/`, run `python build.py`, and commit the updated `docs/*.json` artifacts.

## New languages

The current build is configured for English + Italian only (`build.py`). If you want to add a new language, open an issue/PR describing the approach.
