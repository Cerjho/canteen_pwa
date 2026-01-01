# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Student Management System**: Admin-only student registration
  - Admin can add students manually or via CSV import
  - Auto-generated Student IDs (YY-XXXXX format)
  - Admin Students page with search, filter, and bulk actions
  - Parents link to students using Student ID (no longer add directly)
- Student ID column in children table
- `created_by` tracking for student records
- CSV import with template download feature

### Changed

- `children.parent_id` is now nullable (students exist before parent links)
- Profile page redesigned for linking flow instead of adding children
- Admin nav updated with "Students" menu item

### Security

- New RLS policies for student management:
  - Admins: Full CRUD on all students
  - Parents: View linked children, link unlinked students, update dietary info
  - Staff: View all students for order processing

## [1.0.0] - 2026-01-15

### Added in 1.0.0

- PWA with offline support
- Supabase backend integration
- Row Level Security policies
- Payment method selection
- Order history
- Real-time order status updates
- Push notifications
- E2E testing suite

### Security

- Implemented RLS on all tables
- Added input validation
- HTTPS enforced

## [0.2.0] - 2026-01-08

### Added in 0.2.0

- Cart functionality
- Child selector component
- Product cards with images
- Responsive design

### Changed

- Improved mobile navigation
- Updated color scheme

### Fixed

- Cart drawer animation glitch
- Product price formatting

## [0.1.0] - 2026-01-01

### Added in 0.1.0

- Project scaffold
- Basic routing
- Supabase setup
- Initial database schema

---

## Version Format

**Major.Minor.Patch** (e.g., 1.2.3)

- **Major**: Breaking changes
- **Minor**: New features (backward compatible)
- **Patch**: Bug fixes

## Categories

- **Added**: New features
- **Changed**: Changes to existing functionality
- **Deprecated**: Features to be removed
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security improvements
