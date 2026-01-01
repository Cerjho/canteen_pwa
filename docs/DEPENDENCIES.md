# Dependencies

## Overview

All dependencies with versions, purposes, and licenses.

---

## Production Dependencies

### Core Framework

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `react` | ^18.2.0 | UI library | MIT |
| `react-dom` | ^18.2.0 | DOM rendering | MIT |
| `react-router-dom` | ^6.21.0 | Client-side routing | MIT |
| `typescript` | ^5.3.3 | Type safety | Apache-2.0 |

### Backend & Auth

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `@supabase/supabase-js` | ^2.39.0 | Backend SDK | MIT |
| `@supabase/auth-helpers-react` | ^0.4.2 | Auth hooks | MIT |

### State Management

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `@tanstack/react-query` | ^5.17.0 | Data fetching | MIT |
| `zustand` | ^4.4.7 | Local state | MIT |

### Storage

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `idb` | ^8.0.0 | IndexedDB wrapper | ISC |

### PWA

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `vite-plugin-pwa` | ^0.17.4 | PWA generation | MIT |
| `workbox-window` | ^7.0.0 | Service worker | MIT |

### UI & Styling

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `tailwindcss` | ^3.4.0 | CSS framework | MIT |
| `lucide-react` | ^0.303.0 | Icon library | ISC |
| `clsx` | ^2.1.0 | Class merging | MIT |

### Forms & Validation

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `react-hook-form` | ^7.49.2 | Form management | MIT |
| `zod` | ^3.22.4 | Schema validation | MIT |

### Utilities

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `date-fns` | ^3.0.6 | Date formatting | MIT |
| `uuid` | ^9.0.1 | UUID generation | MIT |

---

## Development Dependencies

### Build Tools

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `vite` | ^5.0.10 | Build tool | MIT |
| `@vitejs/plugin-react` | ^4.2.1 | React plugin | MIT |

### Testing

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `vitest` | ^1.1.0 | Unit testing | MIT |
| `@testing-library/react` | ^14.1.2 | React testing | MIT |
| `@testing-library/jest-dom` | ^6.1.5 | DOM matchers | MIT |
| `@playwright/test` | ^1.40.1 | E2E testing | Apache-2.0 |

### Linting & Formatting

| Package | Version | Purpose | License |
| ------- | ------- | ------- | ------- |
| `eslint` | ^8.56.0 | Linting | MIT |
| `prettier` | ^3.1.1 | Code formatting | MIT |
| `@typescript-eslint/parser` | ^6.18.0 | TS linting | MIT |

---

## Supabase Edge Function Dependencies

| Package | Version | Purpose |
| ------- | ------- | ------- |
| `@supabase/supabase-js` | ^2.39.0 | Supabase client |

---

## Bundle Size Analysis

| Category | Size (gzipped) |
| -------- | -------------- |
| React core | ~45 KB |
| Supabase SDK | ~25 KB |
| React Query | ~15 KB |
| Tailwind CSS | ~10 KB |
| Icons | ~8 KB |
| Utilities | ~12 KB |
| **Total** | **~115 KB** |

---

## Security Considerations

### Known Vulnerabilities

Check regularly:

```bash
npm audit
```

Auto-fix where possible:

```bash
npm audit fix
```

### Update Strategy

- **Major versions**: Quarterly (with testing)
- **Minor versions**: Monthly
- **Patches**: Weekly (security fixes immediately)

---

## License Compliance

All dependencies use permissive licenses (MIT, Apache-2.0, ISC).

No GPL or copyleft licenses that restrict commercial use.

---

## Alternatives Considered

| Current | Alternative | Reason for Choice |
| ------- | ----------- | ----------------- |
| Supabase | Firebase | Open-source, better RLS |
| React Query | SWR | More features, better caching |
| Tailwind | Styled Components | Smaller bundle, faster dev |
| Vite | webpack | Faster builds, simpler config |

---

## Deprecated Dependencies

None currently. Watch list:

- `react-router-dom` v6 → v7 (planned 2026)

---

## Adding New Dependencies

Before adding:

1. Check bundle size impact
2. Verify license compatibility
3. Assess maintenance status (last update, issues)
4. Consider tree-shaking support
5. Document in this file

```bash
# Add dependency
npm install package-name

# Update this file
# Add entry to appropriate table
```text

---

## Dependency Graph

```text
canteen-pwa
├── react (UI)
│   ├── react-router-dom (routing)
│   └── react-query (data)
│       └── @supabase/supabase-js (backend)
├── vite (build)
│   ├── vite-plugin-pwa (PWA)
│   └── @vitejs/plugin-react (React support)
└── tailwindcss (styling)
```

---

## Resources

- [npm trends](https://npmtrends.com/)
- [Bundlephobia](https://bundlephobia.com/)
- [Snyk Advisor](https://snyk.io/advisor/)
