# Troubleshooting

This page covers the most common errors encountered when setting up and running GrafanaProbe, along with step-by-step resolutions.

---

## Quick reference

| Problem | Jump to |
|---------|---------|
| Frontend shows blank page | [Frontend issues](#frontend-issues) |
| Backend won't start | [Backend startup issues](#backend-startup-issues) |
| Can't connect to Grafana | [Grafana connection issues](#grafana-connection-issues) |
| Auth errors (401/403) | [Authentication issues](#authentication-issues) |
| Docker/Podman errors | [Docker and container issues](#docker-and-container-issues) |
| Windows-specific issues | [Windows setup issues](#windows-setup-issues) |
| Port conflicts | [Port conflicts](#port-conflicts) |
| SQLite / build errors | [Native module issues](#native-module-issues) |

---

## Frontend issues

### Frontend shows a blank page

**Symptoms:** Browser shows blank page or white screen at http://localhost:3001

**Solution:**
1. Make sure the backend is running first: `cd backend && npm run dev`
2. Check the browser console (F12 → Console) for error messages
3. Hard reload the page: Ctrl+Shift+R (or Cmd+Shift+R on Mac)
4. Verify the backend is reachable: `curl http://localhost:4000/api/health`

If the backend is running but the frontend still shows blank:

```bash
# Kill and restart the frontend
kill $(lsof -ti :3001)
cd frontend && npm start
```

### Frontend shows "Cannot connect to backend"

**Cause:** Frontend cannot reach the backend API.

**Solution:**
1. Verify the backend is running: `curl http://localhost:4000/api/health`
2. Check that `REACT_APP_API_URL` is not set to an incorrect value
3. If the backend is on a different host, set: `REACT_APP_API_URL=http://backend-host:4000 npm start`

### Frontend opens on wrong port

The React dev server opens at **http://localhost:3001**. If it opens on a different port, another process was using 3001. Check the terminal output — the actual port is shown:

```
You can now view the app in the browser.
  Local: http://localhost:3002
```

Kill the conflicting process and restart: see [Port conflicts](#port-conflicts).

---

## Backend startup issues

### `npm install` fails with build errors

**Cause:** `better-sqlite3` requires native C++ build tools.

**macOS:**
```bash
xcode-select --install
cd backend && npm install
```

**Linux:**
```bash
sudo apt install build-essential python3
cd backend && npm install
```

**Windows:**
```powershell
# In an elevated PowerShell window
npm install -g windows-build-tools
cd backend
npm install
```

### Backend starts but shows "No token"

**Cause:** `GRAFANA_API_TOKEN` is not set or is empty in `backend/.env`.

**Solution:**
```bash
# Check the .env file exists
cat backend/.env | grep GRAFANA_API_TOKEN

# If missing, copy from example
cp backend/.env.example backend/.env
# Then edit and add your token
```

### Backend crashes on start with `MODULE_NOT_FOUND`

**Cause:** Dependencies not installed.

```bash
cd backend
rm -rf node_modules package-lock.json
npm install
```

---

## Grafana connection issues

### "Connection refused" or "ECONNREFUSED"

**Cause:** The Grafana instance is not reachable from the machine running GrafanaProbe.

**Checklist:**
1. Is Grafana running? Check `http://your-grafana-url/api/health` in a browser
2. Is the URL in `.env` correct? Include protocol and port: `http://grafana.internal:3000`
3. Is there a firewall blocking port 3000?
4. Is GrafanaProbe running in a container? Use the container's internal hostname, not `localhost`

**Test connectivity directly:**
```bash
curl -v http://your-grafana-url:3000/api/health
```

### "Test Connection" fails in the Settings UI

**Cause:** The Settings page uses the backend as a CORS proxy to test connections. If the backend itself is not running, the test connection will fail.

**Solution:**
1. Ensure the backend is running: `curl http://localhost:4000/api/health`
2. Then retry Test Connection from the Settings page

### "SSL certificate verification failed"

**Cause:** Grafana is served over HTTPS with a self-signed certificate.

**Solution:** Set the `NODE_TLS_REJECT_UNAUTHORIZED=0` environment variable for the backend (development only):

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev
```

> **Warning:** Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` in production — it disables all TLS certificate verification.

---

## Authentication issues

### "401 Unauthorized" errors

**Cause:** The Service Account token is invalid, expired, or not set.

**Solution:**
1. Verify the token starts with `glsa_`
2. Check the token has not expired in Grafana: **Administration → Service Accounts → your account → Tokens**
3. Test the token directly:
   ```bash
   curl -H "Authorization: Bearer glsa_your_token" http://grafana.internal:3000/api/user
   ```
4. Generate a new token if needed and update `backend/.env`

### "403 Forbidden" — datasource tests fail

**Cause:** The Service Account does not have Admin role.

**Solution:**
1. Go to **Grafana → Administration → Service Accounts**
2. Find your service account (e.g., `grafana-probe`)
3. Verify the role is **Admin** (not Viewer or Editor)
4. If not, click **Edit** and change the role to Admin

### "403 Forbidden" — only specific categories fail

**Cause:** The token is valid but the organization ID is incorrect.

**Solution:**
Check `GRAFANA_ORG_ID` in `backend/.env`. Most single-org Grafana installations use `1`. For multi-org setups, ensure the token belongs to the correct organization.

---

## Port conflicts

### `EADDRINUSE: port 4000`

Another process is using port 4000.

**macOS / Linux:**
```bash
# Find and kill the process
kill $(lsof -ti :4000)
# Or more aggressively
lsof -ti :4000 | xargs kill -9
```

**Windows:**
```powershell
# Kill all Node processes
taskkill /f /im node.exe

# Or find the specific PID
netstat -ano | findstr :4000
taskkill /PID <pid> /F
```

### `EADDRINUSE: port 3001`

```bash
# macOS / Linux
kill $(lsof -ti :3001)

# Windows
taskkill /f /im node.exe
```

### Change the ports

To use a different port:

**Backend:** Set `PORT=4001` in `backend/.env`

**Frontend:** Set the `PORT` env var before starting:
```bash
PORT=3002 npm start
```

---

## Docker and container issues

### Docker demo Grafana takes too long to start

The `demo-run.sh` script waits up to 60 seconds for Grafana to become healthy. If it times out:

```bash
# Check Grafana container logs
docker logs grafana-k6-test

# Manually check health
curl http://localhost:3000/api/health
```

Common causes:
- Docker is low on memory — give Docker more RAM in Docker Desktop settings
- Port 3000 is already in use by another service

### `better-sqlite3` fails in Docker container

**Cause:** The base Node.js Alpine image is missing build tools.

**Solution:** Use a Debian-based Node image or install build tools in the Dockerfile:

```dockerfile
FROM node:18-alpine
RUN apk add --no-cache python3 make g++
```

### Grafana container exits immediately

Check container logs:
```bash
docker logs grafana-k6-test --tail=50
```

Common cause: volume permissions issue on Linux:
```bash
sudo chown -R 472:472 ./grafana-data
```

### Podman: "permission denied" on macOS

```bash
# Start Podman machine if not running
podman machine start

# Check machine status
podman machine info
```

---

## Windows setup issues

### `'PORT' is not recognized as an internal command`

**Cause:** The frontend's `npm start` script uses `PORT=3001` which is a Unix-style env var.

**Solution:** GrafanaProbe uses `cross-env` to handle this automatically. Reinstall frontend dependencies:

```powershell
cd frontend
npm install   # installs cross-env
npm start
```

### `better-sqlite3` build fails on Windows

```powershell
# Option 1: Install windows-build-tools (needs admin, one-time)
npm install -g windows-build-tools

# Option 2: Install Visual Studio Build Tools manually
# Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
# Select: "Desktop development with C++"
```

### `git pull` fails with SQLite lock

**Symptom:** `Unlink of file 'backend/data/grafana-probe.db-shm' failed`

**Solution:**
```powershell
# 1. Stop backend
taskkill /f /im node.exe

# 2. Discard lock files (not your data)
git checkout -- backend/data/

# 3. Pull
git pull

# 4. Restart
cd backend && npm run dev
```

If db files still block:
```powershell
git stash
git pull
git stash pop  # re-apply your .env changes if any
```

### npm start opens the wrong browser or URL

On Windows, `npm start` should open http://localhost:3001. If it doesn't:
1. Open http://localhost:3001 manually
2. Check that you're in the `frontend/` directory when running `npm start`
3. Verify port 3001 is not blocked by Windows Firewall

---

## SQLite issues

### `Error: SQLITE_CANTOPEN: unable to open database file`

**Cause:** The `backend/data/` directory does not exist.

**Solution:**
```bash
mkdir -p backend/data
```

GrafanaProbe creates this directory automatically on startup, but if there's a permissions issue:

```bash
# Linux/Mac
chmod 755 backend/data

# Windows
# Right-click backend/data → Properties → Security → add write permission
```

### `Error: SQLITE_BUSY: database is locked`

**Cause:** Two backend processes are running simultaneously.

**Solution:**
```bash
# macOS/Linux
pkill -f "node src/server.js"

# Windows
taskkill /f /im node.exe
```

---

## Test category specific issues

### All datasource tests fail

**Check:** Token has Admin role (not Editor or Viewer).

```bash
curl -H "Authorization: Bearer glsa_your_token" http://grafana.internal:3000/api/datasources
# Should return a list of data sources
```

### K8s tests show 0 dashboards

GrafanaProbe discovers Kubernetes dashboards by the `kubernetes` tag.

**Solution:** Add the `kubernetes` tag to your Kubernetes-related dashboards in Grafana:
- Open the dashboard → Settings → Tags → add `kubernetes` → Save

### Reports page is empty

**Cause:** No tests have been run yet, or reports were deleted.

**Solution:** Run at least one test from the **Run Tests** page. Reports are stored in `backend/data/grafana-probe.db` and `backend/reports/`.

---

## Frequently asked questions

**Q: Does GrafanaProbe modify any Grafana configuration?**

No. GrafanaProbe is entirely read-only. It only calls `GET` endpoints on the Grafana API. The only `POST` calls made are to Grafana's own data source health check endpoints (which are read-only queries).

**Q: Is it safe to run against production Grafana?**

Yes, with caveats:
- The Query Latency category runs live queries against your data sources, which consumes data source resources
- For very large instances (1000+ dashboards), full test runs may take several minutes and generate significant API traffic
- Consider running during low-traffic periods or using selective categories (skip `query-latency` for production if concerned about load)

**Q: How long does a full test run take?**

Approximately 30–120 seconds depending on Grafana instance size:
- Small instance (< 50 dashboards): ~30 seconds
- Medium instance (50–500 dashboards): ~60 seconds
- Large instance (500+ dashboards): 2–5 minutes

**Q: Can I run GrafanaProbe against Grafana Cloud?**

Yes. Use your Grafana Cloud instance URL and a Service Account token with Admin role. The same configuration applies.

**Q: Where are reports stored?**

Reports are stored in two places:
- `backend/data/grafana-probe.db` — SQLite index (fast lookup)
- `backend/reports/*.json` and `backend/reports/*.html` — actual report files

**Q: Can I run multiple environments simultaneously?**

No. GrafanaProbe runs one test suite at a time. Multiple simultaneous runs against different environments would share the same report storage and could produce mixed results. Use separate GrafanaProbe instances for parallel environment testing.

---

## What's next?

- [Installation](../getting-started/installation.md) — start fresh if issues persist
- [Configuration](../getting-started/configuration.md) — verify all settings
- [API Reference](../api/reference.md) — test endpoints directly
