# Deployment Guide

## Overview

This app deploys to:

1. **Frontend**: Vercel or Netlify (static hosting)
2. **Backend**: Supabase (managed)
3. **CI/CD**: GitHub Actions

---

## Prerequisites

- GitHub repository
- Vercel or Netlify account
- Supabase production project
- Domain name (optional)

---

## Step 1: Prepare Supabase Production

### 1.1 Create Production Project

1. Go to [supabase.com](https://supabase.com/dashboard)
2. Create new project
3. Choose region closest to Philippines (Singapore)
4. Note project URL and keys

### 1.2 Run Migrations

```bash
# Link to production project
supabase link --project-ref your-prod-ref

# Push migrations
supabase db push
```

### 1.3 Deploy Edge Functions

```bash
supabase functions deploy process-order
supabase functions deploy refund-order
supabase functions deploy notify
```

### 1.4 Set Environment Variables (Supabase)

In Supabase Dashboard → Settings → Secrets:

```text
GCASH_API_KEY=xxx
PAYMONGO_SECRET_KEY=xxx
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
```

---

## Step 2: Deploy Frontend (Vercel)

### 2.1 Connect GitHub Repository

1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repo
3. Framework: Vite
4. Root directory: `./`

### 2.2 Configure Environment Variables

In Vercel dashboard → Settings → Environment Variables:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_VAPID_PUBLIC_KEY=your-vapid-key (optional)
```

### 2.3 Build Settings

Vercel auto-detects Vite:

- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

### 2.4 Deploy

Click "Deploy". Vercel builds and deploys automatically.

---

## Step 3: Deploy Frontend (Netlify Alternative)

### 3.1 Connect Repository

1. Go to [netlify.com](https://netlify.com)
2. Add new site → Import from Git
3. Select repository

### 3.2 Build Settings

```text
Build command: npm run build
Publish directory: dist
```

### 3.3 Environment Variables

In Netlify → Site settings → Environment variables:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3.4 Deploy

Netlify builds on every Git push to `main`.

---

## Step 4: Configure Custom Domain (Optional)

### Vercel

1. Go to project Settings → Domains
2. Add your domain (e.g., `canteen.school.edu.ph`)
3. Update DNS records as instructed

### Netlify

1. Domain settings → Add custom domain
2. Configure DNS or use Netlify DNS

---

## Step 5: Enable HTTPS

Both Vercel and Netlify provide free SSL certificates automatically.

---

## Step 6: Configure PWA for Production

### 6.1 Update Manifest

Edit `src/pwa/manifest.webmanifest`:

```json
{
  "start_url": "https://canteen.school.edu.ph/",
  "scope": "/"
}
```

### 6.2 Update Service Worker

Ensure `vite.config.ts` has correct base URL:

```typescript
export default defineConfig({
  base: '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true
      }
    })
  ]
});
```

---

## Step 7: Test Production Deployment

1. Open production URL
2. Test login as parent
3. Place a test order
4. Verify Edge Function execution in Supabase logs
5. Test offline mode (disable network in DevTools)

---

## Step 8: Set Up Monitoring

### Supabase Logging

- Monitor Edge Function logs in Supabase Dashboard
- Set up alerts for error rates

### Vercel/Netlify Analytics

- Enable Web Analytics in dashboard
- Monitor build times and deployment status

### Error Tracking (Optional)

Integrate Sentry:

```bash
npm install @sentry/react
```

Add to `main.tsx`:

```typescript
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: 'your-sentry-dsn',
  environment: 'production'
});
```

---

## CI/CD Pipeline

GitHub Actions auto-deploys on push to `main`. See `.github/workflows/deploy.yml`.

### Manual Deploy

```bash
# Vercel
vercel --prod

# Netlify
netlify deploy --prod
```

---

## Rollback Strategy

### Frontend (Vercel)

1. Go to Deployments
2. Click "..." on previous deployment
3. Select "Promote to Production"

### Backend (Supabase)

```bash
# Revert migration
supabase migration repair --status reverted <timestamp>

# Rollback Edge Function
supabase functions deploy process-order --version <previous-version>
```

---

## Performance Optimization

### 1. Enable Gzip/Brotli (Auto-enabled on Vercel/Netlify)

### 2. Image Optimization

Use Supabase Storage with transforms:

```text
https://your-project.supabase.co/storage/v1/object/public/products/image.jpg?width=300
```

### 3. CDN Caching

Set cache headers in `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

---

## Security Checklist

- [ ] HTTPS enabled
- [ ] Environment variables secured (not in Git)
- [ ] Supabase RLS policies enabled
- [ ] API keys rotated from defaults
- [ ] CORS configured (Supabase dashboard)
- [ ] Rate limiting enabled (Supabase Edge Functions)
- [ ] Content Security Policy headers (optional)

---

## Post-Deployment

1. Announce to parents via email/SMS
2. Provide user guide
3. Monitor first week for issues
4. Collect feedback via in-app form

---

## Maintenance

- **Weekly**: Check error logs
- **Monthly**: Review analytics and performance
- **Quarterly**: Update dependencies (`npm outdated`)
- **Yearly**: Review and rotate API keys
