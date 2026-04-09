# Configuration

GrafanaProbe is configured through environment variables (backend) and the Settings UI (frontend). This page covers all available options.

---

## Backend environment variables

The backend reads configuration from `backend/.env`. Copy the template to get started:

```bash
cp backend/.env.example backend/.env
```

### Core settings

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `GRAFANA_URL` | `http://localhost:3000` | Yes | Full URL of your Grafana instance (no trailing slash) |
| `GRAFANA_API_TOKEN` | — | Yes | Service Account token with Admin role (`glsa_...`) |
| `GRAFANA_ORG_ID` | `1` | No | Grafana organization ID (most installations use `1`) |
| `PORT` | `4000` | No | Port for the backend API server |

### LLM / AI analysis settings

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `OPENAI_API_KEY` | — | No | OpenAI API key — enables AI failure analysis with GPT-4o |
| `ANTHROPIC_API_KEY` | — | No | Anthropic API key — enables AI failure analysis with Claude |
| `LLM_PROVIDER` | `openai` | No | Which LLM to use: `openai` or `anthropic` |
| `LLM_MODEL` | `gpt-4o` | No | Model name override (e.g., `gpt-4o-mini`, `claude-opus-4-6`) |

> **Note:** Only one LLM provider is active at a time. If both keys are present, `LLM_PROVIDER` determines which one is used. LLM features are entirely optional — GrafanaProbe runs fully without them.

### Full example `.env`

```env
# Grafana connection
GRAFANA_URL=http://grafana.internal:3000
GRAFANA_API_TOKEN=glsa_abc123xyz456_your_token_here
GRAFANA_ORG_ID=1

# Backend server
PORT=4000

# AI failure analysis (optional)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-key-here
LLM_MODEL=claude-sonnet-4-6
```

---

## Multi-environment setup (DEV / PERF / PROD)

GrafanaProbe supports multiple Grafana environments, configurable from the **Settings** page in the UI. Each environment has its own URL and token.

### Configuring environments in the UI

1. Open http://localhost:3001
2. Click **Settings** in the sidebar
3. Under **Environments**, you will see three environment slots: DEV, PERF, PROD
4. For each environment:
   - Enter the Grafana URL (e.g., `http://grafana-dev.internal:3000`)
   - Enter the Service Account token for that environment
   - Click **Test Connection** to verify
5. Click **Save**

Environment configurations are stored in browser localStorage and sent as part of the API request body when running tests. The backend `.env` acts as the default/fallback when no environment override is provided in the request.

### Running tests against a specific environment

On the **Run Tests** page, select the target environment from the environment dropdown before clicking **Run**. The selected environment's URL and token are passed in the request body:

```json
{
  "grafanaUrl": "http://grafana-prod.internal:3000",
  "token": "glsa_prod_token_here",
  "categories": ["api-health", "datasources"]
}
```

---

## Creating a Grafana Service Account token

### Step-by-step (Grafana UI)

1. Log in to Grafana as an administrator
2. Go to **Administration → Service Accounts** (sidebar or hamburger menu)
3. Click **Add service account**
   - **Name:** `grafana-probe`
   - **Role:** Admin
4. Click **Create**
5. On the service account detail page, click **Add service account token**
   - **Token name:** `probe-token`
   - **Expiration:** set a rotation schedule or leave as No expiration
6. Click **Generate token**
7. **Copy the token immediately** — it starts with `glsa_` and is shown only once
8. Paste it into `backend/.env` as `GRAFANA_API_TOKEN`

> **Warning:** Do not use a personal user account token. Service Account tokens are more secure: they have no UI login, support rotation, and can be scoped to a single organization.

### Creating a token via the Grafana API

```bash
# Create service account
curl -X POST http://grafana.internal:3000/api/serviceaccounts \
  -H "Content-Type: application/json" \
  -u admin:admin \
  -d '{"name":"grafana-probe","role":"Admin"}'

# Create token (replace <id> with the id from above response)
curl -X POST http://grafana.internal:3000/api/serviceaccounts/<id>/tokens \
  -H "Content-Type: application/json" \
  -u admin:admin \
  -d '{"name":"probe-token"}'
```

---

## LLM configuration

### OpenAI (GPT-4o)

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-openai-key
LLM_MODEL=gpt-4o        # or gpt-4o-mini for lower cost
```

### Anthropic Claude

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
LLM_MODEL=claude-sonnet-4-6   # or claude-opus-4-6 for deeper analysis
```

### Using LLM analysis

Once configured, the **AI Analysis** button appears in test result details after a run:

1. Run tests (any category)
2. Expand a category with FAIL or WARN results
3. Click **Analyze with AI**
4. GrafanaProbe sends the failure context to the LLM and displays:
   - A plain-language explanation of what failed
   - Likely root cause
   - Suggested remediation steps
   - Relevant Grafana documentation links

> **Tip:** AI analysis works best on FAIL results with meaningful error messages. For generic connectivity errors, fix the underlying network/auth issue first.

---

## Frontend configuration

The frontend is configured via environment variables set before `npm start`. These are baked in at build time.

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_API_URL` | `http://localhost:4000` | Backend API base URL |
| `PORT` | `3001` | Port for the React dev server |

**Example — pointing to a remote backend:**

```bash
REACT_APP_API_URL=http://backend.internal:4000 npm start
```

---

## What's next?

- [Test Categories](../features/test-categories.md) — understand what GrafanaProbe actually tests
- [Deployment: Docker](../deployment/docker.md) — run backend + frontend in containers
- [Deployment: CI/CD](../deployment/ci-cd.md) — integrate GrafanaProbe into your pipeline
