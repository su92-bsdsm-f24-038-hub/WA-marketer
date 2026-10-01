// WAMarketer — service worker. Runs fully locally: AI calls go straight
// to the provider configured in Settings; the former cloud API is emulated by local-backend.js.
importScripts("ai-providers.js", "local-backend.js", "config.js", "license.js");

const DB_NAME = "SmartDMDatabase";
const OPEN_TIMEOUT_MS = 5e3;
const QUERY_TIMEOUT_MS = 5e3;
function openCrmDb() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("DB open timed out after " + OPEN_TIMEOUT_MS + "ms"));
    }, OPEN_TIMEOUT_MS);
    try {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(new Error("DB open error: " + (request.error?.message || "unknown")));
      };
      request.onblocked = () => {
        clearTimeout(timer);
        reject(new Error("DB open blocked (another tab upgrading)"));
      };
      request.onupgradeneeded = () => {
        clearTimeout(timer);
        try {
          request.transaction?.abort();
        } catch {
        }
        reject(new Error("DB does not exist yet (upgrade needed) — CRM must be opened first"));
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}
function readAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Read ${storeName} timed out`));
    }, QUERY_TIMEOUT_MS);
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        clearTimeout(timer);
        resolve([]);
        return;
      }
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Read ${storeName} error: ${request.error?.message}`));
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}
function readByIndex(db, storeName, indexName, value) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ReadByIndex ${storeName}.${indexName} timed out`));
    }, QUERY_TIMEOUT_MS);
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        clearTimeout(timer);
        resolve([]);
        return;
      }
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      if (!store.indexNames.contains(indexName)) {
        clearTimeout(timer);
        resolve([]);
        return;
      }
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`ReadByIndex ${storeName}.${indexName} error: ${request.error?.message}`));
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}
function addToStore(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Add to ${storeName} timed out`));
    }, QUERY_TIMEOUT_MS);
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        clearTimeout(timer);
        reject(new Error(`Store ${storeName} does not exist`));
        return;
      }
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.add(record);
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Add to ${storeName} error: ${request.error?.message}`));
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}
function putToStore(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Put to ${storeName} timed out`));
    }, QUERY_TIMEOUT_MS);
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        clearTimeout(timer);
        reject(new Error(`Store ${storeName} does not exist`));
        return;
      }
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(record);
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Put to ${storeName} error: ${request.error?.message}`));
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}
function getFromStore(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Get from ${storeName} timed out`));
    }, QUERY_TIMEOUT_MS);
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        clearTimeout(timer);
        resolve(void 0);
        return;
      }
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result || void 0);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Get from ${storeName} error: ${request.error?.message}`));
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}
async function findContactByPhone(phone) {
  const cleanPhone = phone.replace(/\D/g, "");
  const phoneSuffix = cleanPhone.slice(-9);
  if (!phoneSuffix || phoneSuffix.length < 9) return void 0;
  let db = null;
  try {
    db = await openCrmDb();
    const tx = db.transaction("contacts", "readonly");
    const store = tx.objectStore("contacts");
    if (store.indexNames.contains("phoneSuffix")) {
      const index = store.index("phoneSuffix");
      const result = await new Promise((resolve) => {
        const request = index.get(phoneSuffix);
        request.onsuccess = () => resolve(request.result || void 0);
        request.onerror = () => resolve(void 0);
      });
      return result;
    }
    const contacts = await readAllFromStore(db, "contacts");
    return contacts.find((c) => {
      if (!c.phoneNumber) return false;
      return c.phoneNumber.replace(/\D/g, "").slice(-9) === phoneSuffix;
    });
  } catch (err) {
    console.error("[crm-db] findContactByPhone error:", err);
    return void 0;
  } finally {
    db?.close();
  }
}
async function getContactById(id) {
  let db = null;
  try {
    db = await openCrmDb();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction("contacts", "readonly");
      const req = tx.objectStore("contacts").get(id);
      req.onsuccess = () => resolve(req.result || void 0);
      req.onerror = () => reject(req.error);
    });
    return result;
  } catch {
    return void 0;
  } finally {
    db?.close();
  }
}
async function updateContactByPhone(phone, updates) {
  const contact = await findContactByPhone(phone);
  if (!contact || contact.id == null) return false;
  let db = null;
  try {
    db = await openCrmDb();
    const mergedCustomFields = updates.customFields != null ? { ...contact.customFields || {}, ...updates.customFields } : void 0;
    const { customFields: _cf, ...restUpdates } = updates;
    const updated = {
      ...contact,
      ...restUpdates,
      ...mergedCustomFields !== void 0 ? { customFields: mergedCustomFields } : {},
      updatedAt: /* @__PURE__ */ new Date()
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction("contacts", "readwrite");
      const req = tx.objectStore("contacts").put(updated);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return true;
  } catch (err) {
    console.error("[crm-db] updateContactByPhone error:", err);
    return false;
  } finally {
    db?.close();
  }
}
async function getContactFieldsConfig() {
  let db = null;
  try {
    db = await openCrmDb();
    const config = await getFromStore(db, "contactFieldsConfig", "contact-fields");
    return config ?? void 0;
  } finally {
    db?.close();
  }
}
async function addContactField(field) {
  let db = null;
  try {
    db = await openCrmDb();
    const config = await getFromStore(db, "contactFieldsConfig", "contact-fields");
    const fields = config?.fields ?? [];
    const fieldId = "field_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const name = (field.name || field.label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field";
    const newField = {
      id: fieldId,
      name,
      label: field.label || name,
      type: field.type || "string",
      required: field.required ?? false,
      options: field.options,
      order: fields.length
    };
    const updated = {
      id: "contact-fields",
      fields: [...fields, newField],
      updatedAt: /* @__PURE__ */ new Date()
    };
    await putToStore(db, "contactFieldsConfig", updated);
    return { success: true, fieldId };
  } catch (err) {
    return { success: false, error: String(err) };
  } finally {
    db?.close();
  }
}
async function getCustomSchemasList() {
  let db = null;
  try {
    db = await openCrmDb();
    const list = await readAllFromStore(db, "customSchemas");
    return list ?? [];
  } finally {
    db?.close();
  }
}
async function addCustomSchema(schema) {
  let db = null;
  try {
    db = await openCrmDb();
    const schemaId = "schema_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const fields = schema.fields.map((f, i) => ({
      id: "f_" + i + "_" + Math.random().toString(36).slice(2, 6),
      name: (f.name || f.label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field",
      label: f.label || f.name,
      type: f.type || "string",
      required: false,
      options: f.options,
      order: i
    }));
    const record = {
      id: schemaId,
      name: schema.name,
      label: schema.label,
      fields,
      createdAt: /* @__PURE__ */ new Date()
    };
    await putToStore(db, "customSchemas", record);
    return { success: true, schemaId };
  } catch (err) {
    return { success: false, error: String(err) };
  } finally {
    db?.close();
  }
}
async function addCustomRecord(params) {
  let db = null;
  try {
    db = await openCrmDb();
    const now = /* @__PURE__ */ new Date();
    const record = {
      schemaId: params.schemaId,
      contactId: params.contactId,
      data: params.data ?? {},
      createdAt: now,
      updatedAt: now
    };
    const id = await addToStore(db, "customRecords", record);
    return { success: true, recordId: id };
  } catch (err) {
    return { success: false, error: String(err) };
  } finally {
    db?.close();
  }
}
async function createContact(phone, name) {
  const phoneSuffix = phone.replace(/\D/g, "").slice(-9);
  let db = null;
  try {
    db = await openCrmDb();
    if (phoneSuffix.length === 9) {
      const existing = await new Promise((resolve) => {
        const tx = db.transaction("contacts", "readonly");
        const store = tx.objectStore("contacts");
        if (store.indexNames.contains("phoneSuffix")) {
          const req = store.index("phoneSuffix").get(phoneSuffix);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } else {
          resolve(null);
        }
      });
      if (existing && existing.id) {
        console.log("[crm-db] Duplicate prevented, existing id:", existing.id);
        return existing.id;
      }
    }
    const now = /* @__PURE__ */ new Date();
    const contactId = await addToStore(db, "contacts", {
      phoneNumber: phone,
      phoneSuffix: phoneSuffix.length === 9 ? phoneSuffix : "",
      name: name || phone,
      status: "new_lead",
      tags: [],
      notes: "",
      createdAt: now,
      updatedAt: now
    });
    console.log("[crm-db] Contact created, id:", contactId);
    return contactId;
  } catch (err) {
    console.error("[crm-db] createContact error:", err);
    return null;
  } finally {
    db?.close();
  }
}
const EMPTY_RESULT = { contact: null, inCRM: false, messages: [], customRecords: [], campaigns: [], flowExecutions: [], contactFieldsConfig: [] };
async function getFullContactData(phone, name) {
  let db = null;
  try {
    db = await openCrmDb();
    console.log("[crm-db] DB opened, version:", db.version, "stores:", Array.from(db.objectStoreNames));
  } catch (err) {
    console.error("[crm-db] Cannot open DB:", err);
    return EMPTY_RESULT;
  }
  try {
    const phoneSuffix = phone ? phone.replace(/[\s\-\(\)\+]/g, "").slice(-9) : "";
    console.log("[crm-db] getFullContactData:", { phone, name, phoneSuffix });
    const allContacts = await readAllFromStore(db, "contacts");
    console.log("[crm-db] Total contacts:", allContacts.length);
    if (allContacts.length > 0 && allContacts.length <= 20) {
      console.log("[crm-db] All contacts:", allContacts.map((c) => ({ id: c.id, phone: c.phoneNumber, name: c.name })));
    }
    let contact;
    if (phoneSuffix) {
      contact = allContacts.find((c) => {
        if (!c.phoneNumber) return false;
        const cSuffix = c.phoneNumber.replace(/\D/g, "").slice(-9);
        return cSuffix === phoneSuffix;
      });
      console.log('[crm-db] Search by phone suffix "' + phoneSuffix + '":', contact ? `found #${contact.id} "${contact.name}"` : "not found");
    }
    if (!contact && name) {
      contact = allContacts.find((c) => c.name === name);
      if (!contact) {
        const nameLower = name.toLowerCase();
        contact = allContacts.find((c) => c.name?.toLowerCase() === nameLower);
      }
      if (!contact) {
        const nameLower = name.toLowerCase();
        contact = allContacts.find((c) => {
          const cName = c.name?.toLowerCase() || "";
          return cName.includes(nameLower) || nameLower.includes(cName);
        });
      }
      console.log('[crm-db] Search by name "' + name + '":', contact ? `found #${contact.id} "${contact.name}"` : "not found");
    }
    if (!contact || !contact.id) {
      db.close();
      return EMPTY_RESULT;
    }
    const [
      allMessages,
      allCustomRecords,
      allSchemas,
      allCampaigns,
      allFlowExecs,
      allFlows,
      allFieldsConfig
    ] = await Promise.all([
      readByIndex(db, "messages", "contactId", contact.id).catch(() => []),
      readByIndex(db, "customRecords", "contactId", contact.id).catch(() => []),
      readAllFromStore(db, "customSchemas").catch(() => []),
      readAllFromStore(db, "campaigns").catch(() => []),
      readByIndex(db, "flowExecutions", "contactId", contact.id).catch(() => []),
      readAllFromStore(db, "flows").catch(() => []),
      readAllFromStore(db, "contactFieldsConfig").catch(() => [])
    ]);
    db.close();
    const schemaMap = {};
    allSchemas.forEach((s) => {
      schemaMap[s.id] = s.label || s.name;
    });
    const recordsWithLabels = allCustomRecords.map((r) => ({
      id: r.id,
      schemaId: r.schemaId,
      schemaLabel: schemaMap[r.schemaId] || r.schemaId,
      data: r.data,
      createdAt: r.createdAt?.toISOString?.() || String(r.createdAt)
    }));
    const sortedMessages = allMessages.sort((a, b) => {
      const tA = a.timestamp instanceof Date ? a.timestamp.getTime() : Number(a.timestamp) || 0;
      const tB = b.timestamp instanceof Date ? b.timestamp.getTime() : Number(b.timestamp) || 0;
      return tB - tA;
    }).slice(0, 30);
    const messagesData = sortedMessages.map((m) => ({
      id: m.id,
      content: m.content,
      direction: m.direction,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
      isAIGenerated: m.isAIGenerated
    }));
    const contactCampaigns = allCampaigns.filter(
      (c) => c.recipients?.some((r) => {
        const rSuffix = r.phoneNumber?.replace(/\D/g, "").slice(-9);
        return rSuffix === phoneSuffix;
      })
    ).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt)
    }));
    const flowMap = {};
    allFlows.forEach((f) => {
      flowMap[f.id] = f.name;
    });
    const sortedFlowExecs = allFlowExecs.sort((a, b) => {
      const tA = a.startedAt instanceof Date ? a.startedAt.getTime() : Number(a.startedAt) || 0;
      const tB = b.startedAt instanceof Date ? b.startedAt.getTime() : Number(b.startedAt) || 0;
      return tB - tA;
    }).slice(0, 10);
    const flowExecsData = sortedFlowExecs.map((fe) => ({
      id: fe.id,
      flowName: flowMap[fe.flowId] || fe.flowId,
      status: fe.status,
      startedAt: fe.startedAt instanceof Date ? fe.startedAt.toISOString() : String(fe.startedAt),
      completedAt: fe.completedAt instanceof Date ? fe.completedAt.toISOString() : String(fe.completedAt),
      log: fe.log?.slice(-5)
    }));
    const fields = allFieldsConfig[0]?.fields || [];
    console.log("[crm-db] ✅ Full data loaded for", contact.name, "— msgs:", messagesData.length, "records:", recordsWithLabels.length, "campaigns:", contactCampaigns.length, "flows:", flowExecsData.length);
    return {
      contact: {
        id: contact.id,
        name: contact.name,
        phoneNumber: contact.phoneNumber,
        status: contact.status,
        tags: contact.tags,
        notes: contact.notes,
        customFields: contact.customFields,
        lastMessageDate: contact.lastMessageDate instanceof Date ? contact.lastMessageDate.toISOString() : String(contact.lastMessageDate || ""),
        createdAt: contact.createdAt instanceof Date ? contact.createdAt.toISOString() : String(contact.createdAt)
      },
      inCRM: true,
      customRecords: recordsWithLabels,
      messages: messagesData,
      campaigns: contactCampaigns,
      flowExecutions: flowExecsData,
      contactFieldsConfig: fields.map((f) => ({
        id: f.id,
        name: f.name,
        label: f.label,
        type: f.type,
        options: f.options
      }))
    };
  } catch (err) {
    console.error("[crm-db] getFullContactData error:", err);
    db?.close();
    return EMPTY_RESULT;
  }
}
async function getTemplates() {
  let db = null;
  try {
    db = await openCrmDb();
    const templates = await readAllFromStore(db, "templates");
    db.close();
    return templates.map((t) => ({
      id: t.id,
      title: t.title ?? t.name ?? "",
      content: t.content,
      category: t.category || "General",
      shortcut: t.shortcut || "",
      variables: t.variables || []
    }));
  } catch (err) {
    console.error("[crm-db] getTemplates error:", err);
    db?.close();
    return [];
  }
}
async function addTemplate(data) {
  let db = null;
  try {
    db = await openCrmDb();
    const now = /* @__PURE__ */ new Date();
    const title = data.title.trim();
    const id = await addToStore(db, "templates", {
      title,
      name: title,
      content: data.content.trim(),
      category: (data.category?.trim() || "General").toLowerCase(),
      shortcut: data.shortcut?.trim() || "",
      variables: [],
      createdAt: now
    });
    db.close();
    return id;
  } catch (err) {
    console.error("[crm-db] addTemplate error:", err);
    db?.close();
    return null;
  }
}
function toLocalDateIso$1(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function getDateIsoInTimezone(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}
function dateFromIso$1(dateIso) {
  return /* @__PURE__ */ new Date(`${dateIso}T00:00:00`);
}
function enumerateHolidayDates(startDate, endDate) {
  if (!startDate || !endDate) return [];
  if (startDate > endDate) return enumerateHolidayDates(endDate, startDate);
  const dates = [];
  let cursor = dateFromIso$1(startDate);
  const end = dateFromIso$1(endDate);
  while (cursor <= end) {
    dates.push(toLocalDateIso$1(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
function getHolidayDates(settings) {
  if (Array.isArray(settings?.holidayRanges) && settings.holidayRanges.length > 0) {
    return Array.from(
      new Set(
        settings.holidayRanges.flatMap(
          (range) => enumerateHolidayDates(String(range?.startDate || ""), String(range?.endDate || range?.startDate || ""))
        )
      )
    ).sort();
  }
  return Array.isArray(settings?.holidays) ? settings.holidays : [];
}
function getHolidayReasonForDate(settings, dateIso) {
  if (!Array.isArray(settings?.holidayRanges)) return null;
  const holiday = settings.holidayRanges.find((range) => {
    const startDate = String(range?.startDate || "");
    const endDate = String(range?.endDate || range?.startDate || "");
    return startDate && endDate && dateIso >= startDate && dateIso <= endDate;
  });
  return holiday?.reason || holiday?.name || null;
}
function addDaysToIso(dateIso, days) {
  const date = /* @__PURE__ */ new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalDateIso$1(date);
}
function parseCalendarDateInput(dateStr, timezone) {
  const lower = String(dateStr || "").trim().toLowerCase();
  if (!lower) return null;
  if (lower === "today" || lower === "сегодня") {
    return dateFromIso$1(getDateIsoInTimezone(/* @__PURE__ */ new Date(), timezone));
  }
  if (lower === "tomorrow" || lower === "завтра") {
    return dateFromIso$1(addDaysToIso(getDateIsoInTimezone(/* @__PURE__ */ new Date(), timezone), 1));
  }
  const isoMatch = lower.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return dateFromIso$1(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);
  }
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
function parseCalendarTime(timeStr) {
  if (/^\d{2}:\d{2}$/.test(timeStr)) return timeStr;
  if (/^\d{1}:\d{2}$/.test(timeStr)) return `0${timeStr}`;
  const match = String(timeStr || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}
function formatDateForDisplay(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}
function formatTimeForDisplay(time) {
  return time;
}
function getNowPartsInTimezone$1(timezone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(/* @__PURE__ */ new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return {
    dateIso: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute"))
  };
}
function getDayOfWeekInTimezone(dateIso, timezone) {
  const date = /* @__PURE__ */ new Date(`${dateIso}T12:00:00`);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" });
  const dayName = formatter.format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayName] ?? 0;
}
function formatDateInTimezone(dateIso, timezone) {
  const date = dateFromIso$1(dateIso);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: timezone
  });
}
function getCalendarPromptHint(settings) {
  if (!settings) return null;
  const timezone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const workingDays = Array.isArray(settings.workingDays) && settings.workingDays.length ? settings.workingDays : [1, 2, 3, 4, 5];
  const holidayDates = getHolidayDates(settings);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const workingDaysSummary = [...workingDays].sort((a, b) => a - b).map((d) => dayNames[d]).join(", ");
  const todayIso = getDateIsoInTimezone(/* @__PURE__ */ new Date(), timezone);
  const tomorrowIso = addDaysToIso(todayIso, 1);
  const tomorrowDay = getDayOfWeekInTimezone(tomorrowIso, timezone);
  const tomorrowIsWorking = workingDays.includes(tomorrowDay) && !holidayDates.includes(tomorrowIso);
  let nextWorkingDayLabel = "";
  let cursorIso = tomorrowIso;
  for (let i = 0; i < 14; i++) {
    const dayOfWeek = getDayOfWeekInTimezone(cursorIso, timezone);
    if (workingDays.includes(dayOfWeek) && !holidayDates.includes(cursorIso)) {
      nextWorkingDayLabel = formatDateInTimezone(cursorIso, timezone);
      break;
    }
    cursorIso = addDaysToIso(cursorIso, 1);
  }
  let holidayRangesSummary = "";
  if (Array.isArray(settings.holidayRanges) && settings.holidayRanges.length > 0) {
    holidayRangesSummary = settings.holidayRanges.map((range) => {
      const start = String(range?.startDate || "").trim();
      const end = String(range?.endDate || range?.startDate || "").trim();
      if (!start || !end) return null;
      const label = start === end ? formatDateInTimezone(start, timezone) : `${formatDateInTimezone(start, timezone)} – ${formatDateInTimezone(end, timezone)}`;
      const reason = range?.reason || range?.name || "Closed";
      return `${label}: ${reason}`;
    }).filter(Boolean).join("\n");
  }
  return {
    workingDaysSummary,
    todayLabel: formatDateInTimezone(todayIso, timezone),
    tomorrowLabel: formatDateInTimezone(tomorrowIso, timezone),
    tomorrowIsWorking,
    nextWorkingDayLabel,
    holidayRangesSummary
  };
}
function isPastSlotInTimezone(date, time, timezone) {
  const dateIso = toLocalDateIso$1(date);
  const now = getNowPartsInTimezone$1(timezone);
  if (dateIso < now.dateIso) return true;
  if (dateIso > now.dateIso) return false;
  const slotMinutes = timeToMinutes$1(time);
  const nowMinutes = now.hour * 60 + now.minute;
  return slotMinutes <= nowMinutes;
}
function isDateBeforeTodayInTimezone(date, timezone) {
  return toLocalDateIso$1(date) < getNowPartsInTimezone$1(timezone).dateIso;
}
async function getCalendarBookingsStore(db) {
  return readAllFromStore(db, "calendarBookings");
}
function buildAllSlotsForDate(date, settings) {
  const dateIso = toLocalDateIso$1(date);
  const dayOfWeek = date.getDay();
  if (!settings.workingDays?.includes(dayOfWeek)) {
    return { dateIso, allSlots: [] };
  }
  if (getHolidayDates(settings).includes(dateIso)) {
    return { dateIso, allSlots: [] };
  }
  const startMinutes = timeToMinutes$1(settings.workingHoursStart || "09:00");
  const endMinutes = timeToMinutes$1(settings.workingHoursEnd || "18:00");
  const duration = settings.slotDuration || 30;
  const buffer = settings.bufferBetweenSlots || 0;
  const breaks = settings.breakTimes || [];
  const allSlots = [];
  for (let minutes = startMinutes; minutes + duration <= endMinutes; minutes += duration + buffer) {
    const slotStart = minutesToTime(minutes);
    const slotEndMinutes = minutes + duration;
    const overlapsBreak = breaks.some((breakTime) => {
      const breakStart = timeToMinutes$1(breakTime.start);
      const breakEnd = timeToMinutes$1(breakTime.end);
      return minutes < breakEnd && slotEndMinutes > breakStart;
    });
    if (!overlapsBreak) {
      allSlots.push(slotStart);
    }
  }
  return { dateIso, allSlots };
}
async function buildAvailableSlotsForDate(db, date, settings) {
  const timezone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { dateIso, allSlots } = buildAllSlotsForDate(date, settings);
  if (allSlots.length === 0) {
    return { dateIso, slots: [], allSlots: [], bookedTimes: [] };
  }
  const bookings = await getCalendarBookingsStore(db);
  const activeDayBookings = bookings.filter((booking) => {
    return toLocalDateIso$1(booking.date) === dateIso && booking.status !== "cancelled";
  });
  if (settings.maxBookingsPerDay && activeDayBookings.length >= settings.maxBookingsPerDay) {
    return { dateIso, slots: [], allSlots: [], bookedTimes: activeDayBookings.map((b) => b.startTime) };
  }
  const bookedTimes = activeDayBookings.map((booking) => booking.startTime);
  let slots = allSlots.filter((slot) => !bookedTimes.includes(slot));
  if (dateIso === getNowPartsInTimezone$1(timezone).dateIso) {
    slots = slots.filter((slot) => !isPastSlotInTimezone(date, slot, timezone));
  }
  return { dateIso, slots, allSlots, bookedTimes };
}
function normalizePhoneSuffix(phone) {
  return String(phone || "").replace(/\D/g, "").slice(-9);
}
function describeBookingResources(resources) {
  if (!Array.isArray(resources) || resources.length === 0) return "";
  return resources.map((resource) => `${resource.typeName}: ${resource.itemName}`).join(", ");
}
function sortCalendarBookings(bookings) {
  return [...bookings].sort((left, right) => {
    const leftKey = `${toLocalDateIso$1(left.date)} ${left.startTime || ""}`;
    const rightKey = `${toLocalDateIso$1(right.date)} ${right.startTime || ""}`;
    return leftKey.localeCompare(rightKey);
  });
}
function formatCalendarBookingLine(booking) {
  const dateLabel = toLocalDateIso$1(booking.date);
  const baseParts = [
    `${dateLabel} ${booking.startTime || "--:--"}-${booking.endTime || "--:--"}`,
    booking.contactName || "Unknown customer",
    booking.contactPhone || "no phone",
    booking.status || "unknown"
  ];
  const service = booking.service ? `service: ${booking.service}` : "";
  const resources = describeBookingResources(booking.resources);
  return [
    baseParts.join(" | "),
    service,
    resources ? `resources: ${resources}` : ""
  ].filter(Boolean).join(" | ");
}
function getCalendarResourceTypes(settings) {
  return Array.isArray(settings.resourceTypes) ? settings.resourceTypes : [];
}
function getCalendarResourceItems(settings) {
  return Array.isArray(settings.resourceItems) ? settings.resourceItems : [];
}
function resolveSelectedResources(settings, args) {
  const resources = [];
  const resourceTypes = getCalendarResourceTypes(settings);
  const resourceItems = getCalendarResourceItems(settings);
  for (const resourceType of resourceTypes) {
    const selectedItemId = args[resourceType.variable];
    if (!selectedItemId) continue;
    const item = resourceItems.find((resourceItem) => resourceItem.id === selectedItemId && resourceItem.typeId === resourceType.id);
    if (!item) continue;
    resources.push({
      typeId: resourceType.id,
      typeName: resourceType.name,
      itemId: item.id,
      itemName: item.name
    });
  }
  return resources;
}
async function getAvailableResourcesForSlotData(db, settings, date, time, service) {
  const dateIso = toLocalDateIso$1(date);
  const bookings = await getCalendarBookingsStore(db);
  const activeBookingsAtSlot = bookings.filter((booking) => {
    return toLocalDateIso$1(booking.date) === dateIso && booking.startTime === time && booking.status !== "cancelled";
  });
  const bookedItemIds = /* @__PURE__ */ new Set();
  for (const booking of activeBookingsAtSlot) {
    for (const resource of booking.resources || []) {
      bookedItemIds.add(resource.itemId);
    }
  }
  const resourcesByVariable = {};
  for (const resourceType of getCalendarResourceTypes(settings)) {
    const items = getCalendarResourceItems(settings).filter((item) => item.typeId === resourceType.id && item.isActive).filter((item) => !bookedItemIds.has(item.id)).filter((item) => !service || !Array.isArray(item.services) || item.services.length === 0 || item.services.includes(service));
    resourcesByVariable[resourceType.variable] = items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description
    }));
  }
  return resourcesByVariable;
}
async function handleCalendarCheckAvailability(args) {
  let db = null;
  try {
    const settings = await getCalendarSettings();
    if (!settings) {
      return { success: false, message: "Calendar settings are not available. Please open CRM first." };
    }
    const timezone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = parseCalendarDateInput(args.date, timezone);
    if (!date) {
      return { success: false, message: 'Invalid date format. Please use YYYY-MM-DD or "today"/"tomorrow".' };
    }
    if (isDateBeforeTodayInTimezone(date, timezone)) {
      return {
        success: false,
        message: `Cannot check availability for a past date. Today in business timezone is ${getNowPartsInTimezone$1(timezone).dateIso}.`
      };
    }
    db = await openCrmDb();
    const availability = await buildAvailableSlotsForDate(db, date, settings);
    const displayDate = formatDateForDisplay(date);
    if (availability.slots.length === 0) {
      const holidayReason = getHolidayReasonForDate(settings, availability.dateIso);
      return {
        success: true,
        message: holidayReason ? `No available slots for ${displayDate} because we are closed for "${holidayReason}".` : `No available slots for ${displayDate}. This day may be a non-working day, holiday, break window, or fully booked.`,
        data: { date: availability.dateIso, slots: [], holidayReason: holidayReason || void 0 }
      };
    }
    return {
      success: true,
      message: `Available slots for ${displayDate}: ${availability.slots.map(formatTimeForDisplay).join(", ")}`,
      data: {
        date: availability.dateIso,
        slots: availability.slots.map((slot) => ({ time: slot, display: formatTimeForDisplay(slot) }))
      }
    };
  } catch (err) {
    console.error("[crm-db] handleCalendarCheckAvailability error:", err);
    return { success: false, message: "Error checking availability. Please try again." };
  } finally {
    db?.close();
  }
}
async function handleCalendarGetAvailableResources(args) {
  let db = null;
  try {
    const settings = await getCalendarSettings();
    if (!settings?.resourcesEnabled) {
      return { success: false, message: "Resources are not enabled for this calendar." };
    }
    const timezone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = parseCalendarDateInput(args.date, timezone);
    const time = parseCalendarTime(args.time);
    if (!date || !time) {
      return { success: false, message: "Invalid date or time format." };
    }
    if (isDateBeforeTodayInTimezone(date, timezone)) {
      return {
        success: false,
        message: `Cannot check resources for a past date. Today in business timezone is ${getNowPartsInTimezone$1(timezone).dateIso}.`
      };
    }
    db = await openCrmDb();
    const availability = await buildAvailableSlotsForDate(db, date, settings);
    if (!availability.slots.includes(time)) {
      return {
        success: true,
        message: `The slot ${formatTimeForDisplay(time)} on ${formatDateForDisplay(date)} is not available.`,
        data: {}
      };
    }
    const resources = await getAvailableResourcesForSlotData(db, settings, date, time, args.service);
    const resourceTypes = getCalendarResourceTypes(settings);
    const lines = resourceTypes.map((resourceType) => {
      const items = resources[resourceType.variable] || [];
      return `${resourceType.name}: ${items.length ? items.map((item) => item.name).join(", ") : "None available"}`;
    });
    return {
      success: true,
      message: `Available resources for ${formatTimeForDisplay(time)} on ${formatDateForDisplay(date)}:
${lines.join("\n")}`,
      data: resources
    };
  } catch (err) {
    console.error("[crm-db] handleCalendarGetAvailableResources error:", err);
    return { success: false, message: "Error getting available resources." };
  } finally {
    db?.close();
  }
}
async function handleCalendarBookAppointment(args) {
  let db = null;
  try {
    const settings = await getCalendarSettings();
    if (!settings) {
      return { success: false, message: "Calendar settings are not available. Please open CRM first." };
    }
    const timezone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = parseCalendarDateInput(args.date, timezone);
    const time = parseCalendarTime(args.time);
    if (!date || !time) {
      return { success: false, message: "Invalid date or time format." };
    }
    if (isDateBeforeTodayInTimezone(date, timezone)) {
      return {
        success: false,
        message: `Cannot book a past date. Today in business timezone is ${getNowPartsInTimezone$1(timezone).dateIso}.`
      };
    }
    if (isPastSlotInTimezone(date, time, timezone)) {
      return { success: false, message: "Cannot book a slot in the past." };
    }
    db = await openCrmDb();
    const availability = await buildAvailableSlotsForDate(db, date, settings);
    if (!availability.slots.includes(time)) {
      return {
        success: false,
        message: `The slot ${formatTimeForDisplay(time)} on ${formatDateForDisplay(date)} is not available.`
      };
    }
    const selectedResources = resolveSelectedResources(settings, args);
    for (const resourceType of getCalendarResourceTypes(settings)) {
      if (resourceType.required && !selectedResources.some((resource) => resource.typeId === resourceType.id)) {
        return { success: false, message: `${resourceType.name} selection is required for booking.` };
      }
    }
    if (settings.resourcesEnabled && selectedResources.length > 0) {
      const availableResources = await getAvailableResourcesForSlotData(db, settings, date, time, args.service);
      for (const resource of selectedResources) {
        const variable = getCalendarResourceTypes(settings).find((type) => type.id === resource.typeId)?.variable;
        const choices = variable ? availableResources[variable] || [] : [];
        if (!choices.some((choice) => choice.id === resource.itemId)) {
          return { success: false, message: `${resource.itemName} is not available at ${formatTimeForDisplay(time)}.` };
        }
      }
    }
    const startMinutes = timeToMinutes$1(time);
    const endTime = minutesToTime(startMinutes + (settings.slotDuration || 30));
    const now = /* @__PURE__ */ new Date();
    const bookingId = await addToStore(db, "calendarBookings", {
      contactPhone: args.customer_phone,
      contactName: args.customer_name,
      date,
      startTime: time,
      endTime,
      status: "pending",
      source: "ai",
      service: args.service,
      resources: selectedResources.length > 0 ? selectedResources : void 0,
      createdAt: now,
      updatedAt: now
    });
    const savedBooking = await getFromStore(db, "calendarBookings", bookingId);
    if (!savedBooking) {
      return {
        success: false,
        message: "Booking could not be verified after saving. Please try again."
      };
    }
    return {
      success: true,
      message: `Booking confirmed for ${args.customer_name} on ${formatDateForDisplay(date)} at ${formatTimeForDisplay(time)}.`,
      data: {
        bookingId,
        date: availability.dateIso,
        time,
        endTime,
        customerName: args.customer_name,
        customerPhone: args.customer_phone,
        service: args.service,
        resources: selectedResources
      }
    };
  } catch (err) {
    console.error("[crm-db] handleCalendarBookAppointment error:", err);
    return { success: false, message: "Error creating booking. Please try again." };
  } finally {
    db?.close();
  }
}
async function handleCalendarGetBookingInfo(args) {
  try {
    const bookings = await getContactBookings(args.customer_phone);
    if (!bookings.length) {
      return {
        success: true,
        message: `No bookings found for ${args.customer_phone}.`,
        data: { bookings: [] }
      };
    }
    const lines = bookings.slice(0, 5).map((booking) => {
      const date = new Date(booking.date);
      return `${formatDateForDisplay(date)} ${booking.startTime} (${booking.status})`;
    });
    return {
      success: true,
      message: `Bookings for ${args.customer_phone}:
${lines.join("\n")}`,
      data: { bookings }
    };
  } catch (err) {
    console.error("[crm-db] handleCalendarGetBookingInfo error:", err);
    return { success: false, message: "Error getting booking information." };
  }
}
async function handleCalendarListBookingsForDate(args) {
  let db = null;
  try {
    const settings = await getCalendarSettings();
    if (!settings) {
      return { success: false, message: "Calendar settings are not available. Please open CRM first." };
    }
    const timezone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = parseCalendarDateInput(args.date, timezone);
    if (!date) {
      return { success: false, message: "Invalid date format." };
    }
    const dateIso = toLocalDateIso$1(date);
    db = await openCrmDb();
    const bookings = await getCalendarBookingsStore(db);
    const includeCancelled = !!args.include_cancelled;
    const dayBookings = sortCalendarBookings(
      bookings.filter((booking) => {
        if (toLocalDateIso$1(booking.date) !== dateIso) return false;
        if (!includeCancelled && booking.status === "cancelled") return false;
        return true;
      })
    );
    if (dayBookings.length === 0) {
      const holidayReason = getHolidayReasonForDate(settings, dateIso);
      return {
        success: true,
        message: holidayReason ? `No bookings found for ${formatDateForDisplay(date)}. The calendar is closed for "${holidayReason}".` : `No bookings found for ${formatDateForDisplay(date)}.`,
        data: { date: dateIso, bookings: [] }
      };
    }
    return {
      success: true,
      message: `Bookings for ${formatDateForDisplay(date)}:
${dayBookings.map(formatCalendarBookingLine).join("\n")}`,
      data: { date: dateIso, bookings: dayBookings }
    };
  } catch (err) {
    console.error("[crm-db] handleCalendarListBookingsForDate error:", err);
    return { success: false, message: "Error listing bookings for date." };
  } finally {
    db?.close();
  }
}
async function handleCalendarListBookingsForRange(args) {
  let db = null;
  try {
    const settings = await getCalendarSettings();
    if (!settings) {
      return { success: false, message: "Calendar settings are not available. Please open CRM first." };
    }
    const timezone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const startDate = parseCalendarDateInput(args.start_date, timezone);
    const endDate = parseCalendarDateInput(args.end_date, timezone);
    if (!startDate || !endDate) {
      return { success: false, message: "Invalid start or end date format." };
    }
    const startIso = toLocalDateIso$1(startDate);
    const endIso = toLocalDateIso$1(endDate);
    const rangeStart = startIso <= endIso ? startIso : endIso;
    const rangeEnd = startIso <= endIso ? endIso : startIso;
    db = await openCrmDb();
    const bookings = await getCalendarBookingsStore(db);
    const includeCancelled = !!args.include_cancelled;
    const rangeBookings = sortCalendarBookings(
      bookings.filter((booking) => {
        const bookingDateIso = toLocalDateIso$1(booking.date);
        if (bookingDateIso < rangeStart || bookingDateIso > rangeEnd) return false;
        if (!includeCancelled && booking.status === "cancelled") return false;
        return true;
      })
    );
    if (rangeBookings.length === 0) {
      return {
        success: true,
        message: `No bookings found from ${rangeStart} to ${rangeEnd}.`,
        data: { startDate: rangeStart, endDate: rangeEnd, bookings: [] }
      };
    }
    return {
      success: true,
      message: `Bookings from ${rangeStart} to ${rangeEnd}:
${rangeBookings.map(formatCalendarBookingLine).join("\n")}`,
      data: { startDate: rangeStart, endDate: rangeEnd, bookings: rangeBookings }
    };
  } catch (err) {
    console.error("[crm-db] handleCalendarListBookingsForRange error:", err);
    return { success: false, message: "Error listing bookings for range." };
  } finally {
    db?.close();
  }
}
async function handleCalendarCancelBooking(args) {
  let db = null;
  try {
    const settings = await getCalendarSettings();
    if (!settings) {
      return { success: false, message: "Calendar settings are not available. Please open CRM first." };
    }
    const timezone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = parseCalendarDateInput(args.date, timezone);
    const time = args.time ? parseCalendarTime(args.time) : void 0;
    if (!date) {
      return { success: false, message: "Invalid date format." };
    }
    const phoneSuffix = normalizePhoneSuffix(args.customer_phone);
    db = await openCrmDb();
    const bookings = await getCalendarBookingsStore(db);
    const dateIso = toLocalDateIso$1(date);
    const targetBooking = bookings.find((booking) => {
      if (booking.status === "cancelled") return false;
      if (toLocalDateIso$1(booking.date) !== dateIso) return false;
      if (normalizePhoneSuffix(booking.contactPhone) !== phoneSuffix) return false;
      if (time) return booking.startTime === time;
      return true;
    });
    if (!targetBooking) {
      return {
        success: false,
        message: `No booking found for ${args.customer_phone} on ${formatDateForDisplay(date)}${time ? ` at ${time}` : ""}.`
      };
    }
    await putToStore(db, "calendarBookings", {
      ...targetBooking,
      status: "cancelled",
      updatedAt: /* @__PURE__ */ new Date()
    });
    return {
      success: true,
      message: `Booking cancelled for ${formatDateForDisplay(date)}${targetBooking.startTime ? ` at ${targetBooking.startTime}` : ""}.`,
      data: { bookingId: targetBooking.id }
    };
  } catch (err) {
    console.error("[crm-db] handleCalendarCancelBooking error:", err);
    return { success: false, message: "Error cancelling booking." };
  } finally {
    db?.close();
  }
}
async function handleCalendarRescheduleBooking(args) {
  let db = null;
  try {
    const settings = await getCalendarSettings();
    if (!settings) {
      return { success: false, message: "Calendar settings are not available. Please open CRM first." };
    }
    const timezone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const currentDate = parseCalendarDateInput(args.current_date, timezone);
    const currentTime = args.current_time ? parseCalendarTime(args.current_time) : void 0;
    const newDate = parseCalendarDateInput(args.new_date, timezone);
    const newTime = parseCalendarTime(args.new_time);
    if (!currentDate || !newDate || !newTime) {
      return { success: false, message: "Invalid current or new date/time format." };
    }
    if (isDateBeforeTodayInTimezone(newDate, timezone) || isPastSlotInTimezone(newDate, newTime, timezone)) {
      return { success: false, message: "Cannot move a booking to a past date or past time slot." };
    }
    const phoneSuffix = normalizePhoneSuffix(args.customer_phone);
    const currentDateIso = toLocalDateIso$1(currentDate);
    const newDateIso = toLocalDateIso$1(newDate);
    db = await openCrmDb();
    const bookings = await getCalendarBookingsStore(db);
    const targetBooking = bookings.find((booking) => {
      if (booking.status === "cancelled") return false;
      if (toLocalDateIso$1(booking.date) !== currentDateIso) return false;
      if (normalizePhoneSuffix(booking.contactPhone) !== phoneSuffix) return false;
      if (currentTime) return booking.startTime === currentTime;
      return true;
    });
    if (!targetBooking) {
      return {
        success: false,
        message: `No active booking found for ${args.customer_phone} on ${formatDateForDisplay(currentDate)}${currentTime ? ` at ${currentTime}` : ""}.`
      };
    }
    if (currentDateIso === newDateIso && targetBooking.startTime === newTime) {
      return {
        success: true,
        message: `This booking is already scheduled for ${formatDateForDisplay(newDate)} at ${formatTimeForDisplay(newTime)}.`,
        data: { bookingId: targetBooking.id }
      };
    }
    const ruleBasedAvailability = buildAllSlotsForDate(newDate, settings);
    if (!ruleBasedAvailability.allSlots.includes(newTime)) {
      return {
        success: false,
        message: `The slot ${formatTimeForDisplay(newTime)} on ${formatDateForDisplay(newDate)} is outside working hours, blocked by break time, holiday, or business rules.`
      };
    }
    const activeNewDayBookings = bookings.filter((booking) => {
      if (booking.id === targetBooking.id || booking.status === "cancelled") return false;
      return toLocalDateIso$1(booking.date) === newDateIso;
    });
    if (settings.maxBookingsPerDay && activeNewDayBookings.length >= settings.maxBookingsPerDay) {
      return {
        success: false,
        message: `Cannot move the booking to ${formatDateForDisplay(newDate)} because the maximum bookings limit for that day has already been reached.`
      };
    }
    const conflictingBooking = bookings.find((booking) => {
      if (booking.id === targetBooking.id || booking.status === "cancelled") return false;
      return toLocalDateIso$1(booking.date) === newDateIso && booking.startTime === newTime;
    });
    if (conflictingBooking) {
      return {
        success: false,
        message: `The slot ${formatTimeForDisplay(newTime)} on ${formatDateForDisplay(newDate)} is already occupied.`
      };
    }
    const targetResourceIds = new Set(
      Array.isArray(targetBooking.resources) ? targetBooking.resources.map((resource) => resource.itemId).filter(Boolean) : []
    );
    if (targetResourceIds.size > 0) {
      const resourceConflict = bookings.find((booking) => {
        if (booking.id === targetBooking.id || booking.status === "cancelled") return false;
        if (toLocalDateIso$1(booking.date) !== newDateIso || booking.startTime !== newTime) return false;
        return Array.isArray(booking.resources) && booking.resources.some((resource) => targetResourceIds.has(resource.itemId));
      });
      if (resourceConflict) {
        return {
          success: false,
          message: `The current assigned resource is not available at ${formatTimeForDisplay(newTime)} on ${formatDateForDisplay(newDate)}.`
        };
      }
    }
    const updatedBooking = {
      ...targetBooking,
      date: newDate,
      startTime: newTime,
      endTime: minutesToTime(timeToMinutes$1(newTime) + (settings.slotDuration || 30)),
      updatedAt: /* @__PURE__ */ new Date()
    };
    await putToStore(db, "calendarBookings", updatedBooking);
    return {
      success: true,
      message: `Booking moved for ${targetBooking.contactName} from ${formatDateForDisplay(currentDate)} ${targetBooking.startTime} to ${formatDateForDisplay(newDate)} ${formatTimeForDisplay(newTime)}.`,
      data: {
        bookingId: targetBooking.id,
        customerName: targetBooking.contactName,
        customerPhone: targetBooking.contactPhone,
        oldDate: currentDateIso,
        oldTime: targetBooking.startTime,
        newDate: newDateIso,
        newTime
      }
    };
  } catch (err) {
    console.error("[crm-db] handleCalendarRescheduleBooking error:", err);
    return { success: false, message: "Error rescheduling booking." };
  } finally {
    db?.close();
  }
}
async function handleCalendarChangeBookingResource(args) {
  let db = null;
  try {
    const settings = await getCalendarSettings();
    if (!settings) {
      return { success: false, message: "Calendar settings are not available. Please open CRM first." };
    }
    if (!settings.resourcesEnabled || !getCalendarResourceTypes(settings).length) {
      return { success: false, message: "Resources are not enabled for this calendar." };
    }
    const timezone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = parseCalendarDateInput(args.date, timezone);
    const time = args.time ? parseCalendarTime(args.time) : void 0;
    if (!date) {
      return { success: false, message: "Invalid date format." };
    }
    const argVar = (args.resource_type_variable || "").trim().toLowerCase();
    const norm = (s) => (s || "").toLowerCase().trim().replace(/\s+/g, " ");
    let resourceType = getCalendarResourceTypes(settings).find(
      (t) => (t.variable || "").toLowerCase() === argVar
    );
    if (!resourceType && argVar) {
      resourceType = getCalendarResourceTypes(settings).find(
        (t) => norm(t.name) === norm(argVar)
      );
    }
    if (!resourceType) {
      return {
        success: false,
        message: `Unknown resource type "${args.resource_type_variable}". Use the variable from get_available_resources response keys, or the resource type name (e.g. Satış departamenti).`
      };
    }
    const resourceItems = getCalendarResourceItems(settings);
    const newItem = resourceItems.find(
      (item) => item.id === args.new_resource_item_id && item.typeId === resourceType.id && item.isActive
    );
    if (!newItem) {
      return {
        success: false,
        message: `Resource item "${args.new_resource_item_id}" not found or not active for type ${resourceType.name}. Use get_available_resources for that slot to get valid item ids.`
      };
    }
    const phoneSuffix = normalizePhoneSuffix(args.customer_phone);
    const dateIso = toLocalDateIso$1(date);
    db = await openCrmDb();
    const bookings = await getCalendarBookingsStore(db);
    const targetBooking = bookings.find((booking) => {
      if (booking.status === "cancelled") return false;
      if (toLocalDateIso$1(booking.date) !== dateIso) return false;
      if (normalizePhoneSuffix(booking.contactPhone) !== phoneSuffix) return false;
      if (time) return booking.startTime === time;
      return true;
    });
    if (!targetBooking) {
      return {
        success: false,
        message: `No active booking found for ${args.customer_phone} on ${formatDateForDisplay(date)}${time ? ` at ${time}` : ""}.`
      };
    }
    const currentResources = Array.isArray(targetBooking.resources) ? targetBooking.resources : [];
    const otherTypeResources = currentResources.filter((r) => r.typeId !== resourceType.id);
    const currentOfType = currentResources.find((r) => r.typeId === resourceType.id);
    if (!currentOfType) {
      return {
        success: false,
        message: `This booking does not have a ${resourceType.name} assigned. Cannot change.`
      };
    }
    if (currentOfType.itemId === args.new_resource_item_id) {
      return {
        success: true,
        message: `Booking already has ${newItem.name} (${resourceType.name}) assigned.`,
        data: { bookingId: targetBooking.id }
      };
    }
    const alreadyBookedAtSlot = bookings.some((booking) => {
      if (booking.id === targetBooking.id || booking.status === "cancelled") return false;
      if (toLocalDateIso$1(booking.date) !== dateIso || booking.startTime !== (targetBooking.startTime || time)) return false;
      return Array.isArray(booking.resources) && booking.resources.some((r) => r.itemId === args.new_resource_item_id);
    });
    if (alreadyBookedAtSlot) {
      return {
        success: false,
        message: `${newItem.name} is already assigned to another booking at ${formatTimeForDisplay(targetBooking.startTime)} on ${formatDateForDisplay(date)}.`
      };
    }
    const newResourceEntry = {
      typeId: resourceType.id,
      typeName: resourceType.name,
      itemId: newItem.id,
      itemName: newItem.name
    };
    const updatedResources = [...otherTypeResources, newResourceEntry];
    const updatedBooking = {
      ...targetBooking,
      resources: updatedResources,
      updatedAt: /* @__PURE__ */ new Date()
    };
    await putToStore(db, "calendarBookings", updatedBooking);
    return {
      success: true,
      message: `Booking updated: ${resourceType.name} changed from ${currentOfType.itemName} to ${newItem.name} for ${formatDateForDisplay(date)} at ${formatTimeForDisplay(targetBooking.startTime)}.`,
      data: { bookingId: targetBooking.id, resources: updatedResources }
    };
  } catch (err) {
    console.error("[crm-db] handleCalendarChangeBookingResource error:", err);
    return { success: false, message: "Error changing booking resource." };
  } finally {
    db?.close();
  }
}
async function executeCalendarTool(toolName, args) {
  switch (toolName) {
    case "check_availability":
      return handleCalendarCheckAvailability(args);
    case "book_appointment":
      return handleCalendarBookAppointment(args);
    case "get_available_resources":
      return handleCalendarGetAvailableResources(args);
    case "cancel_booking":
      return handleCalendarCancelBooking(args);
    case "get_booking_info":
      return handleCalendarGetBookingInfo(args);
    case "list_bookings_for_date":
      return handleCalendarListBookingsForDate(args);
    case "list_bookings_for_range":
      return handleCalendarListBookingsForRange(args);
    case "reschedule_booking":
      return handleCalendarRescheduleBooking(args);
    case "change_booking_resource":
      return handleCalendarChangeBookingResource(args);
    default:
      return { success: false, message: `Unknown calendar tool: ${toolName}` };
  }
}
async function getContactBookings(contactPhone) {
  let db = null;
  try {
    db = await openCrmDb();
    const phoneSuffix = contactPhone.replace(/[\s\-\(\)\+]/g, "").slice(-9);
    const allBookings = await readAllFromStore(db, "calendarBookings");
    db.close();
    return allBookings.filter((b) => {
      const bSuffix = (b.contactPhone || "").replace(/\D/g, "").slice(-9);
      return bSuffix === phoneSuffix;
    }).map((b) => ({
      id: b.id,
      date: b.date instanceof Date ? b.date.toISOString() : String(b.date),
      startTime: b.startTime,
      endTime: b.endTime,
      status: b.status,
      notes: b.notes || "",
      source: b.source,
      contactName: b.contactName
    })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (err) {
    console.error("[crm-db] getContactBookings error:", err);
    db?.close();
    return [];
  }
}
async function getCalendarSettings() {
  let db = null;
  try {
    db = await openCrmDb();
    if (!db.objectStoreNames.contains("calendarSettings")) {
      db.close();
      return null;
    }
    const tx = db.transaction("calendarSettings", "readonly");
    const store = tx.objectStore("calendarSettings");
    const result = await new Promise((resolve, reject) => {
      const req = store.get("calendar-settings");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch (err) {
    console.error("[crm-db] getCalendarSettings error:", err);
    db?.close();
    return null;
  }
}
async function getAvailableSlots(dateStr) {
  try {
    const settings = await getCalendarSettings();
    if (!settings) return [];
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    if (!settings.workingDays?.includes(dayOfWeek)) return [];
    const dateISO = date.toISOString().split("T")[0];
    if (getHolidayDates(settings).includes(dateISO)) return [];
    const startMinutes = timeToMinutes$1(settings.workingHoursStart || "09:00");
    const endMinutes = timeToMinutes$1(settings.workingHoursEnd || "18:00");
    const duration = settings.slotDuration || 30;
    const buffer = settings.bufferBetweenSlots || 0;
    const breaks = settings.breakTimes || [];
    const slots = [];
    for (let m = startMinutes; m + duration <= endMinutes; m += duration + buffer) {
      const slotStart = minutesToTime(m);
      const slotEnd = minutesToTime(m + duration);
      const inBreak = breaks.some((br) => {
        const brStart = timeToMinutes$1(br.start);
        const brEnd = timeToMinutes$1(br.end);
        return m < brEnd && m + duration > brStart;
      });
      if (!inBreak) slots.push(slotStart);
    }
    let db = null;
    try {
      db = await openCrmDb();
      const allBookings = await readAllFromStore(db, "calendarBookings");
      db.close();
      const bookedTimes = allBookings.filter((b) => {
        const bDate = b.date instanceof Date ? b.date.toISOString().split("T")[0] : String(b.date).split("T")[0];
        return bDate === dateISO && b.status !== "cancelled";
      }).map((b) => b.startTime);
      return slots.filter((s) => !bookedTimes.includes(s));
    } catch {
      return slots;
    }
  } catch (err) {
    console.error("[crm-db] getAvailableSlots error:", err);
    return [];
  }
}
function timeToMinutes$1(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
async function createQuickBooking(data) {
  let db = null;
  try {
    db = await openCrmDb();
    const now = /* @__PURE__ */ new Date();
    const id = await addToStore(db, "calendarBookings", {
      contactPhone: data.contactPhone,
      contactName: data.contactName,
      date: new Date(data.date),
      startTime: data.startTime,
      endTime: data.endTime,
      status: "confirmed",
      source: "manual",
      createdAt: now,
      updatedAt: now
    });
    db.close();
    return id;
  } catch (err) {
    console.error("[crm-db] createQuickBooking error:", err);
    db?.close();
    return null;
  }
}
async function getActiveFlows() {
  let db = null;
  try {
    db = await openCrmDb();
    const allFlows = await readAllFromStore(db, "flows");
    db.close();
    return allFlows.filter((f) => f.isActive).map((f) => ({ id: f.id, name: f.name, description: f.description || "" }));
  } catch (err) {
    console.error("[crm-db] getActiveFlows error:", err);
    db?.close();
    return [];
  }
}
async function createFlowExecution(flowId, contactId, contactName) {
  let db = null;
  try {
    db = await openCrmDb();
    const now = /* @__PURE__ */ new Date();
    const id = await addToStore(db, "flowExecutions", {
      flowId,
      contactId,
      contactName,
      status: "pending",
      currentStepIndex: 0,
      startedAt: now,
      log: []
    });
    db.close();
    return id;
  } catch (err) {
    console.error("[crm-db] createFlowExecution error:", err);
    db?.close();
    return null;
  }
}
async function createFlow(params) {
  const {
    name,
    messageTemplate,
    description = "",
    goal = "",
    triggerType = "event",
    triggerEventType = "contact_added",
    moduleId,
    moduleEventId,
    waitBeforeMessage,
    isActive = true
  } = params;
  if (!name || !messageTemplate) {
    return { error: "name and messageTemplate are required" };
  }
  if (triggerType === "module_event" && (!moduleId || !moduleEventId)) {
    return { error: "module_event trigger requires moduleId and moduleEventId" };
  }
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const now = /* @__PURE__ */ new Date();
  const trigger = triggerType === "module_event" && moduleId && moduleEventId ? { type: "module_event", moduleId, moduleEventId } : { type: "event", eventType: triggerEventType };
  const steps = [];
  if (waitBeforeMessage && waitBeforeMessage.duration > 0) {
    steps.push({
      id: "step_wait",
      type: "wait",
      waitDuration: waitBeforeMessage.duration,
      waitUnit: waitBeforeMessage.unit
    });
  }
  steps.push({
    id: steps.length ? "step_message" : "step1",
    type: "send_message",
    messageTemplate: String(messageTemplate).trim()
  });
  const flow = {
    id,
    name: String(name).trim(),
    description: String(description).trim(),
    goal: String(goal).trim(),
    isActive: !!isActive,
    enabled: !!isActive,
    trigger,
    steps,
    createdAt: now,
    updatedAt: now,
    stats: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 }
  };
  let db = null;
  try {
    db = await openCrmDb();
    await putToStore(db, "flows", flow);
    db.close();
    return { id };
  } catch (err) {
    console.error("[crm-db] createFlow error:", err);
    db?.close();
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
async function getAccountOwnerContact() {
  let db = null;
  try {
    db = await openCrmDb();
    const storeNames = Array.from(db.objectStoreNames);
    if (!storeNames.includes("accountSettings")) {
      db.close();
      return null;
    }
    const allSettings = await readAllFromStore(db, "accountSettings");
    const settings = allSettings.find((s) => s.id === "account-settings");
    if (!settings?.ownerContactId) {
      db.close();
      return null;
    }
    const ownerContactId = settings.ownerContactId;
    const allContacts = await readAllFromStore(db, "contacts");
    db.close();
    const contact = allContacts.find((c) => c.id === ownerContactId);
    if (!contact) return null;
    return { ownerContactId, ownerPhone: contact.phoneNumber, ownerName: contact.name };
  } catch (err) {
    console.error("[crm-db] getAccountOwnerContact error:", err);
    db?.close();
    return null;
  }
}
async function createCampaign(params) {
  const { name, messageTemplate, campaignGoal, recipientPhones = [], recipientNames = [] } = params;
  const phones = /* @__PURE__ */ new Set();
  for (const p of recipientPhones) {
    const normalized = p.replace(/\D/g, "").trim();
    if (normalized.length >= 9) phones.add(normalized.slice(-9));
  }
  const owner = await getAccountOwnerContact();
  let db = null;
  try {
    db = await openCrmDb();
    const contacts = await readAllFromStore(db, "contacts");
    for (const n of recipientNames) {
      const nameNorm = (n || "").trim().toLowerCase();
      if (nameNorm === "myself" && owner?.ownerPhone) {
        const suffix = owner.ownerPhone.replace(/\D/g, "").slice(-9);
        if (suffix.length >= 9) phones.add(suffix);
        continue;
      }
      const contact = contacts.find(
        (c) => c.name && c.name.trim().toLowerCase().includes(nameNorm) || c.phoneNumber && c.phoneNumber.replace(/\D/g, "").slice(-9) === nameNorm.replace(/\D/g, "").slice(-9)
      );
      if (contact?.phoneNumber) {
        const suffix = contact.phoneNumber.replace(/\D/g, "").slice(-9);
        if (suffix.length >= 9) phones.add(suffix);
      }
    }
    const recipientList = [];
    for (const suffix of phones) {
      const contact = contacts.find((c) => c.phoneNumber && c.phoneNumber.replace(/\D/g, "").slice(-9) === suffix);
      const phoneNumber = contact?.phoneNumber || (suffix.length === 9 ? `+994${suffix}` : suffix);
      recipientList.push({
        phoneNumber,
        name: contact?.name || void 0,
        status: "pending",
        variables: { name: contact?.name || phoneNumber }
      });
    }
    const now = /* @__PURE__ */ new Date();
    const campaign = {
      name,
      status: "draft",
      messageTemplate,
      recipients: recipientList,
      settings: {
        minDelay: 2e3,
        maxDelay: 6e3,
        pauseAfterMessages: 0,
        pauseDuration: 0,
        stopOnError: false,
        skipExisting: false,
        gptSystemMessage: campaignGoal || void 0
      },
      campaignGoal: campaignGoal || void 0,
      stats: { total: recipientList.length, sent: 0, failed: 0, pending: recipientList.length },
      createdAt: now,
      updatedAt: now,
      workspaceId: "default"
    };
    const id = await addToStore(db, "campaigns", campaign);
    db.close();
    return { id };
  } catch (err) {
    console.error("[crm-db] createCampaign error:", err);
    db?.close();
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
async function startCampaignByIdOrName(params) {
  const { id, name } = params;
  let db = null;
  try {
    db = await openCrmDb();
    const campaigns = await readAllFromStore(db, "campaigns");
    let campaign = id != null ? campaigns.find((c) => Number(c.id) === Number(id)) : null;
    if (!campaign && name != null && String(name).trim()) {
      const nameNorm = String(name).trim().toLowerCase();
      campaign = campaigns.find((c) => c.name && String(c.name).trim().toLowerCase() === nameNorm && (c.status === "draft" || c.status === "scheduled"));
      if (!campaign) campaign = campaigns.find((c) => c.name && String(c.name).trim().toLowerCase().includes(nameNorm) && (c.status === "draft" || c.status === "scheduled"));
    }
    if (!campaign) {
      db.close();
      return { error: id != null ? "Campaign not found" : "No draft campaign found with that name" };
    }
    const now = /* @__PURE__ */ new Date();
    const updated = {
      ...campaign,
      status: "running",
      startedAt: now,
      updatedAt: now,
      stats: campaign.stats ? { ...campaign.stats } : { total: 0, sent: 0, failed: 0, pending: 0 }
    };
    await putToStore(db, "campaigns", updated);
    db.close();
    return { campaign: updated };
  } catch (err) {
    console.error("[crm-db] startCampaignByIdOrName error:", err);
    db?.close();
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
async function updateCampaignRecipientStatus(campaignId, phoneNumber, status, errorMessage) {
  let db = null;
  try {
    db = await openCrmDb();
    const campaigns = await readAllFromStore(db, "campaigns");
    const campaign = campaigns.find((c) => Number(c.id) === Number(campaignId));
    if (!campaign || !campaign.recipients) return;
    const suffix = phoneNumber.replace(/\D/g, "").slice(-9);
    const recipients = campaign.recipients.map((r) => {
      const rSuffix = (r.phoneNumber || "").replace(/\D/g, "").slice(-9);
      if (rSuffix !== suffix) return r;
      return { ...r, status, sentAt: status === "sent" ? /* @__PURE__ */ new Date() : void 0, errorMessage: status === "failed" ? errorMessage : void 0 };
    });
    const sent = recipients.filter((r) => r.status === "sent").length;
    const failed = recipients.filter((r) => r.status === "failed").length;
    const pending = recipients.filter((r) => r.status === "pending").length;
    await putToStore(db, "campaigns", { ...campaign, recipients, updatedAt: /* @__PURE__ */ new Date(), stats: { total: recipients.length, sent, failed, pending } });
  } finally {
    db?.close();
  }
}
async function getCampaignById(campaignId) {
  let db = null;
  try {
    db = await openCrmDb();
    const campaigns = await readAllFromStore(db, "campaigns");
    const campaign = campaigns.find((c) => Number(c.id) === Number(campaignId));
    return campaign ? { name: campaign.name || "Campaign", stats: campaign.stats } : null;
  } catch (err) {
    console.error("[crm-db] getCampaignById error:", err);
    return null;
  } finally {
    db?.close();
  }
}
async function getAIAgents() {
  let db = null;
  try {
    db = await openCrmDb();
    const agents = await readAllFromStore(db, "aiAgents");
    db.close();
    return agents.filter((a) => a.isActive).map((a) => ({
      id: a.id,
      agentId: a.agentId,
      name: a.name,
      description: a.description || "",
      icon: a.icon || "Bot",
      isDefault: a.isDefault
    }));
  } catch (err) {
    console.error("[crm-db] getAIAgents error:", err);
    db?.close();
    return [];
  }
}

function notifyCrmContactChanged(contactAdded = null) {
  chrome.runtime.sendMessage({ type: "CRM_CONTACTS_CHANGED", contactAdded }).catch(() => {
  });
}
function notifyCalendarBookingsChanged() {
  chrome.runtime.sendMessage({ type: "CALENDAR_BOOKINGS_CHANGED" }).catch(() => {
  });
}
const APP_NOTIFICATION_FEED_KEY = "appNotificationFeed";
const APP_FEED_MAX = 50;
async function pushToAppNotificationFeed(type, title, message) {
  try {
    const result = await chrome.storage.local.get([APP_NOTIFICATION_FEED_KEY]);
    const feed = result[APP_NOTIFICATION_FEED_KEY] || [];
    const id = `${type}-${Date.now()}`;
    const next = [...feed, { id, type, title, message, timestamp: Date.now() }].slice(-APP_FEED_MAX);
    await chrome.storage.local.set({ [APP_NOTIFICATION_FEED_KEY]: next });
  } catch (e) {
    console.warn("[Background] pushToAppNotificationFeed failed:", e);
  }
}
function normalizeDateValue(v) {
  if (typeof v !== "string") return v;
  const ddmmyyyy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
  const ddmmyyyyHhmm = /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/;
  let m = v.trim().match(ddmmyyyyHhmm);
  if (m) {
    const [, d, mo, y, h, min, sec = "00"] = m;
    const pad = (x) => x.padStart(2, "0");
    return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(min)}:${pad(sec)}`;
  }
  m = v.trim().match(ddmmyyyy);
  if (m) {
    const [, d, mo, y] = m;
    const pad = (x) => x.padStart(2, "0");
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return v;
}
function normalizeObjectDates(obj) {
  const out = {};
  for (const [k, val] of Object.entries(obj)) {
    out[k] = normalizeDateValue(val);
  }
  return out;
}
const createContactPendingKeys = /* @__PURE__ */ new Set();
const createContactPending = /* @__PURE__ */ new Map();
const createContactPendingResolve = /* @__PURE__ */ new Map();
const pendingInventoryResults = /* @__PURE__ */ new Map();
// Account, workspace and usage data used to come from a cloud API. The same routes are now
// served locally by local-backend.js (see DownlabsLocal), with no limits and no sign-in.
async function getValidToken() {
  const profile = await DownlabsLocal.ensureLocalProfile();
  return profile.accessToken;
}
async function fetchAndCacheUsage() {
  await DownlabsLocal.refreshRealtimeUsage();
}
DownlabsLocal.ensureLocalProfile().then(() => DownlabsLocal.refreshRealtimeUsage()).catch((e) => {
  console.warn("[Background] Local profile init failed:", e);
});
chrome.runtime.onInstalled.addListener((details) => {
  // First install opens the welcome page (license.js).
  if (details.reason === "install") {
    // AI auto-replies stay off until the user switches them on (popup, sidebar or AI settings).
    chrome.storage.local.get(["aiConfig"]).then(({ aiConfig }) => {
      if (!aiConfig || aiConfig.enabled === undefined) chrome.storage.local.set({ aiConfig: { ...(aiConfig || {}), enabled: false } });
    }).catch(() => {});
  }
  chrome.storage.local.remove([
    "messageLogQuickStats",
    "cachedUsage",
    "summaryUsage",
    "dailyStats",
    "limitExceeded",
    "pendingMessageSyncs",
    "extensionUpdateAvailable",
    "extensionLatestVersion",
    "extensionLastCheckAt"
  ]);
});
async function findWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  return tabs[0] || null;
}
const STORAGE_PREFER_WA_STORAGE_QUEUE = "whatsappOutboundPreferStorageQueue";
async function preferWhatsAppOutboundStorageQueue() {
  try {
    const data = await chrome.storage.local.get(STORAGE_PREFER_WA_STORAGE_QUEUE);
    return data[STORAGE_PREFER_WA_STORAGE_QUEUE] === true;
  } catch {
    return false;
  }
}
async function sendStorageBackedWhatsAppMessage(phoneNumber, content, source = "direct") {
  const tab = await findWhatsAppTab();
  if (!tab || !tab.id) {
    return { success: false, error: "WhatsApp Web not open" };
  }
  const storageFirst = await preferWhatsAppOutboundStorageQueue();
  if (!storageFirst) {
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "SEND_MESSAGE_DIRECT",
        payload: {
          phoneNumber,
          content,
          skipTracking: source === "calendar_notification"
        }
      });
      return result && typeof result.success === "boolean" ? result : { success: false, error: "Invalid response" };
    } catch {
    }
  }
  const requestId = "cal_" + Date.now() + "_" + Math.random().toString(36).substring(7);
  await chrome.storage.local.set({
    messageRequest: {
      phoneNumber,
      content,
      requestId,
      timestamp: Date.now(),
      source,
      skipTracking: source === "calendar_notification"
    }
  });
  const startTime = Date.now();
  return await new Promise((resolve) => {
    const pollInterval = setInterval(async () => {
      const data = await chrome.storage.local.get("messageResult");
      const result = data.messageResult;
      if (result && result.requestId === requestId) {
        clearInterval(pollInterval);
        await chrome.storage.local.remove("messageResult");
        resolve(result.result || { success: false, error: "Unknown message result" });
      } else if (Date.now() - startTime > 3e4) {
        clearInterval(pollInterval);
        await chrome.storage.local.remove("messageRequest");
        resolve({ success: false, error: "Timeout waiting for WhatsApp to send message" });
      }
    }, 500);
  });
}
function toLocalDateIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function dateFromIso(dateIso) {
  return /* @__PURE__ */ new Date(`${dateIso}T00:00:00`);
}
function timeToMinutes(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}
function getNowPartsInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(/* @__PURE__ */ new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return {
    dateIso: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute"))
  };
}
function renderCalendarNotificationTemplate(template, booking, settings) {
  const bookingDateIso = toLocalDateIso(booking.date);
  const bookingDate = bookingDateIso ? dateFromIso(bookingDateIso) : null;
  const dateText = bookingDate && !Number.isNaN(bookingDate.getTime()) ? bookingDate.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }) : bookingDateIso;
  return template.replace(/\{name\}/gi, booking.contactName || "there").replace(/\{phone\}/gi, booking.contactPhone || "").replace(/\{date\}/gi, dateText || "").replace(/\{time\}/gi, booking.startTime || "").replace(/\{endTime\}/gi, booking.endTime || "").replace(/\{service\}/gi, booking.service || "appointment").replace(/\{business\}/gi, settings?.businessName || "our office").replace(/\{address\}/gi, settings?.businessAddress || "");
}
async function putRecordInStore(db, storeName, record) {
  await new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        reject(new Error(`Store ${storeName} does not exist`));
        return;
      }
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`Failed to put record into ${storeName}`));
    } catch (error) {
      reject(error);
    }
  });
}
function getCalendarMinutesUntilBooking(booking, timezone) {
  const bookingDateIso = toLocalDateIso(booking?.date);
  if (!bookingDateIso || !booking?.startTime) return Number.NaN;
  const now = getNowPartsInTimezone(timezone);
  const dayDiff = Math.round((dateFromIso(bookingDateIso).getTime() - dateFromIso(now.dateIso).getTime()) / 864e5);
  const bookingMinutes = timeToMinutes(booking.startTime);
  const nowMinutes = now.hour * 60 + now.minute;
  return dayDiff * 1440 + bookingMinutes - nowMinutes;
}
async function processCalendarNotificationsInBackground() {
  let db = null;
  try {
    const settings = await getCalendarSettings();
    if (!settings?.reminderEnabled && !settings?.confirmationEnabled) {
      return;
    }
    const timezone = settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const reminderBeforeMinutes = Number(settings?.reminderBeforeMinutes || 60);
    const confirmationBeforeMinutes = Number(settings?.confirmationBeforeMinutes || 1440);
    const reminderTemplate = settings?.reminderTemplate || "Hi {name}! 👋 This is a reminder about your appointment at {business} on {date} at {time}. See you soon!";
    const confirmationTemplate = settings?.confirmationTemplate || "Hi {name}! You have an appointment at {business} on {date} at {time}. Is everything still good? Please reply *Yes* to confirm or *No* to cancel.";
    db = await openCrmDb();
    const allBookings = await readAllFromStore(db, "calendarBookings");
    let remindersSent = 0;
    let confirmationsSent = 0;
    for (const booking of allBookings) {
      if (!booking?.id) continue;
      if (!["pending", "confirmed"].includes(String(booking.status || ""))) continue;
      if (!booking.contactPhone) continue;
      const minutesUntilBooking = getCalendarMinutesUntilBooking(booking, timezone);
      if (!Number.isFinite(minutesUntilBooking) || minutesUntilBooking <= 0) continue;
      const shouldSendConfirmation = !!settings?.confirmationEnabled && !!confirmationBeforeMinutes && !booking.confirmationSent && minutesUntilBooking <= confirmationBeforeMinutes && minutesUntilBooking > reminderBeforeMinutes;
      if (shouldSendConfirmation) {
        const message = renderCalendarNotificationTemplate(confirmationTemplate, booking, settings);
        const sendResult = await sendStorageBackedWhatsAppMessage(
          booking.contactPhone,
          message,
          "calendar_notification"
        );
        if (sendResult.success) {
          await putRecordInStore(db, "calendarBookings", {
            ...booking,
            confirmationSent: true,
            confirmationSentAt: /* @__PURE__ */ new Date(),
            updatedAt: /* @__PURE__ */ new Date()
          });
          confirmationsSent++;
        } else {
          console.warn("[Background] Calendar confirmation failed:", booking.id, sendResult.error);
        }
      }
      const shouldSendReminder = !!settings?.reminderEnabled && !!reminderBeforeMinutes && !booking.reminderSent && minutesUntilBooking <= reminderBeforeMinutes && minutesUntilBooking > 0;
      if (shouldSendReminder) {
        const message = renderCalendarNotificationTemplate(reminderTemplate, booking, settings);
        const sendResult = await sendStorageBackedWhatsAppMessage(
          booking.contactPhone,
          message,
          "calendar_notification"
        );
        if (sendResult.success) {
          await putRecordInStore(db, "calendarBookings", {
            ...booking,
            reminderSent: true,
            reminderSentAt: /* @__PURE__ */ new Date(),
            updatedAt: /* @__PURE__ */ new Date()
          });
          remindersSent++;
        } else {
          console.warn("[Background] Calendar reminder failed:", booking.id, sendResult.error);
        }
      }
    }
    if (remindersSent > 0 || confirmationsSent > 0) {
      console.log(
        "[Background] Calendar notifications sent:",
        `${remindersSent} reminder(s), ${confirmationsSent} confirmation(s)`
      );
      notifyCalendarBookingsChanged();
    }
  } catch (error) {
    console.warn("[Background] Calendar notification scheduler error:", error);
  } finally {
    db?.close();
  }
}
function renderCalendarOwnerNotificationTemplate(template, booking, settings) {
  const bookingDate = booking.date ? /* @__PURE__ */ new Date(`${booking.date}T00:00:00`) : null;
  const dateText = bookingDate && !Number.isNaN(bookingDate.getTime()) ? bookingDate.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }) : booking.date || "";
  return template.replace(/\{name\}/gi, booking.contactName || "there").replace(/\{phone\}/gi, booking.contactPhone || "").replace(/\{date\}/gi, dateText).replace(/\{time\}/gi, booking.startTime || "").replace(/\{endTime\}/gi, booking.endTime || "").replace(/\{service\}/gi, booking.service || "appointment").replace(/\{business\}/gi, settings?.businessName || "our office").replace(/\{address\}/gi, settings?.businessAddress || "").replace(/\{source\}/gi, booking.source || "ai");
}
function getCalendarOwnerNotificationRecipients(settings, resources = []) {
  const selectedResourceIds = new Set(
    (Array.isArray(resources) ? resources : []).map((resource) => resource?.itemId).filter(Boolean)
  );
  const additionalPhones = (Array.isArray(settings?.resourceItems) ? settings.resourceItems : []).filter((item) => selectedResourceIds.has(item?.id)).map((item) => String(item?.notificationPhone || "").trim()).filter(Boolean);
  return Array.from(
    new Set(
      [String(settings?.ownerPhone || "").trim(), ...additionalPhones].map((phone) => phone.trim()).filter(Boolean)
    )
  );
}
async function notifyOwnerAboutCalendarToolBooking(args, result) {
  try {
    const settings = await getCalendarSettings();
    if (!settings?.ownerNotifyEnabled || !settings.ownerPhone) return;
    const template = settings.ownerNotifyTemplate || `📅 New booking!

Client: {name}
Phone: {phone}
Date: {date}
Time: {time}

Source: {source}`;
    const message = renderCalendarOwnerNotificationTemplate(
      template,
      {
        contactName: args?.customer_name,
        contactPhone: args?.customer_phone,
        date: result?.data?.date || args?.date,
        startTime: result?.data?.time || args?.time,
        endTime: result?.data?.endTime,
        service: args?.service,
        source: "ai"
      },
      settings
    );
    const recipients = getCalendarOwnerNotificationRecipients(settings, result?.data?.resources);
    for (const phone of recipients) {
      const sendResult = await sendStorageBackedWhatsAppMessage(
        phone,
        message,
        "calendar_notification"
      );
      if (!sendResult.success) {
        console.warn("[Background] Calendar owner notification failed:", phone, sendResult.error);
      } else {
        console.log("[Background] ✅ Calendar owner notification sent:", phone);
      }
    }
  } catch (error) {
    console.warn("[Background] Calendar owner notification error:", error);
  }
}
const MESSAGE_LOGS_KEY = "smartdm_message_logs";
const API_BASE_URL = DownlabsLocal.API_BASE;
// AI requests go directly from this browser to the provider chosen in Settings (ai-providers.js).
async function proxyOpenAIChatCompletion(body) {
  return DownlabsAI.chatCompletion(body);
}
async function proxyOpenAITranscription(formData) {
  return DownlabsAI.transcribe(formData);
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "PING":
      sendResponse({ success: true, message: "PONG" });
      break;
    case "SMARTDM_CREATE_BASIC_NOTIFICATION": {
      const p = message.payload;
      if (!p?.notificationId || !p?.title || !p?.message) {
        sendResponse({ success: false, error: "invalid payload" });
        break;
      }
      if (!chrome.notifications?.create) {
        sendResponse({ success: false, error: "notifications unavailable" });
        break;
      }
      const clearAfter = typeof p.clearAfterMs === "number" ? p.clearAfterMs : 1e4;
      chrome.notifications.create(
        p.notificationId,
        {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: p.title,
          message: p.message,
          contextMessage: p.contextMessage,
          priority: 2,
          requireInteraction: false
        },
        () => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse({ success: true });
          setTimeout(() => {
            chrome.notifications.clear(p.notificationId, () => {
            });
          }, clearAfter);
        }
      );
      return true;
    }
    case "GET_TOUR_COMPLETED":
      chrome.storage.local.get(["sdmWebWhatsAppTourCompleted"], (result) => {
        const value = result?.sdmWebWhatsAppTourCompleted;
        sendResponse({ completed: value === true || value === "true" });
      });
      return true;
    case "SET_TOUR_COMPLETED":
      chrome.storage.local.set({ sdmWebWhatsAppTourCompleted: true }, () => {
        sendResponse({ success: !chrome.runtime.lastError });
      });
      return true;
    case "CHECK_EXTENSION_UPDATE":
      sendResponse({ success: true });
      break;
    case "OPEN_EXTENSIONS_PAGE":
      chrome.tabs.create({ url: "chrome://extensions" });
      sendResponse({ success: true });
      break;
    case "SYNC_DATA":
      sendResponse({ success: true });
      break;
    case "FETCH_USAGE":
      (async () => {
        try {
          await fetchAndCacheUsage();
          const data = await chrome.storage.local.get(["realtimeUsage"]);
          sendResponse({ success: true, usage: data.realtimeUsage });
        } catch (error) {
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "REFRESH_WORKSPACE":
      DownlabsLocal.ensureLocalProfile().then((profile) => sendResponse({ success: true, workspace: profile.workspace })).catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;
    case "WHATSAPP_PHONE_DETECTED":
      if (message.phone && typeof message.phone === "string") {
        (async () => {
          await chrome.storage.local.set({ currentWhatsappPhone: message.phone });
          await DownlabsLocal.linkWhatsappPhone(message.phone);
          sendResponse({ success: true });
        })();
      } else {
        sendResponse({ success: false });
      }
      return true;
    case "GET_WHATSAPP_PHONE":
      chrome.storage.local.get(["currentWhatsappPhone"], (result) => {
        sendResponse({ phone: result?.currentWhatsappPhone ?? null });
      });
      return true;
    case "CHECK_CRM_TAB_OPEN":
      (async () => {
        try {
          const base = chrome.runtime.getURL("crm/index.html");
          const baseCrm = chrome.runtime.getURL("crm/");
          const tabs = await chrome.tabs.query({});
          const crmTab = tabs.find((t) => {
            const u = t.url || "";
            return u.startsWith(base) || u.startsWith(baseCrm);
          });
          const open = !!crmTab?.id;
          if (open) console.log("[Background] CHECK_CRM_TAB_OPEN: CRM tab found", crmTab.url?.slice(0, 60));
          else console.log("[Background] CHECK_CRM_TAB_OPEN: no CRM tab, checked", tabs.length, "tabs, base:", base.slice(0, 50));
          sendResponse({ crmTabOpen: open });
        } catch (e) {
          console.warn("[Background] CHECK_CRM_TAB_OPEN error:", e);
          sendResponse({ crmTabOpen: false });
        }
      })();
      return true;
    case "GET_WHATSAPP_WORKSPACE_MODAL_STATE":
      // The local workspace is linked to the detected WhatsApp number automatically.
      sendResponse({ show: false, phone: null, workspaceName: null });
      break;
    case "CREATE_WORKSPACE_WITH_WHATSAPP_PHONE":
    case "LINK_WHATSAPP_PHONE_TO_WORKSPACE":
      (async () => {
        const { currentWhatsappPhone } = await chrome.storage.local.get(["currentWhatsappPhone"]);
        if (!currentWhatsappPhone) {
          sendResponse({ success: false, error: "WhatsApp phone not detected. Open WhatsApp Web and refresh." });
          return;
        }
        const workspace = await DownlabsLocal.linkWhatsappPhone(currentWhatsappPhone);
        await chrome.storage.local.set({ hasSeenWhatsAppWorkspaceModal: true });
        sendResponse({ success: true, workspace });
      })();
      return true;
    case "OPENAI_CHAT_COMPLETION":
      (async () => {
        const result = await proxyOpenAIChatCompletion(message.payload);
        if (result.ok) {
          sendResponse({ ok: true, httpStatus: result.httpStatus, data: result.data });
        } else {
          sendResponse({
            ok: false,
            httpStatus: result.httpStatus,
            data: result.data,
            error: result.error
          });
        }
      })();
      return true;
    case "TRANSLATE_TEXT":
      (async () => {
        try {
          const { text, targetLang } = message.payload || {};
          if (!text || !targetLang) {
            sendResponse({ success: false, error: "Missing text or targetLang" });
            return;
          }
          const langNames = {
            en: "English",
            ru: "Russian",
            az: "Azerbaijani",
            tr: "Turkish",
            ar: "Arabic",
            pt: "Portuguese",
            es: "Spanish",
            fr: "French",
            de: "German",
            it: "Italian",
            zh: "Chinese",
            ja: "Japanese",
            ko: "Korean",
            hi: "Hindi",
            uk: "Ukrainian",
            pl: "Polish",
            nl: "Dutch",
            id: "Indonesian",
            vi: "Vietnamese",
            th: "Thai"
          };
          const langName = langNames[targetLang] || targetLang;
          const proxyResult = await proxyOpenAIChatCompletion({
            model: "gpt-4o-mini",
            temperature: 0.1,
            max_completion_tokens: 1e3,
            messages: [
              {
                role: "system",
                content: `You are a professional translator. Translate the given text to ${langName}. Rules:
- Return ONLY the translated text, nothing else.
- Preserve the original tone and meaning.
- Do NOT add quotation marks, explanations, or notes.
- Do NOT include timestamps or metadata.
- If the text is already in ${langName}, return it as-is.`
              },
              {
                role: "user",
                content: text
              }
            ]
          });
          if (!proxyResult.ok) {
            console.error("[Background] TRANSLATE_TEXT OpenAI error:", proxyResult.error);
            sendResponse({ success: false, error: proxyResult.error });
            return;
          }
          const data = proxyResult.data;
          const translated = data?.choices?.[0]?.message?.content?.trim() || "";
          if (!translated) {
            sendResponse({ success: false, error: "Empty translation response" });
            return;
          }
          sendResponse({ success: true, translated, detectedLang: "auto" });
        } catch (error) {
          console.error("[Background] TRANSLATE_TEXT error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "LOG_MESSAGE":
      (async () => {
        try {
          const entry = message.payload;
          if (!entry || !entry.phoneNumber) {
            sendResponse({ success: false, error: "Invalid log entry" });
            return;
          }
          console.log("[Background] 📊 LOG_MESSAGE:", entry.direction, entry.type, entry.phoneNumber);
          const result = await chrome.storage.local.get([MESSAGE_LOGS_KEY]);
          const logs = result[MESSAGE_LOGS_KEY] || [];
          logs.push(entry);
          if (logs.length > 1e4) {
            logs.splice(0, logs.length - 1e4);
          }
          await chrome.storage.local.set({ [MESSAGE_LOGS_KEY]: logs });
          console.log("[Background] ✅ Message logged locally");
          await DownlabsLocal.recordMessage(entry);
          sendResponse({ success: true });
        } catch (error) {
          console.error("[Background] ❌ LOG_MESSAGE error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "GET_MESSAGE_LOGS":
      (async () => {
        try {
          const { period } = message.payload || {};
          const result = await chrome.storage.local.get([MESSAGE_LOGS_KEY]);
          let logs = result[MESSAGE_LOGS_KEY] || [];
          if (period) {
            const now = /* @__PURE__ */ new Date();
            let startDate = null;
            switch (period) {
              case "today":
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
              case "7days":
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1e3);
                break;
              case "30days":
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1e3);
                break;
            }
            if (startDate) {
              logs = logs.filter((l) => new Date(l.timestamp) >= startDate);
            }
          }
          sendResponse({ success: true, logs });
        } catch (error) {
          console.error("[Background] ❌ GET_MESSAGE_LOGS error:", error);
          sendResponse({ success: false, error: String(error), logs: [] });
        }
      })();
      return true;
    case "GET_QUICK_STATS":
      (async () => {
        try {
          const result = await chrome.storage.local.get(["realtimeUsage"]);
          const ru = result.realtimeUsage || {};
          const stats = {
            totalOutgoing: ru.messagesSent || 0,
            totalIncoming: 0,
            todayOutgoing: ru.messagesSent || 0,
            todayIncoming: 0,
            lastUpdated: ru.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
          };
          sendResponse({ success: true, stats });
        } catch (error) {
          console.error("[Background] ❌ GET_QUICK_STATS error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "GET_AUTH_TOKEN":
      (async () => {
        const token = await getValidToken();
        sendResponse({ token });
      })();
      return true;
    case "OPEN_BULK_SENDER":
      chrome.tabs.create({ url: chrome.runtime.getURL("crm/index.html#/bulk-sender") });
      sendResponse({ success: true });
      break;
    case "OPEN_LOGIN":
    case "OPEN_SETTINGS":
      chrome.runtime.openOptionsPage();
      sendResponse({ success: true });
      break;
    case "AUTH_SYNCED":
      sendResponse({ success: true });
      break;
    case "ACTIVATE_WHATSAPP_TAB":
      (async () => {
        try {
          const waTab = await findWhatsAppTab();
          if (!waTab?.id) {
            sendResponse({ success: false });
            return;
          }
          let previousTabId;
          let previousWindowId;
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (activeTab?.id && activeTab.id !== waTab.id) {
              previousTabId = activeTab.id;
              previousWindowId = activeTab.windowId;
            }
          } catch {
          }
          if (waTab.windowId) await chrome.windows.update(waTab.windowId, { focused: true });
          await chrome.tabs.update(waTab.id, { active: true });
          await new Promise((r) => setTimeout(r, 400));
          sendResponse({ success: true, previousTabId, previousWindowId });
        } catch {
          sendResponse({ success: false });
        }
      })();
      return true;
    case "RESTORE_PREVIOUS_TAB":
      (async () => {
        try {
          const { tabId, windowId } = message;
          if (windowId) await chrome.windows.update(windowId, { focused: true });
          if (tabId) await chrome.tabs.update(tabId, { active: true });
          sendResponse({ success: true });
        } catch {
          sendResponse({ success: false });
        }
      })();
      return true;
    case "OPEN_CRM":
      try {
        const crmPath = message.path ? `crm/index.html#${message.path}` : "crm/index.html";
        const crmUrl = chrome.runtime.getURL(crmPath);
        console.log("[Background] Opening CRM:", crmUrl);
        chrome.tabs.create({ url: crmUrl });
        sendResponse({ success: true });
      } catch (err) {
        console.error("[Background] OPEN_CRM error:", err);
        sendResponse({ success: false, error: String(err) });
      }
      break;
    case "EXECUTE_INVENTORY_ACTION":
      if (message.requestId) {
        return false;
      }
      {
        const requestId = "inv_" + Date.now() + "_" + Math.random().toString(36).slice(2);
        (async () => {
          try {
            const base = chrome.runtime.getURL("crm/index.html");
            const tabs = await chrome.tabs.query({});
            const crmTab = tabs.find((t) => t.url?.startsWith(base));
            if (!crmTab?.id) {
              sendResponse({ success: false, message: "CRM is not open. Please open CRM → Inventory to perform this action." });
              return;
            }
            const payload = message.payload || {};
            const resultPromise = new Promise((resolve) => {
              pendingInventoryResults.set(requestId, resolve);
            });
            chrome.runtime.sendMessage({ type: "INVENTORY_EXECUTE_ACTION", requestId, payload }).catch(() => {
            });
            const result = await Promise.race([
              resultPromise,
              new Promise(
                (resolve) => setTimeout(() => {
                  pendingInventoryResults.delete(requestId);
                  resolve({ success: false, message: "CRM did not respond in time. Please try again." });
                }, 15e3)
              )
            ]);
            sendResponse(result ?? { success: false, message: "No response from CRM" });
          } catch (err) {
            pendingInventoryResults.delete(requestId);
            console.warn("[Background] EXECUTE_INVENTORY_ACTION error:", err);
            sendResponse({
              success: false,
              message: "CRM is not open or did not respond. Please open CRM → Inventory and try again."
            });
          }
        })();
        return true;
      }
    case "INVENTORY_ACTION_RESULT":
      if (message.requestId && pendingInventoryResults.has(message.requestId)) {
        pendingInventoryResults.get(message.requestId)(message.result);
        pendingInventoryResults.delete(message.requestId);
      }
      return false;
    case "SEND_SCHEDULED_MESSAGE":
      WAMLicense.gate("scheduled", sendResponse, async (sendResponse) => {
        try {
          const tab = await findWhatsAppTab();
          if (!tab || !tab.id) {
            sendResponse({ success: false, error: "WhatsApp Web not open" });
            return;
          }
          const storageFirst = await preferWhatsAppOutboundStorageQueue();
          if (!storageFirst) {
            try {
              const result = await chrome.tabs.sendMessage(tab.id, { type: "SEND_SCHEDULED_MESSAGE", payload: message.payload });
              sendResponse(result ?? { success: false, error: "No response" });
              return;
            } catch {
            }
          }
          const requestId = "req_" + Date.now() + "_" + Math.random();
          await chrome.storage.local.set({ messageRequest: { ...message.payload, requestId, timestamp: Date.now() } });
          const startTime = Date.now();
          const pollInterval = setInterval(async () => {
            const data = await chrome.storage.local.get("messageResult");
            const result = data.messageResult;
            if (result && result.requestId === requestId) {
              clearInterval(pollInterval);
              await chrome.storage.local.remove("messageResult");
              sendResponse(result.result);
            } else if (Date.now() - startTime > 3e4) {
              clearInterval(pollInterval);
              sendResponse({ success: false, error: "Timeout" });
            }
          }, 500);
        } catch (error) {
          sendResponse({ success: false, error: String(error) });
        }
      });
      return true;
    case "SEND_CAMPAIGN_MESSAGE":
      WAMLicense.gate("crm-campaign", sendResponse, async (sendResponse) => {
        try {
          const tab = await findWhatsAppTab();
          if (!tab || !tab.id) {
            sendResponse({ success: false, error: "WhatsApp Web не открыт. Откройте web.whatsapp.com в браузере." });
            return;
          }
          const storageFirst = await preferWhatsAppOutboundStorageQueue();
          if (!storageFirst) {
            try {
              const result = await chrome.tabs.sendMessage(tab.id, { type: "SEND_CAMPAIGN_MESSAGE", payload: message.payload });
              sendResponse(result ?? { success: false, error: "No response" });
              return;
            } catch {
            }
          }
          const requestId = "req_" + Date.now() + "_" + Math.random().toString(36).substring(7);
          await chrome.storage.local.set({ messageRequest: { ...message.payload, requestId, timestamp: Date.now() } });
          const startTime = Date.now();
          const maxPollTime = 35e3;
          const pollInterval = setInterval(async () => {
            const data = await chrome.storage.local.get("messageResult");
            const result = data.messageResult;
            if (result && result.requestId === requestId) {
              clearInterval(pollInterval);
              await chrome.storage.local.remove("messageResult");
              sendResponse(result.result);
            } else if (Date.now() - startTime > maxPollTime) {
              clearInterval(pollInterval);
              await chrome.storage.local.remove("messageRequest");
              sendResponse({ success: false, error: "Таймаут. Обновите страницу WhatsApp Web." });
            }
          }, 500);
        } catch (error) {
          sendResponse({ success: false, error: String(error) });
        }
      });
      return true;
    case "SEND_WHATSAPP_MESSAGE":
      WAMLicense.gate("notification", sendResponse, async (sendResponse) => {
        try {
          const { phone, message: msgText } = message;
          if (!phone || !msgText) {
            sendResponse({ success: false, error: "Missing phone or message" });
            return;
          }
          console.log("[Background] 📅 SEND_WHATSAPP_MESSAGE (calendar notification)");
          console.log("[Background]   - Phone:", phone);
          console.log("[Background]   - Message:", msgText.substring(0, 80) + "...");
          const result = await sendStorageBackedWhatsAppMessage(phone, msgText, "calendar_notification");
          console.log("[Background] ✅ Calendar notification sent:", result?.success);
          sendResponse(result);
        } catch (error) {
          console.error("[Background] ❌ SEND_WHATSAPP_MESSAGE error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      });
      return true;
    case "SAVE_ACTION":
      sendResponse({ success: true });
      break;
    case "GENERATE_AI_REPLY":
      (async () => {
        try {
          const { contactPhone, userMessage, conversationHistory, campaignGoal, token } = message.payload;
          console.log("[Background] 🤖 GENERATE_AI_REPLY request received");
          console.log("[Background]   - Phone:", contactPhone);
          console.log("[Background]   - Message length:", userMessage?.length || 0);
          console.log("[Background]   - Campaign Goal:", campaignGoal || "(none)");
          console.log("[Background]   - Has token:", !!token);
          if (!token) {
            console.error("[Background] ❌ No auth token");
            sendResponse({ success: false, error: "Not authenticated" });
            return;
          }
          const requestBody = {
            contactPhone,
            message: userMessage,
            conversationHistory,
            campaignGoal
          };
          console.log("[Background] 📤 Sending request to API...");
          console.log("[Background] Request body:", JSON.stringify(requestBody).substring(0, 500));
          const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          };
          const response = await fetch(`${API_BASE_URL}/ai/reply`, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody)
          });
          console.log("[Background] 📥 API response status:", response.status);
          if (!response.ok) {
            let errorDetails = "";
            try {
              const errorText = await response.text();
              errorDetails = errorText.substring(0, 500);
              console.error("[Background] ❌ API error response:", errorDetails);
            } catch (e) {
              console.error("[Background] ❌ Could not read error response");
            }
            if (response.status === 429) {
              try {
                const data2 = JSON.parse(errorDetails);
                sendResponse({ success: false, error: "limit_exceeded", used: data2.used, limit: data2.limit });
              } catch {
                sendResponse({ success: false, error: `Rate limit exceeded` });
              }
            } else if (response.status === 502) {
              console.error("[Background] ❌ 502 Bad Gateway - Backend might be down or restarting");
              sendResponse({ success: false, error: `API error: 502 Bad Gateway - Server unavailable. Details: ${errorDetails}` });
            } else {
              sendResponse({ success: false, error: `API error: ${response.status} - ${errorDetails}` });
            }
            return;
          }
          const data = await response.json();
          console.log("[Background] ✅ AI reply received:", data.reply?.substring(0, 100));
          if (data.tokens) {
            console.log(`[Background] 🎯 Token usage: ${data.tokens.prompt} input + ${data.tokens.completion} output = ${data.tokens.total} total`);
          }
          sendResponse({ success: true, reply: data.reply, usage: data.usage, tokens: data.tokens });
        } catch (error) {
          console.error("[Background] ❌ Exception:", error);
          sendResponse({ success: false, error: `Exception: ${String(error)}` });
        }
      })();
      return true;
    case "AI_PREVIEW":
      (async () => {
        try {
          const { message: testMessage, chatbotRole, customPrompt, language, fixedLanguage, conversationHistory, agentId } = message.payload;
          console.log("[Background] 🧪 AI_PREVIEW request, agentId:", agentId || "(default)");
          const result = await chrome.storage.local.get([
            "aiConfig",
            "aiAgents",
            "effectiveSystemPrompt",
            "effectiveSystemPromptIsJson"
          ]);
          const aiConfig = result.aiConfig || {};
          const syncedAgents = result.aiAgents || [];
          const PREVIEW_LEGACY_MODELS = /* @__PURE__ */ new Set(["gpt-4-turbo-preview", "gpt-4o", "gpt-4", "gpt-3.5-turbo"]);
          let model = aiConfig.model || "gpt-4o-mini";
          if (PREVIEW_LEGACY_MODELS.has(model)) model = "gpt-4o-mini";
          let systemPrompt = "";
          let isJsonMode = false;
          let useAgentMode = false;
          const selectedAgent = agentId ? syncedAgents.find((a) => a.agentId === agentId && a.isActive) : null;
          if (selectedAgent && selectedAgent.systemPrompt) {
            systemPrompt = selectedAgent.systemPrompt;
            isJsonMode = false;
            useAgentMode = true;
            console.log("[Background] Using agent prompt:", selectedAgent.name, "| length:", systemPrompt.length);
          } else if (result.effectiveSystemPrompt) {
            systemPrompt = result.effectiveSystemPrompt;
            isJsonMode = result.effectiveSystemPromptIsJson === true && systemPrompt.toLowerCase().includes("json");
            console.log("[Background] Using cached effectiveSystemPrompt, length:", systemPrompt.length, "isJson:", isJsonMode);
          } else {
            const rolePrompts = {
              customer_service: "You are a real person working as a customer service rep. Chat naturally — short replies, warm and professional. ALWAYS reply in the customer's language. No filler questions.",
              sales_representative: "You are a real person working as a sales consultant. Chat naturally — confident, genuine, not pushy. ALWAYS reply in the customer's language. No filler questions.",
              technical_support: "You are a real person working as a tech support specialist. Chat naturally — clear, concise, practical. ALWAYS reply in the customer's language. No filler questions.",
              appointment_scheduler: "You are a real person working as a scheduling coordinator. Chat naturally — efficient and friendly. ALWAYS reply in the customer's language. No unnecessary follow-ups.",
              custom: customPrompt || "You are a helpful assistant. Chat naturally, be concise. ALWAYS reply in the customer's language."
            };
            systemPrompt = rolePrompts[chatbotRole] || rolePrompts.customer_service;
            if (language === "fixed" && fixedLanguage) {
              const langNames = { ru: "Russian", en: "English", az: "Azerbaijani", tr: "Turkish" };
              systemPrompt += `

IMPORTANT: Always respond in ${langNames[fixedLanguage] || fixedLanguage}.`;
            }
            isJsonMode = false;
            console.log("[Background] Using fallback role-based prompt (no cached effectiveSystemPrompt)");
          }
          const messages = [
            { role: "system", content: systemPrompt }
          ];
          if (Array.isArray(conversationHistory)) {
            for (const msg of conversationHistory) {
              messages.push({ role: msg.role, content: msg.content });
            }
          }
          messages.push({ role: "user", content: testMessage });
          const maxTokens = Math.max(2048, typeof aiConfig.maxTokens === "number" && aiConfig.maxTokens > 0 ? aiConfig.maxTokens : 2048);
          const requestBody = {
            model,
            messages,
            temperature: aiConfig.temperature ?? 0.7,
            max_completion_tokens: maxTokens
          };
          if (isJsonMode) {
            requestBody.response_format = { type: "json_object" };
          }
          console.log("[Background] AI_PREVIEW OpenAI request:", { model, msgCount: messages.length, maxTokens, isJsonMode, agent: selectedAgent?.name || "none" });
          const previewProxy = await proxyOpenAIChatCompletion(requestBody);
          if (!previewProxy.ok) {
            console.error("[Background] AI_PREVIEW OpenAI error:", previewProxy.error);
            sendResponse({ success: false, error: previewProxy.error });
            return;
          }
          const data = previewProxy.data;
          const rawContent = data.choices?.[0]?.message?.content?.trim() || "";
          if (!rawContent) {
            const finishReason = data.choices?.[0]?.finish_reason;
            sendResponse({ success: false, error: `Empty response from AI (finish_reason: ${finishReason || "unknown"})` });
            return;
          }
          let reply = rawContent;
          if (isJsonMode) {
            try {
              const parsed = JSON.parse(rawContent);
              reply = parsed.reply || parsed.message || rawContent;
            } catch {
              reply = rawContent;
            }
          }
          console.log("[Background] 🧪 AI_PREVIEW success, reply length:", reply.length);
          sendResponse({ success: true, reply });
        } catch (error) {
          console.error("[Background] AI Preview error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "ADD_INBOUND_CONTACT":
      (async () => {
        try {
          const { phone, name, pushname, tags, source, firstMessage, firstMessageDate } = message.payload;
          console.log("[Background] 🆕 ADD_INBOUND_CONTACT");
          console.log("[Background]   - Phone:", phone);
          console.log("[Background]   - Name:", name);
          console.log("[Background]   - Pushname:", pushname);
          const storageData = await chrome.storage.local.get(["crmContacts"]);
          const contacts = storageData.crmContacts || [];
          const normalizePhone = (p) => p.replace(/[\s\-\(\)\+]/g, "");
          const normalizedPhone = normalizePhone(phone).slice(-9);
          const existingIndex = contacts.findIndex(
            (c) => normalizePhone(c.phone || "").slice(-9) === normalizedPhone
          );
          if (existingIndex >= 0) {
            console.log("[Background] ℹ️ Contact already exists, updating...");
            const existing = contacts[existingIndex];
            const updatedTags = /* @__PURE__ */ new Set([...existing.tags || [], ...tags]);
            contacts[existingIndex] = {
              ...existing,
              tags: Array.from(updatedTags),
              lastInboundMessage: firstMessage,
              lastInboundDate: firstMessageDate
            };
          } else {
            console.log("[Background] ✅ Creating new inbound contact");
            const newContact = {
              id: crypto.randomUUID(),
              phone,
              name,
              pushname,
              tags,
              source,
              status: "new_lead",
              createdAt: Date.now(),
              customFields: {
                firstMessage,
                firstMessageDate,
                pushname
              }
            };
            contacts.push(newContact);
          }
          await chrome.storage.local.set({ crmContacts: contacts });
          const crmTabsRefresh = await chrome.tabs.query({ url: chrome.runtime.getURL("*") });
          for (const tab of crmTabsRefresh) {
            if (tab.id) {
              try {
                await chrome.tabs.sendMessage(tab.id, { type: "CONTACTS_UPDATED" });
              } catch (e) {
              }
            }
          }
          sendResponse({ success: true });
        } catch (error) {
          console.error("[Background] ❌ ADD_INBOUND_CONTACT error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "TRACK_AI_REPLY":
      // Each AI auto-reply is one outgoing message for the free plan's daily limit.
      WAMLicense.consume(1, "ai-reply").then((q) => {
        if (!q.allowed) {
          sendResponse({ success: true, limitExceeded: true, used: q.usedToday, limit: q.dailyLimit, planName: "Free", message: q.message });
          return;
        }
        DownlabsLocal.trackAiReply().catch(() => {});
        sendResponse({ success: true, limitExceeded: false, used: q.usedToday, limit: q.dailyLimit });
      }).catch(() => sendResponse({ success: true, limitExceeded: false }));
      return true;
    case "CHECK_MESSAGE_REPLY_STATUS":
      (async () => {
        try {
          const token = await getValidToken();
          const messageId = message.payload?.messageId;
          if (!token || !messageId) {
            sendResponse({ handled: false });
            return;
          }
          const res = await fetch(
            `${API_BASE_URL}/message-reply-status/check?messageId=${encodeURIComponent(messageId)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!res.ok) {
            sendResponse({ handled: false });
            return;
          }
          const data = await res.json();
          sendResponse({ handled: !!data.handled, status: data.status });
        } catch {
          sendResponse({ handled: false });
        }
      })();
      return true;
    case "RECORD_MESSAGE_REPLY_STATUS":
      (async () => {
        try {
          const token = await getValidToken();
          const { messageId, status, entries } = message.payload || {};
          if (!token) {
            sendResponse({ ok: false });
            return;
          }
          const body = entries?.length ? { entries } : messageId && (status === "replied" || status === "skipped") ? { messageId, status } : null;
          if (!body) {
            sendResponse({ ok: false });
            return;
          }
          const res = await fetch(`${API_BASE_URL}/message-reply-status/record`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(body)
          });
          sendResponse({ ok: res.ok });
        } catch {
          sendResponse({ ok: false });
        }
      })();
      return true;
    case "GET_CONTACT_CRM_DATA":
      (async () => {
        try {
          let { phone } = message.payload || {};
          if (!phone) {
            sendResponse({ contact: null });
            return;
          }
          phone = phone.replace(/@c\.us$|@s\.whatsapp\.net$|@g\.us$/g, "");
          const digits = phone.replace(/\D/g, "");
          if (digits.length >= 9 && !phone.startsWith("+")) {
            phone = "+" + phone;
          }
          console.log("[Background] 📊 Getting CRM data (direct DB) for:", phone);
          let contact = await findContactByPhone(phone);
          if (!contact) {
            const phoneDigits = phone.replace(/\D/g, "");
            if (phoneDigits.length < 9) {
              console.log("[Background] 🔍 Phone looks like a name, searching by name:", phone);
              const db = await openCrmDb();
              try {
                const contacts = await readAllFromStore(db, "contacts");
                contact = contacts.find((c) => c.name === phone);
                if (contact) {
                  console.log("[Background] ✅ Found contact by name:", contact.name, contact.phoneNumber);
                }
              } finally {
                db?.close();
              }
            }
          }
          if (contact) {
            console.log("[Background] ✅ Found contact in DB:", contact.name);
            sendResponse({
              contact: {
                id: contact.id,
                name: contact.name,
                status: contact.status,
                tags: contact.tags,
                notes: contact.notes,
                customFields: contact.customFields,
                customRecordsCount: 0
              }
            });
          } else {
            console.log("[Background] ⚠️ Contact not found for:", phone);
            sendResponse({ contact: null });
          }
        } catch (error) {
          console.error("[Background] ❌ GET_CONTACT_CRM_DATA error:", error);
          sendResponse({ contact: null, error: String(error) });
        }
      })();
      return true;
    case "GET_CONTACT_FULL_DATA":
      (async () => {
        try {
          const { phone, name } = message.payload || {};
          if (!phone && !name) {
            sendResponse({ success: false, data: null });
            return;
          }
          console.log("[Background] 📊 Getting FULL CRM data (raw IDB) for:", phone || name);
          const timeoutPromise = new Promise(
            (_, reject) => setTimeout(() => reject(new Error("getFullContactData timed out after 8s")), 8e3)
          );
          try {
            const data = await Promise.race([
              getFullContactData(phone || "", name),
              timeoutPromise
            ]);
            console.log("[Background] ✅ CRM data result:", data.inCRM ? "found in CRM" : "not in CRM");
            sendResponse({ success: true, data });
          } catch (timeoutErr) {
            console.error("[Background] ⏱️ CRM data timeout/error:", timeoutErr);
            sendResponse({ success: true, data: { contact: null, inCRM: false, messages: [], customRecords: [], campaigns: [], flowExecutions: [], contactFieldsConfig: [] } });
          }
        } catch (error) {
          console.error("[Background] ❌ GET_CONTACT_FULL_DATA error:", error);
          sendResponse({ success: false, data: null, error: String(error) });
        }
      })();
      return true;
    case "FIND_CRM_CONTACT_BY_PHONE":
      (async () => {
        try {
          const phone = message.phone || message.payload?.phone || "";
          if (!phone) {
            sendResponse({ success: false, contact: null });
            return;
          }
          const contact = await findContactByPhone(phone);
          sendResponse({ success: true, contact: contact ?? null });
        } catch (e) {
          sendResponse({ success: false, contact: null });
        }
      })();
      return true;
    case "FIND_CRM_CONTACT_BY_ID":
      (async () => {
        try {
          const id = message.contactId ?? message.payload?.contactId;
          if (id == null) {
            sendResponse({ success: false, contact: null });
            return;
          }
          const contact = await getContactById(Number(id));
          sendResponse({ success: true, contact: contact ?? null });
        } catch (e) {
          sendResponse({ success: false, contact: null });
        }
      })();
      return true;
    case "CREATE_CONTACT":
      (async () => {
        const phoneSuffixKey = (p) => p.replace(/\D/g, "").slice(-9) || p;
        try {
          const { phone, name } = message.payload || {};
          if (!phone) {
            sendResponse({ success: false, error: "No phone provided" });
            return;
          }
          const key = phoneSuffixKey(phone);
          if (createContactPendingKeys.has(key)) {
            const p = createContactPending.get(key);
            if (p) await p;
            const existingAfter = await findContactByPhone(phone).catch(() => void 0);
            if (existingAfter) {
              sendResponse({ success: true, contactId: existingAfter.id, existing: true, existingContact: { id: existingAfter.id, name: existingAfter.name, phone: existingAfter.phoneNumber, status: existingAfter.status, createdAt: existingAfter.createdAt } });
            } else {
              sendResponse({ success: false, error: "Contact creation in progress, please wait." });
            }
            return;
          }
          createContactPendingKeys.add(key);
          const pending = new Promise((resolve) => {
            createContactPendingResolve.set(key, resolve);
          });
          createContactPending.set(key, pending);
          try {
            console.log("[Background] ➕ Creating contact:", phone, name);
            const existing = await findContactByPhone(phone).catch(() => void 0);
            if (existing) {
              console.log("[Background] ⚠️ Contact already exists:", existing.id, existing.name);
              sendResponse({
                success: true,
                contactId: existing.id,
                existing: true,
                existingContact: {
                  id: existing.id,
                  name: existing.name,
                  phone: existing.phoneNumber,
                  status: existing.status,
                  createdAt: existing.createdAt
                }
              });
              return;
            }
            let contactId = null;
            try {
              contactId = await createContact(phone, name || phone);
            } catch (dbErr) {
              console.warn("[Background] Direct DB create failed:", dbErr);
            }
            if (contactId !== null) {
              console.log("[Background] ✅ Contact created, id:", contactId);
              notifyCrmContactChanged({ contactId, contactPhone: phone, name: name || phone });
              sendResponse({ success: true, contactId });
              return;
            }
            const allExtensionTabs = await chrome.tabs.query({ url: chrome.runtime.getURL("*") });
            const crmTabs = allExtensionTabs.filter((t) => t.url && t.url.includes("/crm/"));
            let created = false;
            const firstCrmTab = crmTabs[0];
            if (firstCrmTab?.id) {
              try {
                const payload = { type: "CREATE_CONTACT", phone, name, payload: { phone, name }, fromBackground: true };
                const response = await chrome.tabs.sendMessage(firstCrmTab.id, payload);
                if (response?.success) {
                  created = true;
                  sendResponse(response);
                } else if (response && !response.success) {
                  sendResponse(response);
                }
              } catch {
              }
            }
            if (!created) {
              console.log("[Background] ⚠️ DB not ready, opening CRM tab...");
              try {
                const crmUrl = chrome.runtime.getURL("crm/index.html");
                const newTab = await chrome.tabs.create({ url: crmUrl, active: false });
                await new Promise((r) => setTimeout(r, 3e3));
                const retryId = await createContact(phone, name || phone);
                if (retryId !== null) {
                  console.log("[Background] ✅ Contact created after CRM init, id:", retryId);
                  notifyCrmContactChanged({ contactId: retryId, contactPhone: phone, name: name || phone });
                  sendResponse({ success: true, contactId: retryId });
                  try {
                    if (newTab.id) chrome.tabs.remove(newTab.id);
                  } catch {
                  }
                } else {
                  sendResponse({ success: false, error: "Please open the CRM tab first, then try again." });
                }
              } catch {
                sendResponse({ success: false, error: "Please open the CRM tab first, then try again." });
              }
            }
          } finally {
            createContactPendingKeys.delete(key);
            createContactPendingResolve.get(key)?.();
            createContactPendingResolve.delete(key);
            createContactPending.delete(key);
          }
        } catch (error) {
          console.error("[Background] ❌ CREATE_CONTACT error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "UPDATE_CONTACT_NOTES":
      (async () => {
        try {
          const { phone, notes, name } = message.payload || {};
          if (!phone) {
            sendResponse({ success: false, error: "No phone provided" });
            return;
          }
          const phoneSuffix = phone.replace(/[\s\-\(\)\+]/g, "").slice(-9);
          console.log("[Background] 📝 Updating notes for:", phone, "(suffix:", phoneSuffix, ")");
          const crmTabsUpdate = await chrome.tabs.query({ url: chrome.runtime.getURL("*") });
          let updated = false;
          for (const tab of crmTabsUpdate) {
            if (tab.id) {
              try {
                const response = await chrome.tabs.sendMessage(tab.id, {
                  type: "UPDATE_CONTACT_NOTES",
                  phone: phoneSuffix,
                  // For lookup
                  fullPhone: phone,
                  // Full phone for new contacts
                  notes,
                  name
                });
                if (response?.success) {
                  updated = true;
                  break;
                }
              } catch (e) {
              }
            }
          }
          if (!updated) {
            const pending = await chrome.storage.local.get(["pendingContactUpdates"]);
            const updates = pending.pendingContactUpdates || [];
            updates.push({ phone, phoneSuffix, notes, name, timestamp: Date.now() });
            await chrome.storage.local.set({ pendingContactUpdates: updates });
            sendResponse({ success: true, pending: true });
          } else {
            sendResponse({ success: true });
          }
        } catch (error) {
          console.error("[Background] ❌ UPDATE_CONTACT_NOTES error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "UPDATE_CONTACT_SIDEBAR":
      (async () => {
        try {
          const { phone, status, tags, notes } = message.payload || {};
          if (!phone) {
            sendResponse({ success: false, error: "No phone provided" });
            return;
          }
          const updates = {};
          if (status !== void 0) updates.status = status;
          if (tags !== void 0) updates.tags = tags;
          if (notes !== void 0) updates.notes = notes;
          if (Object.keys(updates).length === 0) {
            sendResponse({ success: true });
            return;
          }
          const ok = await updateContactByPhone(phone, updates);
          if (ok) notifyCrmContactChanged();
          sendResponse({ success: ok });
        } catch (error) {
          console.error("[Background] ❌ UPDATE_CONTACT_SIDEBAR error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "GET_DASHBOARD_STATS":
      (async () => {
        try {
          const { period = "7days" } = message.payload || {};
          const token = await getValidToken();
          if (!token) {
            console.log("[Background] ❌ GET_DASHBOARD_STATS: No auth token");
            sendResponse({ success: false, error: "Not authenticated" });
            return;
          }
          console.log("[Background] 📊 Fetching dashboard stats from API, period:", period);
          const response = await fetch(`${API_BASE_URL}/usage/dashboard-stats?period=${period}`, {
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (!response.ok) {
            console.error("[Background] ❌ Dashboard stats API error:", response.status);
            sendResponse({ success: false, error: `API error: ${response.status}` });
            return;
          }
          const data = await response.json();
          console.log("[Background] ✅ Dashboard stats fetched successfully");
          sendResponse(data);
        } catch (error) {
          console.error("[Background] ❌ GET_DASHBOARD_STATS error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "GET_CONTACT_MESSAGES":
      (async () => {
        try {
          const { phoneNumber, limit = 30, offset = 0 } = message.payload || {};
          const token = await getValidToken();
          if (!token) {
            console.log("[Background] ❌ GET_CONTACT_MESSAGES: No auth token");
            sendResponse({ success: false, error: "Not authenticated" });
            return;
          }
          if (!phoneNumber) {
            console.error("[Background] ❌ GET_CONTACT_MESSAGES: Phone number required");
            sendResponse({ success: false, error: "Phone number is required" });
            return;
          }
          console.log("[Background] 📨 Fetching messages for contact:", phoneNumber);
          const response = await fetch(
            `${API_BASE_URL}/contacts/${encodeURIComponent(phoneNumber)}/messages?limit=${limit}&offset=${offset}`,
            { headers: { "Authorization": `Bearer ${token}` } }
          );
          if (!response.ok) {
            console.error("[Background] ❌ Messages API error:", response.status);
            sendResponse({ success: false, error: `API error: ${response.status}` });
            return;
          }
          const data = await response.json();
          console.log("[Background] ✅ Messages fetched successfully:", data.total);
          sendResponse(data);
        } catch (error) {
          console.error("[Background] ❌ GET_CONTACT_MESSAGES error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "GET_TEMPLATES":
      (async () => {
        try {
          const templates = await getTemplates();
          sendResponse({ success: true, templates });
        } catch (err) {
          sendResponse({ success: false, templates: [], error: String(err) });
        }
      })();
      return true;
    case "CREATE_TEMPLATE":
      (async () => {
        try {
          const { title, content, category, shortcut } = message.payload || {};
          if (!title?.trim() || !content?.trim()) {
            sendResponse({ success: false, error: "Title and content are required" });
            return;
          }
          const id = await addTemplate({ title, content, category, shortcut });
          if (id != null) {
            sendResponse({ success: true, id });
          } else {
            sendResponse({ success: false, error: "Failed to create template" });
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "GET_CONTACT_BOOKINGS":
      (async () => {
        try {
          const { phone } = message.payload || {};
          const bookings = await getContactBookings(phone || "");
          sendResponse({ success: true, bookings });
        } catch (err) {
          sendResponse({ success: false, bookings: [], error: String(err) });
        }
      })();
      return true;
    case "GET_AVAILABLE_SLOTS":
      (async () => {
        try {
          const { date } = message.payload || {};
          const slots = await getAvailableSlots(date);
          const settings = await getCalendarSettings();
          sendResponse({ success: true, slots, slotDuration: settings?.slotDuration || 30 });
        } catch (err) {
          sendResponse({ success: false, slots: [], error: String(err) });
        }
      })();
      return true;
    case "GET_CALENDAR_SETTINGS":
      (async () => {
        try {
          const settings = await getCalendarSettings();
          const promptHint = getCalendarPromptHint(settings);
          sendResponse({ success: true, settings, promptHint: promptHint ?? void 0 });
        } catch (err) {
          sendResponse({ success: false, settings: null, error: String(err) });
        }
      })();
      return true;
    case "CREATE_QUICK_BOOKING":
      (async () => {
        try {
          const id = await createQuickBooking(message.payload);
          sendResponse({ success: !!id, bookingId: id });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "EXECUTE_CALENDAR_TOOL":
      (async () => {
        try {
          const { toolName, args } = message.payload || {};
          const result = await executeCalendarTool(toolName, args || {});
          console.log("[Background] Calendar tool result:", toolName, result);
          if (toolName === "book_appointment" && result?.success) {
            await notifyOwnerAboutCalendarToolBooking(args || {}, result);
          }
          if ((toolName === "book_appointment" || toolName === "cancel_booking" || toolName === "reschedule_booking" || toolName === "change_booking_resource") && result?.success) {
            notifyCalendarBookingsChanged();
          }
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, message: "Calendar tool execution failed.", error: String(err) });
        }
      })();
      return true;
    case "GET_ACTIVE_FLOWS":
      (async () => {
        try {
          const flows = await getActiveFlows();
          sendResponse({ success: true, flows });
        } catch (err) {
          sendResponse({ success: false, flows: [], error: String(err) });
        }
      })();
      return true;
    case "START_FLOW_FOR_CONTACT":
      (async () => {
        try {
          const { flowId, contactId, contactName } = message.payload || {};
          const id = await createFlowExecution(flowId, contactId, contactName);
          sendResponse({ success: !!id, executionId: id });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "GET_AI_AGENTS":
      (async () => {
        try {
          const agents = await getAIAgents();
          sendResponse({ success: true, agents });
        } catch (err) {
          sendResponse({ success: false, agents: [], error: String(err) });
        }
      })();
      return true;
    case "CREATE_SCHEDULED_MESSAGE":
      (async () => {
        try {
          console.log("[Background] 📅 CREATE_SCHEDULED_MESSAGE received");
          const payload = message.payload || {};
          const phone = payload.phone;
          const contactName = payload.contactName;
          const msgText = payload.message;
          const scheduledAt = payload.scheduledAt;
          console.log("[Background] 📅 Data:", { phone, contactName, msgText: msgText?.substring?.(0, 30), scheduledAt });
          if (!phone || !msgText || !scheduledAt) {
            console.log("[Background] ❌ Missing required fields");
            sendResponse({ success: false, error: "Missing phone, message or time" });
            return;
          }
          const data = await chrome.storage.local.get(["scheduledMessages"]);
          const messages = data.scheduledMessages || [];
          const newMessage = {
            id: `sm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            phone,
            contactName: contactName || phone,
            message: msgText,
            scheduledAt,
            status: "pending",
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          messages.push(newMessage);
          await chrome.storage.local.set({ scheduledMessages: messages });
          console.log("[Background] ✅ Scheduled message saved:", newMessage.id);
          sendResponse({ success: true, messageId: newMessage.id });
        } catch (error) {
          console.error("[Background] ❌ CREATE_SCHEDULED_MESSAGE error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "ARCHIVE_FLOW_BADGE":
    case "ARCHIVE_CAMPAIGN_BADGE":
      (async () => {
        try {
          const { sourceId, reason } = message.payload || {};
          if (!sourceId) {
            sendResponse({ success: false, error: "No sourceId provided" });
            return;
          }
          console.log("[Background] 🏷️ Archiving badges for sourceId:", sourceId, "reason:", reason);
          const result = await chrome.storage.local.get(["contactContexts"]);
          const contexts = result.contactContexts || {};
          let archivedCount = 0;
          const now = Date.now();
          for (const [phone, context] of Object.entries(contexts)) {
            if (context.activeBadge?.sourceId === sourceId) {
              const archivedBadge = {
                ...context.activeBadge,
                archivedAt: now,
                archiveReason: reason || (message.type === "ARCHIVE_FLOW_BADGE" ? "flow_stopped" : "campaign_completed")
              };
              context.badgeHistory = [archivedBadge, ...context.badgeHistory || []];
              context.activeBadge = null;
              archivedCount++;
            }
          }
          await chrome.storage.local.set({ contactContexts: contexts });
          console.log("[Background] ✅ Archived", archivedCount, "badges for sourceId:", sourceId);
          sendResponse({ success: true, archivedCount });
        } catch (error) {
          console.error("[Background] ❌ Archive badge error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "INIT_CONTACT_CONTEXT_SERVICE":
      (async () => {
        try {
          console.log("[Background] 🚀 Initializing ContactContextService...");
          const result = await chrome.storage.local.get(["contactContexts", "trackedMessages"]);
          const contexts = result.contactContexts || {};
          const trackedMessages = result.trackedMessages || [];
          if (Object.keys(contexts).length > 0 || trackedMessages.length === 0) {
            console.log("[Background] Migration not needed");
            sendResponse({ success: true, migrated: 0 });
            return;
          }
          console.log("[Background] Starting migration of", trackedMessages.length, "tracked messages...");
          sendResponse({ success: true, message: "Migration will be handled by ContactContextService" });
        } catch (error) {
          console.error("[Background] ❌ Init error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "CHECK_SUMMARY_LIMIT":
      // No plan limits in the standalone edition; summaries read up to the last 50 messages.
      sendResponse({ success: true, limitExceeded: false, used: 0, limit: -1, messageLimit: 50, planName: DownlabsLocal.UNLIMITED_PLAN.name });
      break;
    case "GET_CHAT_MESSAGES_FOR_SUMMARY":
      (async () => {
        try {
          const { limit } = message.payload || { limit: 10 };
          console.log("[Background] 📨 Getting chat messages for summary (limit:", limit, ")");
          const waTab = await findWhatsAppTab();
          if (!waTab || !waTab.id) {
            sendResponse({ success: false, error: "WhatsApp Web not open", messages: [] });
            return;
          }
          try {
            const response = await chrome.tabs.sendMessage(waTab.id, {
              type: "GET_CURRENT_CHAT_MESSAGES",
              limit
            });
            if (response?.success) {
              sendResponse({ success: true, messages: response.messages });
            } else {
              sendResponse({ success: false, error: response?.error || "Failed to get messages", messages: [] });
            }
          } catch (tabError) {
            console.error("[Background] ❌ Error communicating with WhatsApp tab:", tabError);
            sendResponse({ success: false, error: "Cannot communicate with WhatsApp Web", messages: [] });
          }
        } catch (error) {
          console.error("[Background] ❌ GET_CHAT_MESSAGES_FOR_SUMMARY error:", error);
          sendResponse({ success: false, error: String(error), messages: [] });
        }
      })();
      return true;
    case "GENERATE_CHAT_SUMMARY":
      (async () => {
        try {
          const { messages } = message.payload || {};
          if (!messages || messages.length === 0) {
            sendResponse({ success: false, error: "No messages provided" });
            return;
          }
          console.log("[Background] 🤖 Generating chat summary for", messages.length, "messages");
          const storageData = await chrome.storage.local.get(["aiConfig"]);
          const aiConfig = storageData.aiConfig || {};
          const formattedMessages = messages.map(
            (m) => `${m.role === "me" ? "Me" : "Contact"}: ${m.text}`
          ).join("\n");
          const systemPrompt = `You are a helpful assistant that creates very concise chat summaries.
Summarize the entire conversation in 2-3 short sentences as a single paragraph. Do NOT use bullet points, lists, or headers. Just plain text.

IMPORTANT: Write the summary in the SAME language as the conversation.`;
          const userPrompt = `Please summarize this conversation:

${formattedMessages}`;
          console.log("[Background] Generating summary with the configured AI provider");
          const sumProxy = await proxyOpenAIChatCompletion({
            model: aiConfig.model || "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            temperature: 0.5,
            max_completion_tokens: 500
          });
          if (!sumProxy.ok) {
            sendResponse({ success: false, error: sumProxy.error || "Failed to generate summary" });
            return;
          }
          const summary = sumProxy.data?.choices?.[0]?.message?.content?.trim?.() || "";
          if (!summary) {
            sendResponse({ success: false, error: "Failed to generate summary" });
            return;
          }
          console.log("[Background] ✅ Summary generated");
          sendResponse({ success: true, summary });
        } catch (error) {
          console.error("[Background] ❌ GENERATE_CHAT_SUMMARY error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "TRANSCRIBE_VOICE":
      (async () => {
        try {
          const { directPath, mediaKey, mimetype, messageId } = message.payload;
          console.log("[Background] 🎤 TRANSCRIBE_VOICE request");
          console.log("[Background]   - directPath:", directPath?.substring(0, 60) + "...");
          console.log("[Background]   - hasMediaKey:", !!mediaKey);
          console.log("[Background]   - mimetype:", mimetype);
          if (!directPath || !mediaKey) {
            sendResponse({ success: false, error: "Missing directPath or mediaKey" });
            return;
          }
          console.log("[Background] 🎤 Downloading encrypted audio...");
          const cdnUrl = `https://mmg.whatsapp.net${directPath}`;
          const audioResponse = await fetch(cdnUrl);
          if (!audioResponse.ok) {
            throw new Error(`CDN download failed: ${audioResponse.status} ${audioResponse.statusText}`);
          }
          const encryptedBuffer = await audioResponse.arrayBuffer();
          console.log("[Background] 🎤 Downloaded:", encryptedBuffer.byteLength, "bytes");
          console.log("[Background] 🎤 Decrypting audio...");
          const decryptedBuffer = await decryptWhatsAppAudio(encryptedBuffer, mediaKey);
          console.log("[Background] 🎤 Decrypted:", decryptedBuffer.byteLength, "bytes");
          console.log("[Background] 🎤 Sending to Whisper API...");
          const audioBlob = new Blob([decryptedBuffer], { type: "audio/ogg" });
          const formData = new FormData();
          formData.append("file", audioBlob, "voice.ogg");
          formData.append("model", "whisper-1");
          const whisperProxy = await proxyOpenAITranscription(formData);
          if (!whisperProxy.ok) {
            console.error("[Background] 🎤 Whisper API error:", whisperProxy.error);
            throw new Error(whisperProxy.error || "Whisper API error");
          }
          const transcription = whisperProxy.data?.text || "";
          console.log("[Background] 🎤 ✅ Transcription:", transcription.substring(0, 100));
          sendResponse({ success: true, text: transcription, messageId });
        } catch (error) {
          console.error("[Background] 🎤 ❌ TRANSCRIBE_VOICE error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "ANALYZE_IMAGE":
      (async () => {
        try {
          const { directPath, mediaKey, mimetype, messageId, caption } = message.payload;
          console.log("[Background] 🖼️ ANALYZE_IMAGE request");
          console.log("[Background]   - directPath:", directPath?.substring(0, 60) + "...");
          console.log("[Background]   - hasMediaKey:", !!mediaKey);
          console.log("[Background]   - mimetype:", mimetype);
          console.log("[Background]   - caption:", caption || "(none)");
          if (!directPath || !mediaKey) {
            sendResponse({ success: false, error: "Missing directPath or mediaKey" });
            return;
          }
          console.log("[Background] 🖼️ Downloading encrypted image...");
          const cdnUrl = `https://mmg.whatsapp.net${directPath}`;
          const imgResponse = await fetch(cdnUrl);
          if (!imgResponse.ok) {
            throw new Error(`CDN download failed: ${imgResponse.status} ${imgResponse.statusText}`);
          }
          const encryptedBuffer = await imgResponse.arrayBuffer();
          console.log("[Background] 🖼️ Downloaded:", encryptedBuffer.byteLength, "bytes");
          console.log("[Background] 🖼️ Decrypting image...");
          const decryptedBuffer = await decryptWhatsAppImage(encryptedBuffer, mediaKey);
          console.log("[Background] 🖼️ Decrypted:", decryptedBuffer.byteLength, "bytes");
          const bytes = new Uint8Array(decryptedBuffer);
          let binary = "";
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            for (let j = 0; j < chunk.length; j++) {
              binary += String.fromCharCode(chunk[j]);
            }
          }
          const base64Image = btoa(binary);
          const imageDataUrl = `data:${mimetype || "image/jpeg"};base64,${base64Image}`;
          console.log("[Background] 🖼️ Image converted to base64, length:", base64Image.length);
          console.log("[Background] 🖼️ Sending to OpenAI Vision API...");
          const userContent = [];
          if (caption) {
            userContent.push({
              type: "text",
              text: `The user sent this image with the following caption: "${caption}"

Please describe what's in this image in detail and consider the caption context.`
            });
          } else {
            userContent.push({
              type: "text",
              text: "The user sent this image. Please describe what's in this image in detail — what objects, people, text, or information does it contain?"
            });
          }
          userContent.push({
            type: "image_url",
            image_url: {
              url: imageDataUrl,
              detail: "auto"
            }
          });
          const visionProxy = await proxyOpenAIChatCompletion({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "You are a helpful assistant that analyzes images. Provide a clear, concise description of the image content. If there is text in the image, transcribe it. If the image contains a question or request, identify it. Respond in the same language as the caption if provided, otherwise respond in Russian."
              },
              {
                role: "user",
                content: userContent
              }
            ],
            max_completion_tokens: 500
          });
          if (!visionProxy.ok) {
            console.error("[Background] 🖼️ Vision API error:", visionProxy.error);
            throw new Error(visionProxy.error || "Vision API error");
          }
          const description = visionProxy.data?.choices?.[0]?.message?.content?.trim() || "";
          console.log("[Background] 🖼️ ✅ Image description:", description.substring(0, 150));
          sendResponse({ success: true, description, messageId, caption });
        } catch (error) {
          console.error("[Background] 🖼️ ❌ ANALYZE_IMAGE error:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    case "GET_ALL_CRM_CONTACTS":
      (async () => {
        try {
          console.log("[Background] 📦 GET_ALL_CRM_CONTACTS: Fetching all contacts for cache");
          const db = await openCrmDb();
          try {
            const contacts = await readAllFromStore(db, "contacts");
            console.log("[Background] ✅ Loaded", contacts.length, "contacts for cache");
            sendResponse({
              success: true,
              contacts: contacts.map((c) => ({
                id: c.id,
                phoneNumber: c.phoneNumber,
                name: c.name,
                status: c.status,
                tags: c.tags,
                notes: c.notes,
                lastMessageDate: c.lastMessageDate instanceof Date ? c.lastMessageDate.toISOString() : String(c.lastMessageDate || ""),
                createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
                updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : String(c.updatedAt),
                customFields: c.customFields
              }))
            });
          } finally {
            db?.close();
          }
        } catch (error) {
          console.error("[Background] ❌ GET_ALL_CRM_CONTACTS error:", error);
          sendResponse({ success: false, error: String(error), contacts: [] });
        }
      })();
      return true;
    case "GET_CONTACT_BY_PHONE":
      (async () => {
        try {
          const { phone } = message.payload || {};
          console.log("[Background] 📞 GET_CONTACT_BY_PHONE:", phone);
          if (!phone) {
            sendResponse({ success: false, error: "No phone provided", contact: null });
            return;
          }
          const contact = await findContactByPhone(phone);
          if (contact) {
            sendResponse({
              success: true,
              contact: {
                id: contact.id,
                phoneNumber: contact.phoneNumber,
                name: contact.name,
                status: contact.status,
                tags: contact.tags,
                notes: contact.notes,
                lastMessageDate: contact.lastMessageDate instanceof Date ? contact.lastMessageDate.toISOString() : String(contact.lastMessageDate || ""),
                createdAt: contact.createdAt instanceof Date ? contact.createdAt.toISOString() : String(contact.createdAt),
                updatedAt: contact.updatedAt instanceof Date ? contact.updatedAt.toISOString() : String(contact.updatedAt),
                customFields: contact.customFields
              }
            });
          } else {
            sendResponse({ success: true, contact: null });
          }
        } catch (error) {
          console.error("[Background] ❌ GET_CONTACT_BY_PHONE error:", error);
          sendResponse({ success: false, error: String(error), contact: null });
        }
      })();
      return true;
    case "GET_CONTACT_BY_NAME":
      (async () => {
        try {
          const { name } = message.payload || {};
          console.log("[Background] 👤 GET_CONTACT_BY_NAME:", name);
          if (!name) {
            sendResponse({ success: false, error: "No name provided", contact: null });
            return;
          }
          const db = await openCrmDb();
          try {
            const contacts = await readAllFromStore(db, "contacts");
            let contact = contacts.find((c) => c.name === name);
            if (!contact) {
              const nameLower = name.toLowerCase();
              contact = contacts.find((c) => c.name?.toLowerCase() === nameLower);
            }
            if (contact) {
              console.log("[Background] ✅ Found contact by name:", contact.phoneNumber);
              sendResponse({
                success: true,
                contact: {
                  id: contact.id,
                  phoneNumber: contact.phoneNumber,
                  name: contact.name,
                  status: contact.status,
                  tags: contact.tags,
                  notes: contact.notes,
                  lastMessageDate: contact.lastMessageDate instanceof Date ? contact.lastMessageDate.toISOString() : String(contact.lastMessageDate || ""),
                  createdAt: contact.createdAt instanceof Date ? contact.createdAt.toISOString() : String(contact.createdAt),
                  updatedAt: contact.updatedAt instanceof Date ? contact.updatedAt.toISOString() : String(contact.updatedAt),
                  customFields: contact.customFields
                }
              });
            } else {
              console.log("[Background] ❌ No contact found by name:", name);
              sendResponse({ success: true, contact: null });
            }
          } finally {
            db?.close();
          }
        } catch (error) {
          console.error("[Background] ❌ GET_CONTACT_BY_NAME error:", error);
          sendResponse({ success: false, error: String(error), contact: null });
        }
      })();
      return true;
    case "GET_ACCOUNT_OWNER":
      (async () => {
        try {
          const owner = await getAccountOwnerContact();
          sendResponse({ success: true, owner });
        } catch (err) {
          sendResponse({ success: false, owner: null, error: String(err) });
        }
      })();
      return true;
    case "CRM_LIST_CONTACTS":
      (async () => {
        try {
          const { search, status, tag, limit } = message.payload || {};
          const db = await openCrmDb();
          try {
            let contacts = await readAllFromStore(db, "contacts");
            if (search) {
              const q = String(search).toLowerCase();
              contacts = contacts.filter(
                (c) => c.name?.toLowerCase().includes(q) || c.phoneNumber?.includes(search) || c.notes?.toLowerCase().includes(q)
              );
            }
            if (status) contacts = contacts.filter((c) => c.status === status);
            if (tag) contacts = contacts.filter((c) => Array.isArray(c.tags) && c.tags.includes(tag));
            if (limit) contacts = contacts.slice(0, Number(limit));
            sendResponse({
              success: true,
              contacts: contacts.map((c) => ({
                id: c.id,
                name: c.name,
                phoneNumber: c.phoneNumber,
                status: c.status,
                tags: c.tags,
                notes: c.notes,
                lastMessageDate: c.lastMessageDate instanceof Date ? c.lastMessageDate.toISOString() : c.lastMessageDate || null,
                customFields: c.customFields
              })),
              total: contacts.length
            });
          } finally {
            db?.close();
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err), contacts: [] });
        }
      })();
      return true;
    case "CRM_GET_CONTACT":
      (async () => {
        try {
          const { phone, name, id } = message.payload || {};
          let contact;
          if (id) contact = await getContactById(Number(id));
          else if (phone) contact = await findContactByPhone(phone);
          else if (name) {
            const db = await openCrmDb();
            try {
              const all = await readAllFromStore(db, "contacts");
              contact = all.find((c) => c.name?.toLowerCase() === String(name).toLowerCase());
            } finally {
              db?.close();
            }
          }
          if (!contact) {
            sendResponse({ success: false, error: "Contact not found", contact: null });
          } else {
            const data = await getFullContactData(contact.phoneNumber, contact.name);
            sendResponse({ success: true, contact: { ...contact }, fullData: data });
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err), contact: null });
        }
      })();
      return true;
    case "CRM_CREATE_CONTACT":
      (async () => {
        try {
          const { phone, name } = message.payload || {};
          if (!phone || !name) {
            sendResponse({ success: false, error: "phone and name are required" });
            return;
          }
          const id = await createContact(phone, name);
          sendResponse({ success: !!id, contactId: id });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_UPDATE_CONTACT":
      (async () => {
        try {
          const { phone, status, tags, notes, customFields } = message.payload || {};
          if (!phone) {
            sendResponse({ success: false, error: "phone is required" });
            return;
          }
          const normalizedCustomFields = customFields && typeof customFields === "object" ? normalizeObjectDates(customFields) : void 0;
          const ok = await updateContactByPhone(phone, { status, tags, notes, customFields: normalizedCustomFields });
          sendResponse({ success: ok });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_LIST_DATA_FIELDS":
      (async () => {
        try {
          const config = await getContactFieldsConfig();
          sendResponse({
            success: true,
            fields: config?.fields ?? [],
            updatedAt: config?.updatedAt
          });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_ADD_DATA_FIELD":
      (async () => {
        try {
          const { name, label, type, required, options } = message.payload || {};
          if (!label && !name) {
            sendResponse({ success: false, error: "label or name is required" });
            return;
          }
          const result = await addContactField({ name, label, type, required, options });
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_LIST_CUSTOM_TABLES":
      (async () => {
        try {
          const schemas = await getCustomSchemasList();
          sendResponse({
            success: true,
            tables: schemas.map((s) => ({
              id: s.id,
              name: s.name,
              label: s.label,
              fields: s.fields,
              createdAt: s.createdAt
            }))
          });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_CREATE_CUSTOM_TABLE":
      (async () => {
        try {
          const { name, label, fields } = message.payload || {};
          if (!name && !label) {
            sendResponse({ success: false, error: "name or label is required" });
            return;
          }
          const result = await addCustomSchema({
            name: name || label,
            label: label || name,
            fields: Array.isArray(fields) ? fields : []
          });
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_ADD_CUSTOM_RECORD":
      (async () => {
        try {
          const { phone, contactId, schemaId, data } = message.payload || {};
          let cid;
          if (contactId != null) {
            cid = Number(contactId);
          } else if (phone) {
            const contact = await findContactByPhone(phone);
            cid = contact?.id;
          }
          if (cid == null) {
            sendResponse({ success: false, error: "contact not found: provide phone or contactId" });
            return;
          }
          if (!schemaId) {
            sendResponse({ success: false, error: "schemaId is required" });
            return;
          }
          const normalizedData = data && typeof data === "object" ? normalizeObjectDates(data) : {};
          const result = await addCustomRecord({ contactId: cid, schemaId, data: normalizedData });
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_LIST_CAMPAIGNS":
      (async () => {
        try {
          const { status: filterStatus, limit } = message.payload || {};
          const db = await openCrmDb();
          try {
            let campaigns = await readAllFromStore(db, "campaigns");
            if (filterStatus) {
              if (filterStatus === "active") {
                campaigns = campaigns.filter((c) => c.status === "active" || c.status === "running");
              } else {
                campaigns = campaigns.filter((c) => c.status === filterStatus);
              }
            }
            campaigns = campaigns.sort((a, b) => {
              const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt || 0).getTime();
              const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt || 0).getTime();
              return tb - ta;
            });
            if (limit) campaigns = campaigns.slice(0, Number(limit));
            sendResponse({
              success: true,
              campaigns: campaigns.map((c) => ({
                id: c.id,
                name: c.name,
                status: c.status,
                messageTemplate: c.messageTemplate,
                campaignGoal: c.campaignGoal,
                createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt || null,
                stats: c.stats,
                recipientsCount: Array.isArray(c.recipients) ? c.recipients.length : c.targetPhones?.length || 0
              })),
              total: campaigns.length
            });
          } finally {
            db?.close();
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err), campaigns: [] });
        }
      })();
      return true;
    case "CRM_GET_CAMPAIGN":
      (async () => {
        try {
          const { id } = message.payload || {};
          if (!id) {
            sendResponse({ success: false, error: "id is required" });
            return;
          }
          const db = await openCrmDb();
          try {
            const all = await readAllFromStore(db, "campaigns");
            const campaign = all.find((c) => String(c.id) === String(id));
            if (!campaign) {
              sendResponse({ success: false, error: "Campaign not found" });
            } else {
              sendResponse({ success: true, campaign });
            }
          } finally {
            db?.close();
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_CREATE_CAMPAIGN":
      (async () => {
        try {
          const payload = message.payload || {};
          const { name, messageTemplate, campaignGoal, recipientPhones, recipientNames, startNow } = payload;
          if (!name || !messageTemplate) {
            sendResponse({ success: false, error: "name and messageTemplate are required" });
            return;
          }
          const result = await createCampaign({
            name: String(name).trim(),
            messageTemplate: String(messageTemplate).trim(),
            campaignGoal: campaignGoal != null ? String(campaignGoal).trim() : void 0,
            recipientPhones: Array.isArray(recipientPhones) ? recipientPhones.map(String) : void 0,
            recipientNames: Array.isArray(recipientNames) ? recipientNames.map(String) : void 0,
            startNow: !!startNow
          });
          if ("error" in result) {
            sendResponse({ success: false, error: result.error });
          } else {
            sendResponse({ success: true, id: result.id });
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_START_CAMPAIGN":
      (async () => {
        try {
          const payload = message.payload || {};
          const { id: campaignId, name: campaignName } = payload;
          const result = await startCampaignByIdOrName({
            id: campaignId != null ? Number(campaignId) : void 0,
            name: campaignName != null ? String(campaignName).trim() : void 0
          });
          if ("error" in result) {
            sendResponse({ success: false, error: result.error });
            return;
          }
          const campaign = result.campaign;
          sendResponse({ success: true, campaignId: campaign.id, message: "Campaign started" });
          const tab = await findWhatsAppTab();
          if (!tab?.id || !campaign.recipients?.length) return;
          const minDelay = campaign.settings?.minDelay ?? 3e3;
          const maxDelay = campaign.settings?.maxDelay ?? 6e3;
          const delay = () => new Promise((r) => setTimeout(r, minDelay + Math.random() * (maxDelay - minDelay)));
          const campaignGoal = campaign.campaignGoal || campaign.settings?.gptSystemMessage || "";
          for (const r of campaign.recipients) {
            if (r.status !== "pending") continue;
            let content = campaign.messageTemplate || "";
            const nameVal = r.name || r.phoneNumber || "";
            content = content.replace(/\[name\]/gi, nameVal).replace(/\[phone\]/gi, r.phoneNumber || "");
            if (r.variables && typeof r.variables === "object") {
              for (const [k, v] of Object.entries(r.variables)) {
                content = content.replace(new RegExp(`\\[${k}\\]`, "gi"), String(v));
              }
            }
            try {
              await chrome.tabs.sendMessage(tab.id, {
                type: "SEND_CAMPAIGN_MESSAGE",
                payload: {
                  phoneNumber: r.phoneNumber,
                  content,
                  contactName: r.name,
                  campaignId: campaign.id,
                  campaignName: campaign.name,
                  campaignGoal,
                  botAgentId: campaign.botAgentId,
                  gptSystemMessage: campaign.settings?.gptSystemMessage
                }
              });
              await updateCampaignRecipientStatus(campaign.id, r.phoneNumber, "sent");
            } catch (e) {
              await updateCampaignRecipientStatus(campaign.id, r.phoneNumber, "failed", e.message);
            }
            await delay();
          }
          const updated = await getCampaignById(campaign.id);
          if (updated) {
            const sent = updated.stats?.sent ?? 0;
            const failed = updated.stats?.failed ?? 0;
            await pushToAppNotificationFeed("campaign_complete", "Campaign Sending Complete", `"${updated.name}" finished: ${sent} sent, ${failed} failed`);
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_CREATE_FLOW":
      (async () => {
        try {
          const payload = message.payload || {};
          const {
            name,
            messageTemplate,
            description,
            goal,
            triggerType,
            triggerEventType,
            moduleId,
            moduleEventId,
            waitBeforeMessage,
            isActive
          } = payload;
          if (!name || !messageTemplate) {
            sendResponse({ success: false, error: "name and messageTemplate are required" });
            return;
          }
          const result = await createFlow({
            name: String(name).trim(),
            messageTemplate: String(messageTemplate).trim(),
            description: description != null ? String(description).trim() : void 0,
            goal: goal != null ? String(goal).trim() : void 0,
            triggerType: triggerType === "module_event" ? "module_event" : "event",
            triggerEventType: triggerType === "module_event" ? void 0 : ["contact_added", "tag_added", "custom_record_added", "message_received"].includes(triggerEventType) ? triggerEventType : "contact_added",
            moduleId: moduleId != null ? String(moduleId).trim() : void 0,
            moduleEventId: moduleEventId != null ? String(moduleEventId).trim() : void 0,
            waitBeforeMessage: waitBeforeMessage && typeof waitBeforeMessage.duration === "number" && waitBeforeMessage.unit ? {
              duration: Number(waitBeforeMessage.duration),
              unit: ["minutes", "hours", "days"].includes(waitBeforeMessage.unit) ? waitBeforeMessage.unit : "days"
            } : void 0,
            isActive: isActive !== false
          });
          if ("error" in result) {
            sendResponse({ success: false, error: result.error });
          } else {
            sendResponse({ success: true, id: result.id });
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_LIST_FLOWS":
      (async () => {
        try {
          const db = await openCrmDb();
          try {
            const flows = await readAllFromStore(db, "flows");
            sendResponse({
              success: true,
              flows: flows.map((f) => ({
                id: f.id,
                name: f.name,
                isActive: f.isActive,
                enabled: f.enabled,
                description: f.description || "",
                goal: f.goal || "",
                triggerType: f.trigger?.type || f.triggerType || "",
                stepsCount: Array.isArray(f.steps) ? f.steps.length : 0,
                createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : f.createdAt || null,
                stats: f.stats
              })),
              total: flows.length
            });
          } finally {
            db?.close();
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err), flows: [] });
        }
      })();
      return true;
    case "CRM_GET_FLOW":
      (async () => {
        try {
          const { id } = message.payload || {};
          if (!id) {
            sendResponse({ success: false, error: "id is required" });
            return;
          }
          const db = await openCrmDb();
          try {
            const flows = await readAllFromStore(db, "flows");
            const flow = flows.find((f) => String(f.id) === String(id));
            sendResponse(flow ? { success: true, flow } : { success: false, error: "Flow not found" });
          } finally {
            db?.close();
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_GET_FLOW_EXECUTIONS":
      (async () => {
        try {
          const { flowId, contactId, status: filterStatus, limit } = message.payload || {};
          const db = await openCrmDb();
          try {
            let execs = await readAllFromStore(db, "flowExecutions");
            if (flowId) execs = execs.filter((e) => String(e.flowId) === String(flowId));
            if (contactId) execs = execs.filter((e) => String(e.contactId) === String(contactId));
            if (filterStatus) execs = execs.filter((e) => e.status === filterStatus);
            execs = execs.sort((a, b) => {
              const ta = a.startedAt instanceof Date ? a.startedAt.getTime() : new Date(a.startedAt || 0).getTime();
              const tb = b.startedAt instanceof Date ? b.startedAt.getTime() : new Date(b.startedAt || 0).getTime();
              return tb - ta;
            });
            if (limit) execs = execs.slice(0, Number(limit));
            sendResponse({ success: true, executions: execs, total: execs.length });
          } finally {
            db?.close();
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err), executions: [] });
        }
      })();
      return true;
    case "CRM_START_FLOW":
      (async () => {
        try {
          const { flowId, phone, contactName } = message.payload || {};
          if (!flowId || !phone) {
            sendResponse({ success: false, error: "flowId and phone are required" });
            return;
          }
          const contact = await findContactByPhone(phone);
          if (!contact?.id) {
            sendResponse({ success: false, error: "Contact not found for phone: " + phone });
            return;
          }
          const execId = await createFlowExecution(flowId, contact.id, contactName || contact.name);
          sendResponse({ success: !!execId, executionId: execId });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_LIST_TEMPLATES":
      (async () => {
        try {
          const templates = await getTemplates();
          sendResponse({ success: true, templates, total: templates.length });
        } catch (err) {
          sendResponse({ success: false, error: String(err), templates: [] });
        }
      })();
      return true;
    case "CRM_CREATE_TEMPLATE":
      (async () => {
        try {
          const { title, content, category, shortcut } = message.payload || {};
          if (!title || !content) {
            sendResponse({ success: false, error: "title and content are required" });
            return;
          }
          const id = await addTemplate({ title, content, category, shortcut });
          sendResponse({ success: !!id, templateId: id });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_GET_STATS":
      (async () => {
        try {
          const db = await openCrmDb();
          try {
            const [contacts, campaigns, flows, flowExecs, messages] = await Promise.all([
              readAllFromStore(db, "contacts"),
              readAllFromStore(db, "campaigns"),
              readAllFromStore(db, "flows"),
              readAllFromStore(db, "flowExecutions"),
              readAllFromStore(db, "messages")
            ]);
            const activeFlows = flows.filter((f) => f.isActive);
            const runningExecs = flowExecs.filter((e) => e.status === "running" || e.status === "pending");
            const today = /* @__PURE__ */ new Date();
            today.setHours(0, 0, 0, 0);
            const todayMessages = messages.filter((m) => {
              const ts = m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp || 0);
              return ts >= today;
            });
            const activeCampaigns = campaigns.filter((c) => c.status === "running" || c.status === "active");
            sendResponse({
              success: true,
              stats: {
                totalContacts: contacts.length,
                totalCampaigns: campaigns.length,
                activeCampaigns: activeCampaigns.length,
                totalFlows: flows.length,
                activeFlows: activeFlows.length,
                runningFlowExecutions: runningExecs.length,
                totalFlowExecutions: flowExecs.length,
                totalMessages: messages.length,
                messagesToday: todayMessages.length
              }
            });
          } finally {
            db?.close();
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    case "CRM_GET_CONTACT_MESSAGES":
      (async () => {
        try {
          const { phone, limit } = message.payload || {};
          if (!phone) {
            sendResponse({ success: false, error: "phone is required", messages: [] });
            return;
          }
          const contact = await findContactByPhone(phone);
          if (!contact?.id) {
            sendResponse({ success: true, messages: [], total: 0 });
            return;
          }
          const db = await openCrmDb();
          try {
            const allMessages = await readAllFromStore(db, "messages");
            let msgs = allMessages.filter((m) => m.contactId === contact.id);
            msgs = msgs.sort((a, b) => {
              const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp || 0).getTime();
              const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp || 0).getTime();
              return tb - ta;
            });
            if (limit) msgs = msgs.slice(0, Number(limit));
            sendResponse({
              success: true,
              messages: msgs.map((m) => ({
                id: m.id,
                content: m.content,
                direction: m.direction,
                timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp || null,
                isAIGenerated: m.isAIGenerated
              })),
              total: msgs.length
            });
          } finally {
            db?.close();
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err), messages: [] });
        }
      })();
      return true;
    case "CRM_LIST_SCHEDULED_MESSAGES":
      (async () => {
        try {
          const { phone, status: filterStatus, limit } = message.payload || {};
          const db = await openCrmDb();
          try {
            let msgs = await readAllFromStore(db, "scheduledMessages");
            if (phone) {
              const suffix = phone.replace(/\D/g, "").slice(-9);
              msgs = msgs.filter((m) => {
                const mSuffix = String(m.contactPhone || "").replace(/\D/g, "").slice(-9);
                return mSuffix === suffix;
              });
            }
            if (filterStatus) msgs = msgs.filter((m) => m.status === filterStatus);
            msgs = msgs.sort((a, b) => {
              const ta = a.scheduledAt instanceof Date ? a.scheduledAt.getTime() : new Date(a.scheduledAt || 0).getTime();
              const tb = b.scheduledAt instanceof Date ? b.scheduledAt.getTime() : new Date(b.scheduledAt || 0).getTime();
              return ta - tb;
            });
            if (limit) msgs = msgs.slice(0, Number(limit));
            sendResponse({
              success: true,
              scheduledMessages: msgs.map((m) => ({
                id: m.id,
                contactPhone: m.contactPhone,
                message: m.message,
                status: m.status,
                scheduledAt: m.scheduledAt instanceof Date ? m.scheduledAt.toISOString() : m.scheduledAt || null
              })),
              total: msgs.length
            });
          } finally {
            db?.close();
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err), scheduledMessages: [] });
        }
      })();
      return true;
    case "CRM_LIST_KNOWLEDGE_BASE":
      (async () => {
        try {
          const db = await openCrmDb();
          try {
            const items = await readAllFromStore(db, "knowledgeBase");
            sendResponse({
              success: true,
              items: items.map((item) => ({
                id: item.id,
                type: item.type,
                title: item.title || "",
                content: (item.content || "").substring(0, 500),
                createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt || null
              })),
              total: items.length
            });
          } finally {
            db?.close();
          }
        } catch (err) {
          sendResponse({ success: false, error: String(err), items: [] });
        }
      })();
      return true;
    default:
      // WAM_* (plans & licensing) are answered by license.js.
      if (typeof message.type === "string" && message.type.startsWith("WAM_")) return false;
      sendResponse({ error: "Unknown message type" });
  }
  return true;
});
chrome.alarms.create("keepAlive", { periodInMinutes: 0.5 });
chrome.alarms.create("flowConditionCheck", { periodInMinutes: 1 });
chrome.alarms.create("calendarNotificationCheck", { periodInMinutes: 1 });
// Wakes the bulk sender in the WhatsApp tab so long delays keep firing while that tab is in the background.
chrome.alarms.create("downlabsBulkTick", { periodInMinutes: 0.5 });
for (const legacyAlarm of ["flushPendingSyncs", "extensionVersionCheck", "platformAiDefaults"]) {
  chrome.alarms.clear(legacyAlarm);
}
processCalendarNotificationsInBackground().catch((error) => {
  console.warn("[Background] Initial calendar notification check failed:", error);
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "keepAlive") return;
  if (alarm.name === "downlabsBulkTick") {
    const { downlabsBulkIndex: bulkIds = [], downlabsBulkJob: legacyJob } = await chrome.storage.local.get(["downlabsBulkIndex", "downlabsBulkJob"]);
    if (!bulkIds.length && !legacyJob) return;
    for (const tab of await chrome.tabs.query({ url: "https://web.whatsapp.com/*" })) {
      chrome.tabs.sendMessage(tab.id, { type: "DL_BULK_TICK" }).catch(() => {
      });
    }
    return;
  }
  if (alarm.name === "calendarNotificationCheck") {
    await processCalendarNotificationsInBackground();
    return;
  }
  if (alarm.name === "flowConditionCheck") {
    console.log("[Background] ⏰ Checking flow conditions...");
    try {
      const crmTabsFlow = await chrome.tabs.query({ url: chrome.runtime.getURL("*") });
      for (const tab of crmTabsFlow) {
        if (tab.id) {
          try {
            await chrome.tabs.sendMessage(tab.id, { type: "CHECK_FLOW_CONDITIONS" });
            console.log("[Background] Sent CHECK_FLOW_CONDITIONS to tab:", tab.id);
          } catch (e) {
          }
        }
      }
    } catch (error) {
      console.error("[Background] Error checking flow conditions:", error);
    }
    return;
  }
  if (alarm.name.startsWith("flow-execution-")) {
    const executionId = parseInt(alarm.name.replace("flow-execution-", ""));
    console.log("[Background] ⏰ Flow execution alarm triggered:", executionId);
    try {
      const crmTabsExec = await chrome.tabs.query({ url: chrome.runtime.getURL("*") });
      for (const tab of crmTabsExec) {
        if (tab.id) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "CONTINUE_FLOW_EXECUTION",
              executionId
            });
          } catch (e) {
          }
        }
      }
    } catch (error) {
      console.error("[Background] Error handling flow execution alarm:", error);
    }
    return;
  }
  if (alarm.name.startsWith("pending-flow-")) {
    const executionId = parseInt(alarm.name.replace("pending-flow-", ""));
    console.log("[Background] ⏰ Pending flow execution alarm triggered:", executionId);
    try {
      const crmTabsPending = await chrome.tabs.query({ url: chrome.runtime.getURL("*") });
      let notified = false;
      for (const tab of crmTabsPending) {
        if (tab.id) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "START_PENDING_FLOW_EXECUTION",
              executionId
            });
            notified = true;
            console.log("[Background] ✅ Sent START_PENDING_FLOW_EXECUTION to tab:", tab.id);
          } catch (e) {
          }
        }
      }
      if (!notified) {
        console.log("[Background] ℹ️ No CRM tabs open, storing pending start request");
        const result = await chrome.storage.local.get(["pendingFlowStarts"]);
        const starts = result.pendingFlowStarts || [];
        starts.push({
          executionId,
          triggeredAt: Date.now()
        });
        await chrome.storage.local.set({ pendingFlowStarts: starts });
      }
      await pushToAppNotificationFeed("flow_started", "Flow Started", "A scheduled flow is now running.");
      if (chrome.notifications) {
        chrome.notifications.create(`flow-started-${executionId}`, {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "Flow Started",
          message: "A scheduled flow is now running.",
          priority: 2
        });
      }
    } catch (error) {
      console.error("[Background] Error handling pending flow alarm:", error);
    }
    return;
  }
  if (alarm.name.startsWith("campaign-")) {
    const campaignId = alarm.name.replace("campaign-", "");
    console.log("[Background] ⏰ Scheduled campaign alarm triggered:", campaignId);
    try {
      const result = await chrome.storage.local.get(["scheduledCampaignStarts"]);
      const starts = result.scheduledCampaignStarts || [];
      starts.push({
        campaignId,
        triggeredAt: Date.now()
      });
      await chrome.storage.local.set({ scheduledCampaignStarts: starts });
      console.log("[Background] 📋 Campaign start scheduled:", campaignId);
      await pushToAppNotificationFeed("campaign_started", "Campaign Started", "A scheduled campaign has started sending messages.");
      const crmTabs = await chrome.tabs.query({ url: chrome.runtime.getURL("*") });
      for (const tab of crmTabs) {
        if (tab.id) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "START_SCHEDULED_CAMPAIGN",
              campaignId
            });
          } catch (e) {
          }
        }
      }
      if (chrome.notifications) {
        chrome.notifications.create(`campaign-started-${campaignId}`, {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "Campaign Started",
          message: "A scheduled campaign has started sending messages.",
          priority: 2
        });
      }
    } catch (error) {
      console.error("[Background] Error handling campaign alarm:", error);
    }
  }
});
async function decryptWhatsAppMedia(encBuffer, mediaKeyB64, mediaType) {
  const infoStrings = {
    audio: "WhatsApp Audio Keys",
    image: "WhatsApp Image Keys"
  };
  const mediaKeyStr = atob(mediaKeyB64);
  const mediaKey = new Uint8Array(mediaKeyStr.length);
  for (let i = 0; i < mediaKeyStr.length; i++) {
    mediaKey[i] = mediaKeyStr.charCodeAt(i);
  }
  const salt = new Uint8Array(32);
  const info = new TextEncoder().encode(infoStrings[mediaType]);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    mediaKey,
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    keyMaterial,
    112 * 8
  );
  const derived = new Uint8Array(derivedBits);
  const iv = derived.slice(0, 16);
  const cipherKey = derived.slice(16, 48);
  const encData = new Uint8Array(encBuffer, 0, encBuffer.byteLength - 10);
  const aesKey = await crypto.subtle.importKey(
    "raw",
    cipherKey,
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  return crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, encData);
}
async function decryptWhatsAppImage(encBuffer, mediaKeyB64) {
  return decryptWhatsAppMedia(encBuffer, mediaKeyB64, "image");
}
async function decryptWhatsAppAudio(encBuffer, mediaKeyB64) {
  const mediaKeyStr = atob(mediaKeyB64);
  const mediaKey = new Uint8Array(mediaKeyStr.length);
  for (let i = 0; i < mediaKeyStr.length; i++) {
    mediaKey[i] = mediaKeyStr.charCodeAt(i);
  }
  const salt = new Uint8Array(32);
  const info = new TextEncoder().encode("WhatsApp Audio Keys");
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    mediaKey,
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info
    },
    keyMaterial,
    112 * 8
    // bits
  );
  const derived = new Uint8Array(derivedBits);
  const iv = derived.slice(0, 16);
  const cipherKey = derived.slice(16, 48);
  const encData = new Uint8Array(encBuffer, 0, encBuffer.byteLength - 10);
  const aesKey = await crypto.subtle.importKey(
    "raw",
    cipherKey,
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv },
    aesKey,
    encData
  );
  return decrypted;
}
