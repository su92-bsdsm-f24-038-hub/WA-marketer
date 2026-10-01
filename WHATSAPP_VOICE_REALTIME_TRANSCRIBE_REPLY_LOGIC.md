# WhatsApp Voice Realtime Transcription and Auto-Reply Logic

This document explains the full runtime logic used by the extension to:
1) detect incoming WhatsApp voice messages in real time,
2) decrypt and transcribe them,
3) generate an AI reply,
4) send the reply back in WhatsApp (including quote-reply to the original voice message).

It also covers the secondary in-chat voice-transcriber UI flow.

## 1. Main Components

- `content.js`
  - Injects page-world helpers into WhatsApp Web.
  - Runs the realtime response monitor.
  - Decides whether to reply, calls transcription, generates AI reply, and enqueues send.

- `idb-interceptor-page.js`
  - Hooks WhatsApp Web IndexedDB writes (`IDBObjectStore.put/add`) in the page context.
  - Emits realtime message events to the content script via `window.postMessage`.

- `background.js`
  - Handles privileged/background tasks:
    - `TRANSCRIBE_VOICE` (download encrypted media, decrypt, send to transcription API)
    - `TRACK_AI_REPLY` and reply status API calls
    - AI chat/transcription calls for the content side (sent directly to the provider chosen in Settings via `ai-providers.js`).

- `wa-store-send-page.js`
  - Sends text through internal WhatsApp Web modules (`WAWeb...` APIs).
  - Supports quoted reply via `quotedMsgId`.

- `voice-extractor-page.js`
  - Used by the UI transcriber path to extract voice media metadata from React fiber when user clicks "Aa".


## 2. Realtime Pipeline (Incoming Voice -> Transcribe -> AI Reply -> Send)

### 2.1 Injection and event bridge startup

1. On WhatsApp Web load, `content.js` calls `injectIDBInterceptor()`.
2. This injects `idb-interceptor-page.js` into the page world.
3. `content.js` starts a message listener (`startEventListener`) for `window` `message` events.

Result: the extension receives incoming messages immediately when WhatsApp writes them into IndexedDB.

### 2.2 Realtime voice detection from IndexedDB

In `idb-interceptor-page.js`:

1. It monkey-patches:
   - `IDBObjectStore.prototype.put`
   - `IDBObjectStore.prototype.add`
2. For store `message`, it inspects writes and keeps only message types:
   - `chat`
   - `ptt` (voice)
   - `image`
3. For `ptt` it extracts and emits:
   - `messageId`
   - `type = "ptt"`
   - `directPath`
   - `mediaKey` (converted to base64 if needed)
   - `mimetype`
   - `timestamp`
   - `isIncoming`
   - `contactId`
4. It posts this payload to the page:
   - `window.postMessage({ type: "SMARTDM_IDB_MESSAGE", payload }, "*")`

Result: incoming voice messages are surfaced to `content.js` almost instantly.

### 2.3 Content-side realtime event handling and routing

In `content.js`, `onIDBEvent(event)`:

1. Accepts only messages from `window` source.
2. Processes only `SMARTDM_IDB_MESSAGE`.
3. Filters:
   - ignore outgoing messages (`!payload.isIncoming`)
   - ignore already processed/replied messages
   - ignore groups
4. Calls `checkMessageReplyStatus(messageId)` (background + local reply-status store in `local-backend.js`) to avoid duplicate handling.
5. Enriches payload with contact data via `enrichMessageFromIDB`.
6. Applies AI policy checks (enabled/paused/reply mode, CRM rules, etc.).
7. Routes by message type:
   - `ptt` -> `handleVoiceMessage(msg)`
   - `image` -> `handleImageMessage(msg)`
   - other text -> normal text pipeline.

Result: voice messages enter a dedicated voice AI pipeline.

### 2.4 Voice transcription request flow

In `handleVoiceMessage(msg)` (`content.js`):

1. Duplicate guards:
   - in-memory `voiceAIProcessed` set
   - persistent `voiceAIReplied` map in storage
   - local `checkMessageReplyStatus` (chrome.storage)
2. Validates media fields exist (`directPath`, `mediaKey`).
3. Sends background request:
   - `chrome.runtime.sendMessage({ type: "TRANSCRIBE_VOICE", payload: { directPath, mediaKey, mimetype, messageId } })`

In `background.js` (`case "TRANSCRIBE_VOICE"`):

1. Builds CDN URL:
   - `https://mmg.whatsapp.net${directPath}`
2. Downloads encrypted audio bytes.
3. Decrypts using `decryptWhatsAppAudio`:
   - HKDF-SHA256 with info string `"WhatsApp Audio Keys"`
   - derives IV and cipher key
   - AES-CBC decrypt
   - strips last 10 bytes from encrypted payload (MAC tail handling)
4. Wraps decrypted bytes as `audio/ogg` blob.
5. Sends multipart `FormData` to the transcription provider:
   - background helper `proxyOpenAITranscription`
   - `DownlabsAI.transcribe()` → the Whisper-compatible provider set in Settings → Voice transcription (OpenAI, Groq or custom)
   - model field: from Settings (defaults: `whisper-1` / `whisper-large-v3-turbo`)
6. Returns transcription text to content script.

Result: encrypted WhatsApp voice is turned into plaintext transcription.

### 2.5 AI decision and reply generation

Back in `handleVoiceMessage(msg)`:

1. Caches transcription in storage (`voiceTranscriptions`) for UI usage.
2. Checks usage limits via `TRACK_AI_REPLY`.
3. Classifies message to select agent (`classifyInboundMessage`).
4. Loads conversation history (`getConversationHistory`).
5. Calls AI generator (`generateAgentAIReply`) with:
   - transcribed text
   - history
   - context metadata (contact, campaign goal hint)
   - selected agent
6. Gets structured AI result fields like:
   - `shouldReply`
   - `reply`
   - `reactionEmoji` (optional)

Decision logic:

- If `shouldReply = false` and no reaction -> mark status `skipped`.
- If no text reply but reaction exists -> send reaction only.
- If text reply exists -> continue to send queue.

### 2.6 Sending the reply back in WhatsApp

For text reply path, `handleVoiceMessage` calls `enqueueSend({...})` with:

- `phone`
- `message` (AI reply)
- `isAIGenerated: true`
- `replyToWaMessageId: msg.messageId` (important: quoted reply target)
- `onSent` callback (updates status, logs, storage)

In send queue (`content.js`):

1. Waits configured delay (`AI_REPLY_DELAY`, from `aiConfig.replyDelay`, default 5s).
2. Sends via `sendMessageDirect`.
3. `sendMessageDirect` -> `sendTextViaWaWebStoreQueued` -> `sendTextViaWaWebStore`.
4. Payload includes `quotedMsgId` when `replyToWaMessageId` exists.

In `wa-store-send-page.js` (page world):

1. Reads encoded payload from DOM attribute.
2. Resolves WhatsApp chat via `WAWeb` modules.
3. Loads quoted message by `quotedMsgId` and validates reply capability.
4. Builds message object with quote context (`msgContextInfo`) when available.
5. Sends through `WAWebSendMsgChatAction.addAndSendMsgToChat`.
6. Dispatches result event `smartdm-wa-store-send-result` back to content script.

Result: AI reply is sent into WhatsApp and linked as a reply to the original voice message.

### 2.7 Post-send bookkeeping and dedupe

After successful send (`onSent` callback):

1. Records reply status locally:
   - `recordMessageReplyStatus(messageId, "replied")`
2. Saves chat context/logs:
   - received voice text (`[Voice] ...`)
   - sent AI message
3. Marks `voiceAIReplied[messageId] = true` in storage.

If skipped, it records `status = "skipped"`.

This prevents repeated replies across reloads and across devices/processes.


## 3. Secondary Path: In-Chat Voice Transcriber UI

This path is separate from realtime inbound auto-reply, but uses the same transcription provider.

### 3.1 UI trigger

`content.js` voice transcriber module:

1. Injects `voice-extractor-page.js`.
2. Adds "Aa" buttons near voice bubbles.
3. On click (or auto mode), it requests media extraction from page script:
   - event `smartdm-extract-voice`
   - response event `smartdm-voice-data`

### 3.2 Metadata extraction

`voice-extractor-page.js`:

1. Finds target element by `data-smartdm-extract-id`.
2. Walks React fiber tree to locate `props.msg`.
3. Extracts:
   - `directPath`
   - `mediaKey` (base64)
   - `mimetype`
   - `id`
4. Returns via `smartdm-voice-data` event.

### 3.3 Transcribe and optional AI send

1. Content script sends `TRANSCRIBE_VOICE` to background exactly as above.
2. Renders transcription under the bubble and caches it (`voiceTranscriptions`).
3. If `voiceAIReply` is enabled, `sendVoiceToAI()` can generate AI reply and send in active chat by typing into composer (`typeAndSendInCurrentChat`).

Note: this UI path sends by DOM typing simulation, while realtime response monitor path sends via WA Store API queue.


## 4. Key Storage and Control Flags

- `aiConfig.enabled` / `aiPausedUntil`
  - global AI enable/pause.

- `voiceAIReplied`
  - map to avoid duplicate voice replies.

- `voiceTranscriptions`
  - cache of transcription text.

- `voiceAutoTranscribe`
  - auto-run STT in UI transcriber.

- `voiceAIReply`
  - allow automatic AI reply from UI transcriber path.

- `replyDelay` and `debounceTime` in `aiConfig`
  - send delay and text message grouping timings.


## 5. Why this is realtime

The realtime behavior comes from intercepting IndexedDB writes in page context instead of waiting for DOM polling:

1. WhatsApp stores incoming message ->
2. interceptor catches `put/add` immediately ->
3. posts `SMARTDM_IDB_MESSAGE` to content ->
4. voice pipeline starts right away.

This is lower-latency and more reliable than scraping message bubbles only.


## 6. Error handling and fallback behavior

- Missing media fields (`directPath`/`mediaKey`) -> voice pipeline exits safely.
- Transcription API failure -> no send; logs error.
- AI limit exceeded -> no voice reply.
- AI says no reply -> status marked `skipped`.
- Reply send failure -> queue item rejected; not marked replied.
- Reaction-only cases are supported when text reply is absent.


## 7. End-to-end sequence (short form)

1. Incoming voice message written by WhatsApp into IndexedDB.
2. `idb-interceptor-page.js` emits `SMARTDM_IDB_MESSAGE` with media metadata.
3. `content.js` receives event, validates, dedupes, routes to `handleVoiceMessage`.
4. `content.js` asks `background.js` to `TRANSCRIBE_VOICE`.
5. `background.js` downloads encrypted audio from WhatsApp CDN, decrypts, sends to transcription API, returns text.
6. `content.js` checks limits, classifies, gets AI reply decision/content.
7. If reply needed, `enqueueSend` -> `sendMessageDirect` -> `wa-store-send-page.js` sends quoted reply to original voice message.
8. Status/logs/storage are updated (`replied` or `skipped`) to prevent duplicate processing.


## 8. Files to inspect for each stage

- Realtime interception: `idb-interceptor-page.js`
- Realtime orchestration and AI logic: `content.js`
- Decrypt + transcription API call: `background.js`
- WA internal send + quote-reply: `wa-store-send-page.js`
- UI extraction helper: `voice-extractor-page.js`
- Optional body fallback resolver: `wa-message-body-page.js`
- Extension wiring and web-accessible scripts: `manifest.json`
