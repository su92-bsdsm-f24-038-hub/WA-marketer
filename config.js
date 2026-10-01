/*
 * WAMarketer — store & plan configuration.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  TO GO LIVE: fill in gumroad.productId and gumroad.productUrl below,      │
 * │  then reload the extension. Nothing else is needed.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Gumroad setup (one time):
 *   1. Create a membership product on Gumroad: $9.99, billed monthly.
 *   2. On the product's edit page, open the Content tab and switch on
 *      "Generate a unique license key per sale". The same box shows the
 *      product ID; paste it into productId below.
 *   3. Paste the product's public link into productUrl, for example
 *      https://yourname.gumroad.com/l/wamarketer
 *
 * Buyers get their license key in the Gumroad receipt email and in their Gumroad
 * library. They paste it under Plan & License, and the extension checks it with
 * Gumroad's license API (POST https://api.gumroad.com/v2/licenses/verify). No
 * server or API token of your own is needed.
 */
globalThis.WAM_CONFIG = Object.freeze({
  gumroad: Object.freeze({
    // REQUIRED. The Gumroad product ID, for example "SDGgCnivv6gTTHfVRfUBxQ==".
    productId: "-6AjqCw8PQxWAaoFKMpQ3w==",
    // REQUIRED. The checkout page buyers are sent to from "Upgrade to Pro".
    productUrl: "https://downlabs.gumroad.com/l/whatsapp-marketer",
    // Only for products created before 9 January 2023, which Gumroad identifies by
    // permalink instead of ID (the last part of the product link). Leave empty otherwise.
    productPermalink: "",
    // Maximum number of browsers one license can be activated on. 0 = no limit.
    // Gumroad counts every activation, and a user cannot free a seat themselves,
    // so keep this generous if you turn it on.
    maxActivations: 0
  }),

  plan: Object.freeze({
    name: "WAMarketer Pro",
    price: "$9.99",
    period: "month"
  }),

  // Every new install gets a full-featured trial of this many hours.
  trialHours: 24,

  // After the trial, free users can send this many messages per day. Campaign
  // messages, follow-ups, AI auto-replies and scheduled messages all count; the
  // messages a person types in WhatsApp themselves do not. The count resets at
  // local midnight.
  freeDailyMessages: 50,

  // Pro licenses are re-checked with Gumroad this often, so cancelled or refunded
  // subscriptions switch back to the free plan.
  revalidateHours: 12,

  // If Gumroad cannot be reached, a verified license keeps working this long.
  offlineGraceDays: 7,

  // Shown on the Plan & License page for billing questions. Optional.
  supportEmail: ""
});
