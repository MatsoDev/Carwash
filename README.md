# Carwash POS

A complete Arabic cashier system for a car wash. It runs locally on Windows or on any device with Node.js/Python and a modern browser. No cloud sign-up and no permanent internet connection are required.

Data is stored in IndexedDB on the same device and remains available after closing the browser. Do not clear browser data or change the app origin; doing so may make the existing database inaccessible.

## Features

- Fast touch cashier: categories (cars, tuk-tuk, motorcycle), a large service grid, cart, discounts, and cash/Visa/credit payments.
- License plate entry with previous-visit suggestions and Egyptian phone-number validation.
- Fully optional pricing: services can be recorded with no amount, and invoices/reports work without prices.
- Invoices with search and filtering, reprinting, cancellation with a reason, and a manual WhatsApp link.
- Daily and custom-range reports: revenue, services, payment methods, workers, cashier, expenses, and net.
- Customers, credit balances, account statements, and payment recording.
- Expenses with categories, summaries, and CSV export.
- Browser-based 58/80 mm thermal printing, invoice QR codes, and optional ESC/POS over Web Serial or Web Bluetooth.
- Telegram notifications with an outbox, automatic retries, and selectable privacy levels.
- JSON backup and restore, daily reminders, and a safety snapshot before restoring.
- Manager/cashier users, PBKDF2-hashed PINs, and an audit log.
- GitHub update checks and release notes.
- Arabic RTL interface, dark mode, PWA support, and a localhost-only Service Worker.

## Quick Start

### Requirements

- Windows 10/11.
- Node.js 18 or newer (20+ recommended), or Python 3.10+ as an alternative.
- A recent version of Chrome or Edge. Firefox does not support Web Serial/Bluetooth, and Safari has limited support.

### Windows

1. Open the application folder.
2. Run `start.bat`.
3. A local server starts and opens:

```text
http://localhost:8080
```

4. Sign in with the default accounts:

| Account | PIN |
|---|---|
| Manager | `1234` |
| Cashier | `1111` |

Change both PINs immediately from **Settings → Users**.

### macOS / Linux

```bash
chmod +x start.sh
./start.sh
```

Or start the server directly:

```bash
node server.js
```

Do not open `index.html` by double-clicking it. Browsers block ES module loading over `file://`, so a warning page may appear instead of the application.

## Daily Use

- **Cashier**: choose a category, then a service. If size-based pricing is enabled, a size picker appears. Add services to the cart, then pay and print.
- **License plate**: enter the letters and numbers. The app may suggest customer details from a previous visit.
- **Discount**: use a fixed amount or a percentage. When notifications are enabled, a warning is shown if the discount exceeds the large-discount threshold.
- **Credit**: requires a valid phone number and adds the amount to the customer's balance.
- **Invoices**: managers can cancel an invoice with a reason. Cancellation restores the credit balance and keeps the invoice in the history.
- **Shift**: open a shift from Reports, then close it to review the period's sales and send a Telegram summary.
- **Expenses**: enter the date, category, and amount; expenses are included in net profit.

Prices can be left blank. When **Enable pricing** is turned off in service settings, the cashier works as a service log without amounts, and totals are hidden from invoices and notifications.

## Printing

### Browser Printing

- The default paper width is 80 mm; 58 mm can be selected in Settings.
- In the print dialog, choose the printer, set margins to "None", and disable headers and footers.
- Use **Test print** from **Settings → Printing**.
- The invoice QR code is printed when enabled.

### Direct ESC/POS

- **USB / Serial**: supported in Chrome/Edge on Windows. Select the printer port and set the matching baud rate, usually `9600`.
- **Bluetooth**: supported in compatible browsers. The printer must be in pairing mode.
- The connection is not retained after closing the browser and may need to be re-established.
- Check the printer manual for the correct serial baud rate.

## Telegram Notifications

The complete Arabic step-by-step guide is in [`docs/telegram-setup-ar.md`](docs/telegram-setup-ar.md), and the Cloudflare Worker code is in [`docs/cloudflare-worker.js`](docs/cloudflare-worker.js).

Summary:

1. Create a bot through `@BotFather`.
2. Deploy the Worker with `TELEGRAM_BOT_TOKEN` and `PROXY_SECRET`.
3. In the app, go to **Settings → Notifications** and enter the Chat IDs, Worker URL, and proxy secret.
4. Click **Send test message**.

Messages are sent only when the relevant event is enabled and a Chat ID and delivery method are configured. Outbox messages are sent when the internet returns and are retried automatically.

## Backup and Restore

- Use **Settings → Backup** to download a complete JSON file.
- Keep the file outside the cashier device, such as in Google Drive or on a USB drive.
- During restore, the app first downloads a safety copy of the current data, then replaces all tables with the backup data.
- Restore does not merge data; it is a full replacement.
- Backups may contain customer data, invoice history, and Telegram settings. Treat them as sensitive files.
- The daily backup reminder can be disabled or postponed.

## Updates

Check for updates from **Settings → Updates**, or run `update.bat` on Windows.

`update.bat`:

1. Asks whether you want to create a backup.
2. Saves the current application files in `backups/`.
3. Downloads the latest GitHub Release.
4. Replaces application files while keeping the IndexedDB database intact.

Create a JSON backup before updating as well. Releases are built automatically when a tag such as `v1.0.1` is pushed, and `version.json` must match the tag.

## Privacy and Security

- All data is local. There is no central server.
- User PINs are stored as PBKDF2-HMAC-SHA256 with a salt. A forgotten PIN cannot be recovered from the hash; a manager can assign a new one.
- The default PINs are weak. Change them before real use.
- Never commit a bot token to the repository. When using the Worker, the token stays inside Cloudflare.
- Access to the device, browser profile, or JSON backup is enough to view car-wash data.
- Change the app origin or add a backend only if you know how to migrate the database.
- Do not use "Clear site data" in browser tools without a backup.
- The Service Worker runs on `localhost` only, caches UI files, and never caches the database.

## Project Structure

```text
index.html               Application shell
css/style.css            Main styles
css/print.css            Thermal invoice styles
js/app.js                Bootstrap, routing, and lock screen
js/db.js                 Dexie/IndexedDB and all data operations
js/auth.js               Users and login sessions
js/cashier.js            Cashier screen
js/cart.js               Cart logic
js/plate.js              License plate input
js/invoices.js           Invoices
js/reports.js            Reports and shifts
js/expenses.js           Expenses
js/customers.js          Customers and credit
js/settings.js           Settings
js/print.js              Browser printing
js/escpos.js             ESC/POS
js/notifications.js      Telegram and outbox
js/backup.js             Backup and restore
js/updater.js            Update checks
js/version.js            Version and SemVer comparison
js/ui.js                 Shared UI helpers
server.js                Dependency-free local server
tools/serve.py           Python fallback server
tools/update.ps1         Windows updater
data/seed.json           Initial data
docs/                    Telegram guide and Worker code
icons/                   PWA icons
```

## Development and Releases

There is no build step. Edit the HTML/CSS/JS files directly, then reload the page.

Before a release:

1. Update `version.json`.
2. Add the new version to `CHANGELOG.md` (the Arabic in-app changelog) and `CHANGELOG.en.md` (English release notes for GitHub).
3. Confirm that `sw.js` lists every required file.
4. Test login, invoice creation, cancellation, reports, backup, and a test notification.
5. Create and push the tag:

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions verifies that `version.json` matches the tag, then builds the ZIP and publishes the Release.

## Troubleshooting

**Port 8080 is busy:** close the old command prompt window or restart the machine. Do not change the port unless you understand that a different origin may hide the existing IndexedDB data.

**Blank page:** run `start.bat` and do not open the file directly. Check the browser console for the error.

**Data is missing after changing the address:** IndexedDB is tied to the origin (scheme, host, and port). Always use `http://localhost:8080`, or restore a JSON backup.

**Printer does not print:** use Chrome/Edge, verify the connection, and print a test page from Settings. If ESC/POS fails, use browser printing.

**Telegram does not work:** review [`docs/telegram-setup-ar.md`](docs/telegram-setup-ar.md), and check the Chat ID, Worker secret, and internet connection.

**Backup will not restore:** confirm that the JSON file came from this application, is not corrupted, and is not newer than the current app version.

## License

This project was prepared for the private use of the car-wash owner. No open-source license file is included. Contact the repository owner before redistributing it.
