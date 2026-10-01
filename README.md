# WAMarketer — Sales Assistant & CRM for WhatsApp Web

A standalone Chrome extension that turns WhatsApp Web into a CRM and marketing bot with AI auto-replies.

- **No account, no server.** Everything runs in your browser; contacts, campaigns, flows, logs and the knowledge base are stored locally.
- **24-hour free trial, then Free or Pro.** The onboarding offers a one-time 24-hour trial with no limits. Afterwards the free plan keeps every feature with 50 outgoing messages a day, and Pro ($9.99/month, sold through Gumroad) removes the limit.
- **Bring your own AI.** Pick a provider and paste your API key: OpenAI, Anthropic (Claude), Google Gemini, Groq, OpenRouter, DeepSeek, Mistral, xAI, Together AI, Ollama (local) or any OpenAI-compatible endpoint. Requests go straight from your browser to that provider.
- **Voice notes** are transcribed with a Whisper-compatible provider (OpenAI, Groq or custom).

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the project folder.
4. A 5-step onboarding opens on first install: welcome, activate the 24-hour free trial (or go Pro / enter a license key), connect WhatsApp Web, connect an AI provider (optional), and launch the first campaign.
5. Open [WhatsApp Web](https://web.whatsapp.com) and start using the bot.

You can change the provider, model or API key any time from the extension icon → **Settings**, or in the CRM under **Settings → AI Provider & API Key**.

## Privacy

WAMarketer has no servers of its own; data stays in the browser. See [PRIVACY.md](PRIVACY.md) for exactly what is sent to WhatsApp, the chosen AI provider and Gumroad.

## Plans & licensing (Gumroad)

| Plan | What you get |
| --- | --- |
| Trial | 24 hours from when the user activates it (once per Chrome profile): every feature, unlimited messages |
| Free | Every feature, 50 outgoing messages a day (resets at local midnight); also the plan before the trial is activated |
| Pro — $9.99/month | Every feature, unlimited messages |

Campaign messages, follow-ups, AI auto-replies, scheduled messages and test sends count toward the free limit; messages typed by hand in WhatsApp do not. When the limit is reached, campaigns and follow-ups pause with a note and continue after midnight, or right away when Pro is activated.

**Going live — only `config.js` needs editing:**

1. On Gumroad, create a membership product at $9.99, billed monthly.
2. On the product's **Content** tab, turn on **Generate a unique license key per sale** and copy the product ID shown there.
3. In `config.js`, set `gumroad.productId` to that ID and `gumroad.productUrl` to the product link (for example `https://yourname.gumroad.com/l/wamarketer`).
4. Reload the extension.

Buyers get a license key in their Gumroad receipt and paste it under **Plan & License** (popup → Upgrade, the CRM sidebar, or `plans.html`). The extension checks it with `POST https://api.gumroad.com/v2/licenses/verify`, re-checks it every 12 hours, and drops back to Free if the subscription ends, fails to renew, or is refunded. A verified license keeps working for 7 days without internet. Prices, trial length, the free daily limit and these intervals are also set in `config.js`.

The license check runs inside the extension, so it keeps honest users honest; it is not tamper-proof against someone editing the extension's code.

## Project layout

| Path | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Service worker: messaging, campaigns, flows, voice decryption |
| `content.js` | WhatsApp Web integration (sidebar, auto-replies, tools) |
| `ai-providers.js` | Sends AI requests directly to the provider chosen in Settings |
| `local-backend.js` | In-browser replacement for the former hosted API (local profile, usage stats, knowledge base, CRM assistant) |
| `options.html`, `options.js` | Settings page (AI provider, API key, model, voice transcription, reply tuning) |
| `onboarding-gate.js` | Keeps the CRM dashboard closed until onboarding is finished, then returns to the requested page |
| `tour.js`, `tour.css` | Guided-tour engine; the Bulk Sender shows an overview tour and a campaign-editor tour the first time each opens |
| `wa-tours.js` | First-time tutorials in WhatsApp Web: an intro tour, then one per sidebar tab and for the Campaigns chat filter |
| `ai-setup.js`, `ai-setup.css` | "Connect your AI" form shared by the Settings page and onboarding step 4 |
| `popup.html`, `popup.js` | Toolbar popup |
| `config.js` | Store & plan configuration (Gumroad product ID, price, trial length, free limit) |
| `license.js` | Trial, free-plan daily quota and Gumroad license checks (service worker) |
| `welcome.html`, `welcome.js`, `welcome.css` | 5-step onboarding, opens on install (always light theme) |
| `plans.html`, `plans-ui.js`, `plans.css` | Plan & License page and the shared plan widgets |
| `crm/` | CRM dashboard (prebuilt bundle) |

## Privacy

API keys are kept in local extension storage (not synced) and are only sent to the AI provider you select. No data is sent to any other server.
