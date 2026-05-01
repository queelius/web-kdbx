# Playwright e2e tests

## First-time setup

```bash
cd tests/e2e
npm install
npx playwright install firefox
```

## Run

From the project root:

```bash
./scripts/build.sh --release
cd tests/e2e && npm test
```

The webServer config starts `python3 -m http.server` against `www/`
automatically.
