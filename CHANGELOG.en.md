# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-10-25

### Fixed
- Invoice filtering now works with a start date only or an end date only, including end-of-day in Cairo time.
- Telegram notifications now track each Chat ID independently: recipients that were already reached are not sent to again, and only failed deliveries are retried.
- Added handling for HTTP 429 and respect for the `retry_after` delay before retrying.
- Long Telegram messages are split into chunks instead of being rejected by Telegram or the proxy.
- Closing a shift now shows invoice and service counts and displays "No prices" instead of EGP 0 when pricing is unavailable.
- Added notifications for bulk price changes and a one-time app-update notification after installing a new version.

### Changed
- The invoice WhatsApp link now uses the car-wash owner's WhatsApp number from Settings. It remains fully manual with no WhatsApp API.
- Improved the Telegram setup steps in Settings, including `/start` instructions and local token storage.
- Updated the version snapshot and Service Worker to `1.0.1`.

### Removed
- Unused imports and functions from the cashier, customers, plate, settings, and reports modules.
- The fallback to the customer's phone number for the invoice WhatsApp link.

## [1.0.0] - 2026-10-25

### Added
- Complete cashier screen: categories (cars, tuk-tuk, motorcycle), large service grid, quick cart, notes, and worker.
- Optional pricing: services start with no price, and invoices and reports work without prices.
- License plate input panel (Arabic letters + numbers) with on-screen letter selection, Arabic digit conversion, and previous plate suggestions.
- Egyptian customer phone validation (010/011/012/015) with autocomplete and automatic name/plate filling from a previous invoice.
- 58/80 mm thermal printing with a local QR code, preview, test print, no-print copy, and kiosk printing support.
- Invoice storage with automatic numbering, search, reprint, WhatsApp sharing, and cancellation with a reason (managers only).
- Reports: daily summary, custom range, by service, by worker, payment methods, and CSV export with UTF-8 BOM.
- Daily expenses and net profit calculation when prices are available.
- Customers and credit: balances, payment recording, and account statements.
- Complete settings: car-wash details and logo, services and prices (inline editing, sorting, disabling, bulk category price, vehicle-size prices), workers, users and roles with hashed PINs (SHA-256 + salt), printing, notifications, backup, updates, and about.
- JSON backup with version metadata and safe restore after saving a snapshot of the current state.
- Telegram notifications with an IndexedDB outbox (pending/sent/failed), automatic retry, manual queue, and Cloudflare Worker proxy support.
- GitHub update checks (`version.json` + `releases/latest`), a what's-new modal, update instructions, and a new-version notice.
- Local launcher `start.bat` / `start.sh` on fixed port 8080 with Arabic messages, plus `update.bat` to download the latest Release and keep a backup.
- Optional localhost-only Service Worker with a versioned cache and old-cache cleanup.
- PWA manifest and icons, dark/light mode, and F2 / F4 / Esc shortcuts.
- Optional ESC/POS printing over Web Serial / Web Bluetooth (Arabic rasterization) with automatic fallback to browser printing.
- Arabic/English documentation, Cloudflare Worker code, and a Telegram bot setup guide.

## [0.5.0] - 2026-10-25

### Added
- Local launcher on a fixed port, GitHub update checks, `update.bat`, and the release workflow.
- JSON backup and restore, plus a daily backup reminder.

## [0.4.0] - 2026-10-25

### Added
- Users and roles (manager/cashier) with PINs, advanced settings, Telegram notifications, and the send queue.

## [0.3.0] - 2026-10-25

### Added
- Services, prices, and sizes editor; reports with CSV; expenses; and customers/credit.
- Printing and services settings panels.

## [0.2.0] - 2026-10-25

### Added
- Invoice storage in IndexedDB, plus an invoice screen with search, reprint, and cancellation.

## [0.1.0] - 2026-10-25

### Added
- First version: cashier screen, cart, plate/phone input, 80 mm printing, and optional prices.
- Project structure, local Dexie, local Cairo font, and the requested services with blank prices.
