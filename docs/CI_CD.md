# CI/CD Pipeline

## Overview

Automated testing, building, and deployment using GitHub Actions.

---

## Pipeline Architecture

```text
GitHub Push
    ↓
┌───────────────────┐
│  Lint & Format    │
└────────┬──────────┘
         ↓
┌───────────────────┐
│   Run Tests       │
│  (Unit + E2E)     │
└────────┬──────────┘
         ↓
┌───────────────────┐
│   Build App       │
└────────┬──────────┘
         ↓
┌───────────────────┐
│  Deploy (Vercel)  │
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Supabase Migrate  │
└───────────────────┘
```

---

## GitHub Actions Workflows

### Main Deployment Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '18'

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run ESLint
        run: npm run lint
      
      - name: Run Prettier
        run: npm run format:check

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm test -- --coverage --watchAll=false
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  e2e:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/

  build:
    runs-on: ubuntu-latest
    needs: [test, e2e]
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
      
      - name: Upload build artifacts
        uses: actions/upload-artifact@v3
        with:
          name: dist
          path: dist/

  deploy-frontend:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      
      - name: Download build artifacts
        uses: actions/download-artifact@v3
        with:
          name: dist
          path: dist/
      
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'

  deploy-supabase:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest
      
      - name: Link Supabase project
        run: supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      
      - name: Run migrations
        run: supabase db push
      
      - name: Deploy Edge Functions
        run: |
          supabase functions deploy process-order
          supabase functions deploy refund-order
          supabase functions deploy notify
```

---

## Required GitHub Secrets

Configure these in GitHub repository settings → Secrets and variables → Actions:

| Secret | Description |
| ------ | ----------- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VERCEL_TOKEN` | Vercel deployment token |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI token |
| `SUPABASE_PROJECT_REF` | Supabase project reference |

---

## Branch Protection Rules

Configure in GitHub repository settings → Branches:

- **Require pull request reviews**: 1 approval
- **Require status checks**: lint, test, e2e must pass
- **Require branches to be up to date**: Yes
- **Do not allow bypassing**: Enforce for administrators

---

## Pull Request Checks

Every PR triggers:

1. **Linting**: ESLint + Prettier
2. **Type Checking**: TypeScript compilation
3. **Unit Tests**: Jest with coverage report
4. **E2E Tests**: Playwright critical paths
5. **Build Test**: Verify production build succeeds

---

## Deployment Strategies

### Preview Deployments (PRs)

Every PR gets a preview URL:

```yaml
deploy-preview:
  if: github.event_name == 'pull_request'
  steps:
    - name: Deploy to Vercel (Preview)
      uses: amondnet/vercel-action@v25
      with:
        vercel-args: ''  # No --prod flag
```

### Production Deployment

Only `main` branch deploys to production:

```yaml
if: github.ref == 'refs/heads/main'
```

---

## Rollback Procedure

### Frontend Rollback (Vercel)

```bash
# List deployments
vercel ls

# Promote previous deployment
vercel promote <deployment-url> --yes
```

### Backend Rollback (Supabase)

```bash
# Revert migration
supabase migration repair --status reverted <timestamp>

# Redeploy previous Edge Function version
git checkout <previous-commit>
supabase functions deploy process-order
```

---

## Monitoring & Alerts

### Build Status Badge

Add to README.md:

```markdown
![Build Status](https://github.com/your-org/canteen-pwa/workflows/Deploy/badge.svg)
```

### Slack Notifications

```yaml
- name: Notify Slack on failure
  if: failure()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: 'Deployment failed!'
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

---

## Performance Budgets

Enforce in CI:

```json
// package.json
{
  "scripts": {
    "build": "vite build && npm run check-size"
  },
  "check-size": "bundlesize"
}

// .bundlesizerc.json
[
  {
    "path": "./dist/assets/*.js",
    "maxSize": "200 kB"
  }
]
```

---

## Scheduled Jobs

### Daily Database Backup

```yaml
name: Backup

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Backup Supabase
        run: |
          supabase db dump -f backup-$(date +%Y%m%d).sql
          # Upload to S3 or other storage
```

---

## Best Practices

1. **Fast Feedback**: Fail fast on lint errors
2. **Parallel Jobs**: Run tests concurrently
3. **Caching**: Cache `node_modules` for speed
4. **Artifacts**: Save build artifacts for debugging
5. **Secrets**: Never log secrets, use GitHub Secrets
6. **Notifications**: Alert team on failures

---

## Troubleshooting

### Build Fails Locally But Passes in CI

- Check Node version matches CI
- Clear `node_modules` and reinstall
- Verify environment variables

### E2E Tests Flaky

- Increase timeouts
- Add explicit waits
- Use Playwright's auto-wait features

### Deployment Hangs

- Check Vercel/Supabase status pages
- Verify tokens haven't expired
- Review logs in GitHub Actions

---

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Vercel GitHub Integration](https://vercel.com/docs/concepts/git/vercel-for-github)
- [Supabase CI/CD Guide](https://supabase.com/docs/guides/cli/cicd)
