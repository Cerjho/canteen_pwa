# Product Roadmap

## Vision

To be LOHECA's leading canteen management solution, enabling parents to easily place weekly meal pre-orders for their students with transparency and convenience.

---

## Q1 2026 (Current)

### ✅ Completed

- [x] MVP launch with parent authentication
- [x] Basic order placement with offline support
- [x] Staff dashboard for order processing
- [x] **Weekly Pre-Order System** (full refactor)
  - Weekly cart with Mon–Fri day grouping
  - Configurable cutoff (Friday 5 PM default)
  - Day-level cancellation (before 8 AM)
  - Cutoff countdown timer
- [x] **PayMongo Payment Integration**
  - GCash, PayMaya, credit/debit card checkout
  - Batch and weekly checkout sessions
  - Webhook-based payment confirmation
  - Self-healing payment status checks
- [x] **Student Management System**
  - Admin CSV import of students
  - Auto-generated Student IDs (YY-XXXXX)
  - Parent linking via Student ID
  - Many-to-many parent-student relationships
- [x] **Simplified Product Model**
  - Removed stock tracking (availability toggle only)
  - Removed wallet/balance system
- [x] Surplus item management (staff-posted leftovers)
- [x] Staff-initiated walk-in orders

### 🚧 In Progress

- [ ] SMS notifications (Semaphore/Twilio)
- [ ] Push notifications (OneSignal)

---

## Q2 2026

### Features

- [ ] **Weekly Reporting**
  - Staff weekly prep summary (orders by day/meal period)
  - Admin revenue reports (weekly, monthly)
  - Parent spending summaries
  - CSV/PDF export

- [ ] **Enhanced Menu Management**
  - School calendar integration (holidays auto-skip)
  - Rotating weekly menus
  - Nutritional information display
  - Allergen warnings based on student dietary data

- [ ] **Notification System**
  - Order ready alerts
  - Payment confirmation notifications
  - Weekly cutoff reminders
  - Day cancellation confirmations

- [ ] **Favorites & Quick Reorder**
  - Save favorite meal combinations
  - One-tap weekly reorder from previous week

---

## Q3 2026

- [ ] **Advanced Analytics**
  - Popular items dashboard
  - Revenue trends and projections
  - Parent ordering patterns
  - Peak ordering times analysis

- [ ] **Multi-School Support**
  - White-label configuration
  - School administrator portal
  - Cross-school reporting

- [ ] **Communication**
  - In-app announcement broadcast
  - Parent feedback surveys
  - Canteen menu suggestions

- [ ] **Mobile Apps**
  - iOS/Android wrapper (Capacitor)
  - App Store/Play Store launch

---

## Q4 2026

- [ ] **Enhanced Parent Features**
  - Spending limits per student
  - Weekly/monthly budget tracking
  - Multi-language support (Filipino, English)

- [ ] **AI-Powered Features**
  - Meal recommendations based on student preferences
  - Demand forecasting for the canteen
  - Smart menu suggestions

- [ ] **Expanded Payment Options**
  - Auto-charge for weekly orders (recurring payments)
  - Convenience fee configuration
  - Detailed transaction history with receipts

---

## 2027 and Beyond

### Vision Items

- [ ] Franchise/multi-canteen support
- [ ] API for third-party integrations
- [ ] Additional language support (Cebuano, Ilocano)
- [ ] Voice ordering via smart assistants
- [ ] Carbon footprint tracking for meals
- [ ] Marketplace (school supplies, uniforms)

---

## Technical Debt

Items to address:

- [ ] Improve test coverage to 90%+
- [ ] Optimize bundle size
- [ ] Add comprehensive monitoring (Datadog/Sentry)
- [ ] Migrate to React 19 when stable
- [ ] E2E test coverage for payment flows

---

## Release Schedule

- **Major releases**: Quarterly
- **Minor releases**: Monthly
- **Patches**: As needed (security/critical bugs)

---

## Priorities

1. **Security** — Always top priority (RLS, auth, payment security)
2. **Reliability** — Payments and orders must never fail silently
3. **Performance** — Fast on slow devices with spotty connectivity
4. **User Experience** — Intuitive weekly ordering workflow
5. **Scalability** — Support 10,000+ students per school

---

## Success Metrics

| Metric | Current | Q2 Target | Q4 Target |
| ------ | ------- | --------- | --------- |
| Active parents | 250 | 1,000 | 5,000 |
| Weekly orders | 200 | 800 | 4,000 |
| App rating | 4.2 | 4.5 | 4.7 |
| Offline success rate | 92% | 98% | 99% |
| Page load time | 2.8s | 2.0s | 1.5s |
| Online payment adoption | 30% | 50% | 70% |
