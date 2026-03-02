# AI Glossary

Minimal, open-source AI terminology glossary (English + Italian) built for fast lookup: definition, key intuition, and sources.

This project is fully static (no backend required) and is designed to run for free on GitHub Pages.

## Local preview

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python build.py
python -m http.server 8000 --directory docs
```

Open `http://localhost:8000/`.

Optional: set `ISSUE_BASE_URL` before running `python build.py` to enable the "Report a problem" link (e.g. `https://github.com/<user>/<repo>/issues/new`).

## Deploy on GitHub Pages

1. Push the repository to GitHub.
2. Go to `Settings` -> `Pages`.
3. Select `Deploy from a branch`.
4. Choose branch `main` and folder `/docs`.

## Contributing

Add terms or improve definitions/translations by editing YAML files under `data/terms/` and running `python build.py`.

See `CONTRIBUTING.md`.

## Optional: term map (embeddings)

The UI includes a small knowledge map under the search bar.

To regenerate it locally (LM Studio):

1) Run LM Studio server on `http://127.0.0.1:1234` and make sure an embeddings model is available (e.g. `text-embedding-nomic-embed-text-v1.5`).
2) Run:

```bash
python scripts/build_term_map.py --base-url http://127.0.0.1:1234/v1 --model text-embedding-nomic-embed-text-v1.5
```

This writes `docs/term_map.json`.
