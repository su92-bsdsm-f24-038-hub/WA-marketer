import{bB as T,bC as I,d as b,bD as A,by as O}from"./index-CqxXB6Pu.js";const w=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],f="calendar-booking-instructions",k="Calendar Booking Instructions";async function g(e){var s,i,p;const o=await T(),c=e.workingDays.map(a=>w[a]).join(", "),d=[0,1,2,3,4,5,6].filter(a=>!e.workingDays.includes(a)).map(a=>w[a]).join(", "),l=e.breakTimes.length>0?e.breakTimes.map(a=>`${a.start} - ${a.end}`).join(", "):"No breaks configured";let n="";if(e.resourcesEnabled&&e.resourceTypes&&e.resourceTypes.length>0){n=`
RESOURCE INFORMATION (Multi-Resource Booking Enabled):
`;for(const a of e.resourceTypes){const y=(e.resourceItems||[]).filter(t=>t.typeId===a.id&&t.isActive);if(y.length>0){n+=`
${a.name.toUpperCase()} (${a.variable}):
`,n+=`- Description: ${a.description}
`,n+=`- Required: ${a.required?"Yes, must select before booking":"Optional"}
`,n+=`- Available:
`;for(const t of y)n+=`  * ${t.name}`,t.description&&(n+=` - ${t.description}`),t.services&&t.services.length>0&&(n+=` (Services: ${t.services.join(", ")})`),n+=`
`}}n+=`
When handling bookings with resources:
`,n+=`- Ask which resource the customer prefers if not specified
`,n+=`- Check availability for the specific resource
`,n+=`- Mention that different resources may have different availability
`,n+=`- If preferred resource is not available, suggest alternatives
`}const u=`
You are a business assistant helping to create booking instructions for an AI chatbot.

BUSINESS INFORMATION:
- Business Name: ${e.businessName||"Not specified"}
- Business Type: ${e.serviceType||"General"}
- Description: ${e.businessDescription||"Not provided"}
- Services: ${e.servicesOffered||"Not specified"}
- Price Range: ${e.priceRange||"Not specified"}
- Phone: ${e.businessPhone||"Not provided"}
- Address: ${e.businessAddress||"Not provided"}

SCHEDULE INFORMATION:
- Working Days: ${c}
- Non-Working Days: ${d||"None"}
- Working Hours: ${e.workingHoursStart} - ${e.workingHoursEnd}
- Appointment Duration: ${e.slotDuration} minutes
- Buffer Between Appointments: ${e.bufferBetweenSlots} minutes
- Break Times: ${l}
- Advance Booking Limit: ${e.advanceBookingDays} days
${n}
AI SETTINGS:
- Tone: ${e.aiTone||"friendly"}
- Custom Greeting: ${e.aiGreeting||"Not specified"}
- Custom Instructions: ${e.customInstructions||"None"}

IMPORTANT: You must include these EXACT placeholders in your instructions (they will be replaced with real-time data):
- {{HOLIDAYS}} - List of current holidays (dates when business is closed)
- {{BOOKED_SLOTS_TODAY}} - Today's already booked time slots
- {{BOOKED_SLOTS_TOMORROW}} - Tomorrow's already booked time slots  
- {{NEXT_AVAILABLE_SLOT}} - The nearest available time slot

Create detailed, comprehensive instructions for a chatbot that handles appointment bookings. The instructions should cover:

1. How to greet customers asking about appointments or availability
2. How to explain working hours, days, and services
3. How to check and present available time slots${e.resourcesEnabled?`
4. How to ask about and handle resource preferences (which specialist/table/etc.)`:""}
${e.resourcesEnabled?"5":"4"}. How to handle requests for weekends/non-working days (explain they're closed and suggest alternatives)
${e.resourcesEnabled?"6":"5"}. How to handle holiday inquiries (use {{HOLIDAYS}} placeholder)
${e.resourcesEnabled?"7":"6"}. How to handle fully booked times (suggest {{NEXT_AVAILABLE_SLOT}})
${e.resourcesEnabled?"8":"7"}. How to confirm a booking${e.resourcesEnabled?" including the selected resource":""}
${e.resourcesEnabled?"9":"8"}. How to handle cancellation requests
${e.resourcesEnabled?"10":"9"}. How to provide business contact info if asked

Write the instructions in a clear, structured format that the AI can follow. Use the ${e.aiTone||"friendly"} tone.
The response should be in the same language as the business description or services if provided, otherwise use English.
`,h=(p=(i=(s=(await I({model:o.model||"gpt-4o-mini",messages:[{role:"system",content:"You are an expert at creating clear, actionable instructions for AI chatbots. Create detailed booking instructions that are easy for an AI to follow."},{role:"user",content:u}],temperature:.7,max_completion_tokens:2e3})).choices[0])==null?void 0:s.message)==null?void 0:i.content)==null?void 0:p.trim();if(!h)throw new Error("Failed to generate instructions - empty response");return`
═══════════════════════════════════════════════════════════════
📅 CALENDAR BOOKING INSTRUCTIONS
Business: ${e.businessName||"Not specified"}
Generated: ${new Date().toLocaleString()}
═══════════════════════════════════════════════════════════════

${h}

═══════════════════════════════════════════════════════════════
DYNAMIC DATA (Updated in real-time):
═══════════════════════════════════════════════════════════════

HOLIDAYS (days when we are closed):
{{HOLIDAYS}}

TODAY'S BOOKED SLOTS:
{{BOOKED_SLOTS_TODAY}}

TOMORROW'S BOOKED SLOTS:
{{BOOKED_SLOTS_TOMORROW}}

NEXT AVAILABLE SLOT:
{{NEXT_AVAILABLE_SLOT}}

═══════════════════════════════════════════════════════════════
`}const S="https://local.downlabs.invalid/api";async function N(e,o){var m,h;const c=await b.knowledgeBase.get(f),d=o.resourcesEnabled&&o.resourceTypes?{enabled:!0,types:o.resourceTypes.map(r=>({name:r.name,variable:r.variable,description:r.description,required:r.required,items:(o.resourceItems||[]).filter(s=>s.typeId===r.id&&s.isActive).map(s=>({name:s.name,description:s.description,services:s.services}))}))}:{enabled:!1},l={company_name:o.businessName,business_type:o.serviceType,business_type_ru:v(o.serviceType),description:o.businessDescription,services:E(o.servicesOffered),pricing:o.priceRange?{general:o.priceRange}:void 0,working_hours:D(o),phone:o.businessPhone,address:o.businessAddress,booking:{enabled:!0,instructions:e,slot_duration:o.slotDuration,advance_days:o.advanceBookingDays,resources:d},_calendarInstructions:!0,_rawInstructions:e},n={id:f,title:k,type:"text",source:`Calendar booking instructions for ${o.businessName||"business"}`,createdAt:(c==null?void 0:c.createdAt)||new Date,extractedData:l};console.log("[aiInstructionGenerator] Saving to IndexedDB with ID:",f),console.log("[aiInstructionGenerator] Entry:",n),await b.knowledgeBase.put(n);const u=await b.knowledgeBase.get(f);if(console.log("[aiInstructionGenerator] Verified saved entry:",u?"OK":"NOT FOUND"),u&&console.log("[aiInstructionGenerator] Saved entry ID:",u.id,"Title:",u.title),typeof chrome<"u"&&((m=chrome.storage)!=null&&m.local))try{const r=await b.knowledgeBase.toArray();await chrome.storage.local.set({knowledgeBase:r})}catch(r){console.warn("[aiInstructionGenerator] Failed to sync to chrome.storage:",r)}try{const r=await A(),s=await O();if(r&&s){console.log("[aiInstructionGenerator] Syncing to backend...");const i=await fetch(`${S}/knowledge/direct`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${r}`},body:JSON.stringify({workspaceId:s,id:f,title:k,type:"calendar",source:`Calendar booking instructions for ${o.businessName||"business"}`,extractedData:l})});if(i.ok){const p=await i.json();console.log("[aiInstructionGenerator] ✅ Synced to backend:",(h=p.knowledgeBase)==null?void 0:h.id)}else{const p=await i.json().catch(()=>({}));console.warn("[aiInstructionGenerator] Backend sync failed:",p.error||i.status)}}else console.log("[aiInstructionGenerator] Not authenticated, skipping backend sync")}catch(r){console.warn("[aiInstructionGenerator] Failed to sync to backend:",r)}return f}function v(e){return{salon:"Салон красоты / Барбершоп",dental:"Стоматология",medical:"Медицинская клиника",consultation:"Консультационные услуги",fitness:"Фитнес / Спортзал",restaurant:"Ресторан / Кафе",spa:"СПА / Массаж",education:"Образование / Репетиторство",auto:"Автосервис",other:"Другое"}[e||""]||e||""}function E(e){return e?e.split(/[,\n]/).map(o=>o.trim()).filter(o=>o.length>0):[]}function D(e){const o={};return["sun","mon","tue","wed","thu","fri","sat"].forEach((d,l)=>{e.workingDays.includes(l)?o[d]=`${e.workingHoursStart} - ${e.workingHoursEnd}`:o[d]="Closed"}),o}export{g as generateCalendarAIInstructions,N as saveToKnowledgeBase};
