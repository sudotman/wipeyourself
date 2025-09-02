# seek — inspiration canvas

An infinitely growing canvas of images sourced from a public index. The frontend is a single‑page static app; the backend is a tiny Flask service that discovers image URLs and proxies them safely.

## What this app does

- Fetches an index page from `http://52.33.176.184/tmdbbd/` and extracts image URLs (jpg/png/webp/gif)
- Caches the discovered list in‑memory for 1 hour to reduce load on the source
- Returns a randomized selection for variety on each request
- Proxies images through the backend to avoid CORS/hotlink issues and to enable optional downloads

## Data access: is it “random” and is there a database?

- There is no database. The backend scrapes a public directory index and caches the list in memory.
- Endpoint `GET /api/images` loads the cached list and then uses `random.shuffle` server‑side to vary the selection on every call. The front‑end also places images at randomized world positions for the exploratory feel.
- Images are served via `GET /proxy?url=...` which enforces an allow‑list so only the configured source host/path is allowed.

## Project layout

- `main.py` — Flask app: scrape/cache, `/api/images`, `/proxy`, and static file root
- `static/` — Frontend (`index.html`, `styles.css`, `app.js`, optional `config.js`)
- `.github/workflows/pages.yml` — GitHub Pages deployment workflow

## Run locally (Windows PowerShell)

```powershell
# from the project root
python -m venv .venv
 .\.venv\Scripts\python -m pip install --upgrade pip
 .\.venv\Scripts\python -m pip install -r requirements.txt

# start server (supports host/port flags)
 .\.venv\Scripts\python .\main.py --host 127.0.0.1 --port 9000 --reload
```

Then open `http://127.0.0.1:9000`.

CLI also supports host/port flags as remembered previously: `python main.py --host 127.0.0.1 --port 9000`.

## API overview

- `GET /api/images?limit=60&refresh=0` — returns JSON: `{ images: string[], count: number, refreshed: boolean }`
  - `limit` is clamped to `[1, 200]`
  - `refresh=1` forces a re-scrape bypassing the 1‑hour cache
- `GET /proxy?url=...&download=0` — streams the image from the allowed source; `download=1` adds a Content‑Disposition header
- `GET /healthz` — simple health check

## Frontend details

- `static/app.js` calls the API at runtime. For static hosting (e.g., GitHub Pages) you can set a runtime base URL by defining `window.SEEK_API_BASE` in `static/config.js`:

```html
<script>
  // e.g., point this to your Flask API origin
  window.SEEK_API_BASE = 'https://seek-api.example.com';
  // leave empty to use same-origin in local dev
  // window.SEEK_API_BASE = '';
</script>
```

When `SEEK_API_BASE` is non-empty, the frontend will call `${SEEK_API_BASE}/api/images` and will convert relative `/proxy?...` URLs into absolute URLs against that base.

## Deploy the static site to GitHub Pages

This repo includes a GitHub Actions workflow that publishes the `static/` folder to GitHub Pages.

1) In GitHub, go to Settings → Pages and set the source to “GitHub Actions”.
2) Push to `main`. The workflow `.github/workflows/pages.yml` will:
   - Upload `static/` as the Pages artifact
   - Deploy to Pages environment

### Custom domain

- The `static/CNAME` file is committed with `seek.satyamkashyap.com`. In your DNS, create a CNAME record:
  - `seek` → `username.github.io` (replace with your GitHub Pages apex)
- In GitHub Settings → Pages, set the custom domain to `seek.satyamkashyap.com` and enable HTTPS.
- `static/.nojekyll` is present so Pages serves files as-is.

### Backend hosting for the API

GitHub Pages is static only. Run the Flask API elsewhere (Render/Fly/Heroku/VPS):

```bash
python main.py --host 0.0.0.0 --port 8080
```

Expose it via your chosen host and set `window.SEEK_API_BASE` on the Pages site to that API origin. The API includes permissive CORS headers so cross-origin requests from Pages work.

## Deploy the API to Google Cloud Run (free tier)

Cloud Run gives you a fully-managed container with an Always Free allocation that’s reliable for light usage.

Prereqs: Install the `gcloud` CLI and authenticate.

Option A: One-liner deploy from source (no manual Docker build needed):

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud run deploy seek-api --source . --region us-central1 --allow-unauthenticated --port 8080
```

Option B: Use provided scripts

```bash
# macOS/Linux
./scripts/deploy-cloudrun.sh YOUR_PROJECT_ID us-central1 seek-api

# Windows PowerShell
./scripts/deploy-cloudrun.ps1 -ProjectId YOUR_PROJECT_ID -Region us-central1 -ServiceName seek-api
```

After deploy, set your frontend to call the API:

```js
// static/config.js
window.SEEK_API_BASE = 'https://YOUR-SERVICE-xxxxxxxx-uc.a.run.app';
```

### Automatic deploys to Cloud Run with GitHub Actions

This repo contains `.github/workflows/cloudrun.yml` which deploys the API on every push to `main` using GCP Workload Identity Federation (no long‑lived keys).

One‑time setup in GCP (run locally or Cloud Shell):

```bash
PROJECT_ID=your-project
POOL_ID=github-pool
PROVIDER_ID=github-provider
SA_NAME=seek-api-deployer
SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

gcloud config set project $PROJECT_ID

# 1) Create a Workload Identity Pool and GitHub OIDC provider
gcloud iam workload-identity-pools create $POOL_ID --location=global --display-name="$POOL_ID"
gcloud iam workload-identity-pools providers create-oidc $PROVIDER_ID \
  --location=global \
  --workload-identity-pool=$POOL_ID \
  --display-name="$PROVIDER_ID" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 2) Create a deployer service account and grant minimal roles
gcloud iam service-accounts create $SA_NAME --display-name="Cloud Run Deployer"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountUser"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudbuild.builds.editor"

# 3) Allow GitHub repo to impersonate the SA via WIF
POOL_FULL_ID="projects/$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')/locations/global/workloadIdentityPools/$POOL_ID"
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/$POOL_FULL_ID/attribute.repository:YOUR_GITHUB_ORG/YOUR_REPO"

# 4) Enable services
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

In your GitHub repo settings:

- Secrets:
  - `GCP_WIF_PROVIDER`: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID`
  - `GCP_SERVICE_ACCOUNT_EMAIL`: `seek-api-deployer@PROJECT_ID.iam.gserviceaccount.com`
- Variables:
  - `GCP_PROJECT_ID`: your project ID
  - `GCP_REGION`: e.g. `us-central1`
  - `CLOUD_RUN_SERVICE`: e.g. `seek-api`

Push to `main`; the workflow will build and deploy from source and print the service URL.

## Operational notes

- Cache TTL is 1 hour; change `CACHE_TTL_SECONDS` in `main.py` if needed.
- Network timeouts to the source are 15s.
- The proxy path performs a strict allow‑list check ensuring only the configured source host/path is reachable.

## Development tips

- If you tweak the frontend only, you can open `static/index.html` directly in a browser, but API calls will fail unless you point `SEEK_API_BASE` to a running backend.
- To point the static site to your dev server, set in `static/config.js`:

```js
window.SEEK_API_BASE = 'http://127.0.0.1:9000';
```

## License

MIT
