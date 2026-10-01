# WAMarketer — Privacy Policy

_Last updated: 27 September 2026_

WAMarketer ("the extension") is a Chrome extension that adds a sales assistant and CRM to WhatsApp Web. This policy explains what data the extension handles and where that data goes.

**Short version:** WAMarketer has no servers of its own. Your contacts, messages, campaigns and settings stay in your browser. Data leaves your browser only when a feature you use needs it: to WhatsApp (to send your messages), to the AI provider you choose (for AI features), and to Gumroad (to check a Pro license key).

## Data the extension handles

| Data | Why | Where it is kept |
| --- | --- | --- |
| WhatsApp chats you open, contact names and phone numbers | To show the CRM for the open chat, track replies, save contacts and send the messages you create | In your browser (Chrome extension storage and IndexedDB) |
| Contact lists you import (CSV or pasted numbers) and campaign messages, attachments and results | To send your campaigns and follow-ups and show their results | In your browser |
| CRM records: contacts, tags, notes, tasks, templates, flows, message logs | To run the CRM features | In your browser |
| AI provider settings and API keys | To call the AI provider you chose | In your browser (local extension storage, not synced) |
| Pro license key and the purchase email Gumroad returns | To confirm your Pro subscription | In your browser |
| Install time, trial start and daily message count | To apply the free trial and the free plan's daily limit | In your browser; the trial start is also kept in Chrome sync storage so reinstalling does not start a second trial |

## When data leaves your browser

- **WhatsApp.** Messages you send with WAMarketer (campaigns, follow-ups, scheduled messages and AI replies you have switched on) are sent through your own logged-in WhatsApp Web session, like messages you type yourself.
- **Your AI provider (optional).** If you set up an AI provider (for example OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, DeepSeek, Mistral, xAI, Together AI, a local Ollama server or a custom endpoint), the text needed for the AI feature you use is sent directly from your browser to that provider with your API key. This can include message text, recent conversation history, contact details relevant to the reply, and voice-note audio for transcription. The provider's own privacy policy applies to that data. AI features are off until you set up a provider, and AI auto-replies stay off until you switch them on.
- **Gumroad.** When you activate or re-check a Pro license, the license key is sent to Gumroad's license API (`api.gumroad.com`). Nothing else is sent.
- **Web pages you import (optional).** If you import a web page into the Knowledge Base, the extension downloads that page. This needs the optional "site access" permission, which Chrome asks you to approve.

WAMarketer does not send your data to its developer, does not use analytics or tracking, does not show ads, and does not sell or share your data.

## Chrome Web Store User Data Policy

The use of information received from Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Data is used only to provide the features you use, is not transferred except as described above, is not used for advertising, credit-worthiness or lending, and is not read by humans.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| Access to `web.whatsapp.com` and `*.whatsapp.net` | Show the sidebar and CRM in WhatsApp Web, send the messages you create, and read voice notes you ask to transcribe |
| Access to AI provider hosts | Send requests to the AI provider you choose |
| Access to `api.gumroad.com` | Check your Pro license key |
| `storage`, `unlimitedStorage` | Keep your contacts, campaigns, attachments and settings in your browser |
| `tabs` | Find your open WhatsApp Web tab and open the dashboard, settings and plan pages |
| `alarms` | Keep campaigns, follow-ups and reminders running on schedule |
| `notifications` | Tell you when a campaign finishes, pauses or reaches the daily limit |
| `clipboardWrite` | Copy phone numbers, templates and reports when you click "copy" |
| Optional site access (asked only when needed) | Import web pages into the Knowledge Base or use a custom AI endpoint |

## Your control

- Switch AI features and auto-replies on or off at any time in the popup, the WhatsApp sidebar or Settings.
- Export or delete CRM data from the dashboard's Settings.
- Remove your license from Plan & License at any time.
- Uninstalling the extension deletes the data it stored in your browser.

## Children

WAMarketer is a business tool and is not directed at children under 13.

## Changes

If this policy changes, the new version will be published at this address with a new "Last updated" date.

## Contact

Questions about this policy: contact us through our Gumroad page, <https://downlabs.gumroad.com>.
