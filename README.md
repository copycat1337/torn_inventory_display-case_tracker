# Torn Marketplace Inventory Highlighter

A lightweight **Tampermonkey userscript for Torn City** that makes marketplace browsing easier by highlighting items based on your ownership and automatically identifying prices that meet your custom buying targets.

The script combines your **inventory and display case quantities**, highlights marketplace items using configurable color thresholds, and pulses prices when they reach your target price.

No external backend, no subscriptions, and no third-party services. Everything is handled locally in your browser.

▶️ **[Watch the Full Tutorial](https://youtu.be/qaSJkIwHGWU)**

## ✨ Features

### 🎨 Color-Coded Marketplace Highlights

Automatically highlights item names across the Item Market and player bazaars based on how many you currently own.

- 🔴 **Red** — Low quantity.
- 🟡 **Yellow** — Medium quantity.
- 🟢 **Green** — High quantity.
- Configurable thresholds globally or individually for each item.

### 📦 Inventory + Display Case Tracking

Combines data from two sources to calculate your actual item ownership:

- **Inventory:** Retrieved using the official Torn API.
- **Display Case:** Retrieved directly from the Display Case page using DOM scraping.

Hover over a highlighted item to see its ownership breakdown.

Example:

`Total: 3 · Inventory: 1 · Display Case: 2`

### 💰 Price Target Alerts

Set custom maximum buying prices for individual items.

- Marketplace prices at or below your target pulse bright green.
- Automatically identifies buying opportunities while browsing.
- Uses locally cached price targets without additional API requests.

### ⭐ Watchlist

Keep track of items you want to purchase, even if you don't currently own them.

- Add items to your personal watchlist.
- Configure maximum buying prices.
- Receive the same green pulsing price highlights.
- Track potential purchases without adding them to your inventory.

### 📊 Items Management Panel

A dedicated panel provides an overview of your tracked items.

Features include:

- Sortable item list.
- Search and filtering.
- Separate Inventory, Display Case, and Total columns.
- Per-item threshold configuration.
- Price target management.
- Watchlist management.

### 🖥️ Customizable Interface

- Draggable panel.
- Collapsible interface.
- Hide and show functionality.
- Automatically saves panel position and state.
- Settings persist between browser sessions.

---

## 🚀 Installation

### Requirements

- [Torn City](https://www.torn.com/)
- [Tampermonkey](https://www.tampermonkey.net/)
- A Torn API key with read-only permissions.

### Setup

1. Install the Tampermonkey browser extension.
2. Install the userscript from this repository.
3. Open Torn City and locate the inventory highlighter panel.
4. Click **🔑 Key** and enter your read-only Torn API key.
5. Click **🔄 Inventory** to retrieve your inventory.
6. Visit your [Display Case](https://www.torn.com/displaycase.php).
7. Click **🏛️ Display Case** to synchronize your display case.
8. Open **⚙️ Settings** to configure your color thresholds and price targets.
9. Optionally, use **⭐ Watchlist** to track items you want to purchase.

You're ready to go!

**Note:** Inventory and display case snapshots are saved locally. You only need to refresh them when your item quantities change.

---

## 🔌 API Usage

The script is designed to minimize API consumption and stays comfortably below Torn's **100 requests per minute** API limit.

| Action | API Requests | Description |
|:---|:---:|:---|
| 🔄 Inventory refresh | ~25–30 | Retrieves inventory data across item categories, including fallback sweeps. |
| 🏛️ Display Case sync | 0 | Reads the currently loaded Display Case page using DOM scraping. |
| Marketplace highlighting | 0 | Uses locally cached inventory and display case data. |
| 💰 Price target alerts | 0 | Uses locally stored price targets. |
| ⭐ Watchlist | 0 | Uses locally stored watchlist entries. |

### Refresh Cooldown

- Inventory refresh is manual.
- A 60-second cooldown prevents excessive API requests.
- A full refresh uses approximately 25–30 requests.
- Even refreshing every 60 seconds would use approximately 30 requests per minute, less than one-third of the API limit.

Normal usage is significantly lower because marketplace browsing does not generate additional API requests.

---

## 💾 Local Data Storage

All user data is stored locally in your browser using Tampermonkey's `GM_setValue` storage API.

**No external database or backend is required.**

| Storage Key | Description |
|:---|:---|
| `torn_api_key` | Your Torn API key. |
| `torn_inventory_only_snapshot` | Inventory snapshot retrieved from the API. |
| `torn_displaycase_only_snapshot` | Display Case snapshot retrieved through page scraping. |
| `torn_inv_thresholds` | Individual item color thresholds. |
| `torn_inv_default_threshold` | Global default color thresholds. |
| `torn_inv_price_targets` | Individual maximum buying prices. |
| `torn_inv_watchlist` | Your tracked watchlist items. |
| `torn_inv_panel_pos` | Saved panel position. |
| `torn_inv_panel_pos_collapsed` | Saved collapsed state. |
| `torn_inv_panel_pos_hidden` | Saved visibility state. |

All snapshots and settings persist between browser sessions.

---

## 🔒 Privacy & Security

Privacy is a priority. The userscript is designed to operate entirely within your browser.

- **API key stays local:** Your Torn API key is stored in Tampermonkey's local storage.
- **Official API only:** Your API key is transmitted exclusively to `api.torn.com`.
- **No third-party servers:** No external backend or cloud storage is involved.
- **No analytics:** No tracking, telemetry, or analytics services.
- **Local configuration:** Item quantities, thresholds, watchlists, and price targets remain on your machine.
- **Restricted network access:** The userscript's `@connect api.torn.com` metadata directive restricts its permitted network connection to Torn's official API.

### Recommended API Permissions

Use a dedicated **read-only API key** with the minimum permissions required:

- User Inventory — required for inventory retrieval.
- Display Case — optional; the script reads display case quantities directly from the page.

**Never use a full-access API key for this script.**

---

## 🛠️ Technical Overview

| Component | Implementation |
|:---|:---|
| Platform | Torn City |
| Script Type | Tampermonkey Userscript |
| API | Official Torn API |
| Inventory Data | Torn API |
| Display Case Data | DOM Scraping |
| Local Storage | Tampermonkey `GM_setValue` |
| Marketplace Detection | DOM Monitoring |
| External Backend | Not required |

---

## 📌 Important Notes

- Inventory and Display Case data are maintained as separate snapshots.
- The total ownership count is calculated by combining both snapshots.
- Display Case synchronization requires visiting the Display Case page.
- Marketplace highlighting relies on cached data and does not continuously query the API.
- Price targets and watchlist entries are configured independently of ownership thresholds.

---

## 📜 Disclaimer

This is an independent community-made userscript for Torn City.

It is not affiliated with, endorsed by, or officially associated with Torn City or its developers.

Use responsibly and ensure your API usage complies with Torn's API policies and game rules.

---

**Made for Torn City players who want smarter marketplace browsing.**
