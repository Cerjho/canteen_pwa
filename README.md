# 🍱 Elementary School Canteen PWA

A serverless Progressive Web App for managing canteen orders in Philippine elementary schools. Parents browse menus, place orders for their children, and track order status—all with offline support.

## 🎯 Key Features

- **Parent-Centric**: Parents manage orders for multiple children
- **Offline-First**: Browse menu and queue orders offline
- **Real-Time Updates**: Order status notifications via push/SMS
- **Philippine Context**: PHP currency, GCash/PayMongo integration ready
- **Secure**: Supabase RLS enforcing parent-child relationships
- **Staff Dashboard**: Order preparation and inventory management
- **Admin Panel**: Reports, pricing, and system configuration

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your Supabase credentials

# Run development server
npm run dev

# Build for production
npm run build
```

## 📚 Documentation

- [Architecture](docs/ARCHITECTURE.md) - System design and data flow
- [Setup Guide](docs/SETUP.md) - Development environment setup
- [API Reference](docs/API.md) - Backend endpoints and contracts
- [Data Schema](docs/DATA_SCHEMA.md) - Database structure
- [Deployment](docs/DEPLOYMENT.md) - Production deployment guide
- [PWA Guide](docs/PWA_GUIDE.md) - Progressive Web App features
- [Offline Sync](docs/OFFLINE_SYNC.md) - Offline order queue strategy
- [Security](docs/SECURITY.md) - Security best practices

## 🛠️ Tech Stack

**Frontend**: React 18 + TypeScript + Vite + Tailwind CSS  
**Backend**: Supabase (Auth, Postgres, Edge Functions)  
**State**: React Query + IndexedDB (idb)  
**PWA**: Vite PWA Plugin + Workbox  
**Hosting**: Vercel/Netlify (frontend) + Supabase (backend)  
**CI/CD**: GitHub Actions  

## 👥 User Roles

1. **Parents** (Primary Users)
   - Manage children profiles
   - Browse menu and place orders
   - View order history and balance
   - Receive notifications

2. **Canteen Staff**
   - View and prepare orders
   - Manage inventory
   - Mark orders as fulfilled

3. **Admin**
   - Configure menu and pricing
   - Generate reports
   - Manage user accounts

**Important**: Students do NOT log in. They are represented as records managed by parents.

## 🇵🇭 Philippine Features

- Currency displayed as PHP (₱)
- GCash and PayMongo payment integration hooks
- SMS notifications (via Semaphore/Twilio)
- Compliant with PH Data Privacy Act

## 📱 Offline Support

Orders placed offline are:

1. Queued in IndexedDB per child
2. Automatically synced when online
3. Deduplicated using `client_order_id`
4. Reconciled with server inventory

## 🔒 Security

- Row Level Security (RLS) enforcing ownership
- Parents can only access their children's data
- Staff cannot modify parent/child records
- All orders validated server-side

## 🧪 Testing

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Coverage
npm run test:coverage
```

## 📄 License

MIT License - See LICENSE file for details

## 🤝 Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

## 📞 Support

For issues or questions, please file an issue on GitHub.
