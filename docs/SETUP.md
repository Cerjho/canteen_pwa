# Development Setup Guide

## Prerequisites

- Node.js 18+ and npm
- Supabase CLI (`npm install -g supabase`)
- Git
- Code editor (VS Code recommended)

---

## Step 1: Clone Repository

```bash
git clone https://github.com/your-org/canteen-pwa.git
cd canteen-pwa
npm install
```

---

## Step 2: Supabase Setup

### Option A: Use Existing Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a project
2. Copy project URL and anon key from Settings → API
3. Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
### Option B: Local Development with Supabase CLI
```bash
# Initialize Supabase
supabase init

# Start local Supabase (Docker required)
supabase start

# Get local credentials
supabase status
```

Use local credentials in `.env`:

```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=your-local-anon-key
```

---

## Step 3: Run Database Migrations

```bash
# Remote project
supabase link --project-ref your-project-ref
supabase db push

# Local development
# Migrations auto-applied on supabase start
```

---

## Step 4: Seed Database (Optional)

```bash
# Run seed script
supabase db seed
```

Or manually insert test data via Supabase Dashboard → SQL Editor.

---

## Step 5: Deploy Edge Functions (Optional for Local)

```bash
# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy process-order
```

For local development, functions run automatically via `supabase start`.

---

## Step 6: Start Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Step 7: Create Test Accounts

### Parent Account

1. Click "Sign Up" in the app
2. Email: `parent@example.com`
3. Password: `password123`
4. Add a test child profile

### Staff Account (Manual)

Via Supabase Dashboard → Authentication:

1. Create user `staff@example.com`
2. Go to SQL Editor:

```sql
UPDATE auth.users 
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{role}',
  '"staff"'
)
WHERE email = 'staff@example.com';
```

---

## Common Commands

```bash
# Development
npm run dev              # Start dev server
npm run build            # Production build
npm run preview          # Preview production build

# Testing
npm test                 # Run unit tests
npm run test:e2e         # Run Playwright tests
npm run test:coverage    # Generate coverage report

# Linting
npm run lint             # ESLint
npm run format           # Prettier

# Supabase
supabase status          # Check local status
supabase migration new   # Create new migration
supabase db reset        # Reset local database
supabase functions serve # Test functions locally
```

---

## Environment Variables

| Variable | Description | Example |
| -------- | ----------- | ------- |
| `VITE_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Public anon key | `eyJhbGc...` |
| `VITE_VAPID_PUBLIC_KEY` | Push notification public key | `BMjw...` (optional) |

**Security**: Never commit `.env` to Git!

---

## Troubleshooting

### Port Already in Use

```bash
# Kill process on port 5173
lsof -ti:5173 | xargs kill -9
```

### Supabase Connection Error

1. Check `.env` has correct URL and key
2. Verify project is not paused (free tier)
3. Check network/firewall settings

### Migration Conflicts

```bash
# Reset local database
supabase db reset

# Pull remote migrations
supabase db pull
```

### Service Worker Not Updating

```bash
# Clear browser cache
# Or use incognito mode for testing
```

---

## IDE Setup (VS Code)

Recommended extensions:

- ESLint
- Prettier
- Tailwind CSS IntelliSense
- Supabase
- TypeScript + JavaScript

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

---

## Next Steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for system overview
- Review [API.md](API.md) for backend contracts
- Check [COMPONENTS.md](COMPONENTS.md) for UI component guide
- See [PWA_GUIDE.md](PWA_GUIDE.md) for offline features
