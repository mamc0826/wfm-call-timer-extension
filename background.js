// WFM Call Timer - Background Service Worker v2.6
// Added: Multi-block daily schedules, today-only override, calendar color coding
// Added: Data migration from v2.5 format

const DEFAULTS = {
  schedule: {
    "0": { work: false, blocks: [] },
    "1": { work: true,  blocks: [{start: "08:00", end: "16:30"}] },
    "2": { work: true,  blocks: [{start: "08:00", end: "16:30"}] },
    "3": { work: false, blocks: [] },
    "4": { work: false, blocks: [] },
    "5": { work: true,  blocks: [{start: "08:00", end: "16:30"}] },
    "6": { work: false, blocks: [] },
  },
  exchangeRate: 17.50,
  staticMinRate: 0.14,
  otToday: false,
  shiftEnded: false,
  workshiftActive: false,
  localTzOffset: -6,
  companyTzOffset: -4,
  wfmStatus: "ready",
  onCall: false,
  callStartWall: null,
  callStartMono: null,
  calls: [],
  todayDate: null,
  currencyDisplay: "both",
  history: {},
  // NEW: Today-only schedule override (cleared daily)
  todayOverride: null,  // Format: { blocks: [{start:"08:00", end:"10:00"}, ...] }
  // NEW: Version tracking for migrations
  dataVersion: "2.6",
  // NEW: debounce timestamp for the "call detected but blocked" notification
  lastBlockedNotifyTs: null
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n) { return n.toString().padStart(2, "0"); }

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function getDayKey() {
  return String(new Date().getDay());
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function isWithinBlocks(blocks) {
  if (!blocks || blocks.length === 0) return false;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const block of blocks) {
    const startMin = timeToMinutes(block.start);
    const endMin = timeToMinutes(block.end);
    if (startMin <= nowMin && nowMin <= endMin) return true;
  }
  return false;
}

function isTodayActive(state) {
  // OT always wins: if you've flagged today as overtime, you're active
  // no matter what a Today override's specific time block says. This is
  // the guaranteed escape hatch so a narrow custom block can never
  // silently trap an OT session.
  if (state.otToday) return true;

  // Check today override next
  if (state.todayOverride && state.todayOverride.blocks && state.todayOverride.blocks.length > 0) {
    return isWithinBlocks(state.todayOverride.blocks);
  }
  const entry = state.schedule[getDayKey()];
  if (!entry) return false;
  if (state.shiftEnded) return false;
  return entry.work && isWithinBlocks(entry.blocks);
}

function totalDuration(state) {
  let past = state.calls.reduce((s, c) => s + c.duration, 0);
  let cur = (state.onCall && state.callStartMono) ? Math.floor((Date.now() - state.callStartMono) / 1000) : 0;
  return past + cur;
}

function currentDuration(state) {
  if (!state.onCall || !state.callStartMono) return 0;
  return Math.floor((Date.now() - state.callStartMono) / 1000);
}

// ===== MIGRATION HELPERS =====
function migrateSchedule(oldSchedule) {
  // Convert old format {work, start, end} to new format {work, blocks: [{start, end}]}
  const newSchedule = {};
  for (let i = 0; i < 7; i++) {
    const key = String(i);
    const old = oldSchedule ? oldSchedule[key] : null;
    if (!old) {
      newSchedule[key] = { work: false, blocks: [] };
      continue;
    }
    // Already in new format?
    if (old.blocks && Array.isArray(old.blocks)) {
      newSchedule[key] = { work: old.work, blocks: old.blocks };
      continue;
    }
    // Old format: convert single block
    if (old.work && old.start && old.end) {
      newSchedule[key] = { work: true, blocks: [{start: old.start, end: old.end}] };
    } else {
      newSchedule[key] = { work: false, blocks: [] };
    }
  }
  return newSchedule;
}

function migrateState(storedState) {
  if (!storedState) return { ...DEFAULTS };

  let state = { ...DEFAULTS, ...storedState };

  // Migrate schedule from old format
  if (state.schedule && !state.dataVersion) {
    console.log('[WFM] Migrating schedule from v2.5 format to v2.6 multi-block format');
    state.schedule = migrateSchedule(state.schedule);
  }

  // Ensure all schedule entries have blocks array
  for (let i = 0; i < 7; i++) {
    const key = String(i);
    if (!state.schedule[key]) {
      state.schedule[key] = { work: false, blocks: [] };
    } else if (!state.schedule[key].blocks) {
      // Single block old format still lingering
      const old = state.schedule[key];
      if (old.work && old.start && old.end) {
        state.schedule[key] = { work: true, blocks: [{start: old.start, end: old.end}] };
      } else {
        state.schedule[key] = { work: false, blocks: [] };
      }
    }
  }

  // Ensure todayOverride exists
  if (!state.todayOverride) state.todayOverride = null;

  // Ensure dataVersion
  state.dataVersion = "2.6";

  return state;
}

// ===== STATE MANAGEMENT =====
async function loadState() {
  try {
    const stored = await chrome.storage.local.get("wfmState");
    let state = stored.wfmState ? migrateState(stored.wfmState) : { ...DEFAULTS };
    const today = getTodayKey();

    // Reset daily stats
    if (state.todayDate !== today) {
      // Save yesterday's data to history before resetting
      if (state.todayDate && state.calls.length > 0) {
        saveDayToHistory(state, state.todayDate);
      }
      state.calls = []; 
      state.otToday = false; 
      state.shiftEnded = false;
      state.workshiftActive = false;
      state.todayDate = today; 
      state.onCall = false;
      state.callStartWall = null; 
      state.callStartMono = null; 
      state.wfmStatus = "ready";
      // NEW: Clear today override on new day
      state.todayOverride = null;
      await saveState(state);
      console.log('[WFM] New day detected, stats reset + today override cleared');
    }

    if (!state.schedule || typeof state.schedule !== 'object') {
      state.schedule = DEFAULTS.schedule;
    }
    if (!Array.isArray(state.calls)) {
      state.calls = [];
    }
    if (!state.history) {
      state.history = {};
    }
    if (!state.currencyDisplay) {
      state.currencyDisplay = "both";
    }

    return state;
  } catch (e) {
    console.error('[WFM] loadState error:', e);
    return { ...DEFAULTS };
  }
}

async function saveState(state) {
  try {
    await chrome.storage.local.set({ wfmState: state });
  } catch (e) {
    console.error('[WFM] saveState error:', e);
  }
}

// ===== HISTORY FUNCTIONS =====
function saveDayToHistory(state, dateKey) {
  if (!state.history) state.history = {};
  const totalDur = state.calls.reduce((s, c) => s + c.duration, 0);
  const earnings = (totalDur / 60) * state.staticMinRate;
  state.history[dateKey] = {
    calls: [...state.calls],
    totalDuration: totalDur,
    totalEarnings: earnings,
    callCount: state.calls.length
  };
  console.log('[WFM] Saved to history:', dateKey, state.calls.length, 'calls');
}

function getDayHistory(state, dateKey) {
  if (state.history && state.history[dateKey]) {
    return state.history[dateKey];
  }
  // Check if it's today
  if (dateKey === state.todayDate) {
    const totalDur = state.calls.reduce((s, c) => s + c.duration, 0);
    const earnings = (totalDur / 60) * state.staticMinRate;
    return {
      calls: [...state.calls],
      totalDuration: totalDur,
      totalEarnings: earnings,
      callCount: state.calls.length
    };
  }
  return null;
}

function addCallToHistory(state, dateKey, startTime, endTime) {
  if (!state.history) state.history = {};
  if (!state.history[dateKey]) {
    state.history[dateKey] = { calls: [], totalDuration: 0, totalEarnings: 0, callCount: 0 };
  }

  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const duration = (endMin - startMin) * 60; // in seconds

  const now = new Date();
  const baseTs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const call = {
    startTs: baseTs + startMin * 60000,
    endTs: baseTs + endMin * 60000,
    duration: duration
  };

  state.history[dateKey].calls.push(call);
  state.history[dateKey].totalDuration += duration;
  state.history[dateKey].totalEarnings = (state.history[dateKey].totalDuration / 60) * state.staticMinRate;
  state.history[dateKey].callCount = state.history[dateKey].calls.length;

  return state.history[dateKey];
}

function deleteCallFromHistory(state, dateKey, callIndex) {
  if (!state.history || !state.history[dateKey]) return null;
  const day = state.history[dateKey];
  if (callIndex < 0 || callIndex >= day.calls.length) return null;

  const removed = day.calls.splice(callIndex, 1)[0];
  day.totalDuration -= removed.duration;
  day.totalEarnings = (day.totalDuration / 60) * state.staticMinRate;
  day.callCount = day.calls.length;

  return day;
}

// ===== BADGE =====
async function updateBadge(state) {
  try {
    const mins = Math.floor(currentDuration(state) / 60);
    let text, color;
    if (!state.workshiftActive) { text = "OFF"; color = "#64748b"; }
    else if (state.shiftEnded) { text = "END"; color = "#ef4444"; }
    else if (state.onCall) { text = String(mins); color = "#4ade80"; }
    else if (state.wfmStatus === "wrapup") { text = "WRP"; color = "#f97316"; }
    else if (state.wfmStatus === "not_ready") { text = "BRK"; color = "#fbbf24"; }
    else { text = "RDY"; color = "#64748b"; }
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch (e) {
    console.error('[WFM] updateBadge error:', e);
  }
}

// ===== WORKSHIFT CONTROLS =====
async function beginWorkshift() {
  const state = await loadState();
  state.workshiftActive = true;
  state.shiftEnded = false;
  state.wfmStatus = "ready";
  await saveState(state);
  await updateBadge(state);
  console.log('[WFM] Workshift BEGIN');
  return state;
}

async function endWorkshift() {
  const state = await loadState();
  if (state.onCall) {
    const duration = Math.floor((Date.now() - state.callStartMono) / 1000);
    state.calls.push({ startTs: state.callStartWall, endTs: Date.now(), duration });
    state.onCall = false; 
    state.callStartWall = null; 
    state.callStartMono = null;
  }
  state.workshiftActive = false;
  state.shiftEnded = true;
  state.wfmStatus = "not_ready";
  await saveState(state);
  await updateBadge(state);
  console.log('[WFM] Workshift END');
  return state;
}

// ===== ACTIONS =====
// Returns { state, blocked } where blocked is null on success, or a short
// reason code the popup can turn into a visible toast so a failed start
// is never silent again.
async function startCall() {
  const state = await loadState();
  if (state.onCall) return { state, blocked: "already_on_call" };
  if (!state.workshiftActive) return { state, blocked: "no_workshift" };
  if (!isTodayActive(state)) return { state, blocked: "outside_schedule" };
  state.onCall = true;
  state.callStartWall = Date.now();
  state.callStartMono = Date.now();
  state.wfmStatus = "ready";
  await saveState(state);
  await updateBadge(state);
  console.log('[WFM] Call started');
  return { state, blocked: null };
}

async function endCall() {
  const state = await loadState();
  if (!state.onCall || !state.callStartMono) return state;
  const duration = Math.floor((Date.now() - state.callStartMono) / 1000);
  state.calls.push({ startTs: state.callStartWall, endTs: Date.now(), duration });
  state.onCall = false; 
  state.callStartWall = null; 
  state.callStartMono = null;
  await saveState(state);
  await updateBadge(state);
  console.log('[WFM] Call ended, duration:', duration, 's');
  return state;
}

async function setStatus(status) {
  const state = await loadState();
  if (state.onCall && status === "not_ready") { 
    await endCall(); 
    state = await loadState(); 
  }
  state.wfmStatus = status;
  await saveState(state);
  await updateBadge(state);
  return state;
}

async function toggleOT() {
  const state = await loadState();
  state.otToday = !state.otToday;
  // When toggling OT, also clear today override so OT takes full control
  if (state.otToday) {
    state.todayOverride = null;
  }
  await saveState(state);
  await updateBadge(state);
  console.log('[WFM] OT toggled:', state.otToday);
  return state;
}

async function endShift() {
  const state = await loadState();
  if (state.onCall) {
    const duration = Math.floor((Date.now() - state.callStartMono) / 1000);
    state.calls.push({ startTs: state.callStartWall, endTs: Date.now(), duration });
    state.onCall = false; 
    state.callStartWall = null; 
    state.callStartMono = null;
  }
  state.shiftEnded = true; 
  state.wfmStatus = "not_ready";
  await saveState(state);
  await updateBadge(state);
  console.log('[WFM] Shift ended');
  return state;
}

async function resumeShift() {
  const state = await loadState();
  state.shiftEnded = false; 
  state.otToday = true; 
  state.wfmStatus = "ready";
  await saveState(state);
  await updateBadge(state);
  console.log('[WFM] Shift resumed (OT)');
  return state;
}

// NEW: Set today's override schedule
async function setTodayOverride(blocks) {
  const state = await loadState();
  state.todayOverride = { blocks: blocks };
  // Disable OT when using custom schedule
  state.otToday = false;
  state.shiftEnded = false;
  await saveState(state);
  await updateBadge(state);
  console.log('[WFM] Today override set:', blocks.length, 'blocks');
  return state;
}

// NEW: Clear today's override
async function clearTodayOverride() {
  const state = await loadState();
  state.todayOverride = null;
  await saveState(state);
  console.log('[WFM] Today override cleared');
  return state;
}

// ===== ALARMS =====
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tick") {
    try {
      const state = await loadState();
      await updateBadge(state);
    } catch (e) {
      console.error('[WFM] Alarm error:', e);
    }
  }
});

// ===== MESSAGE HANDLER =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      let state;
      switch (msg.type) {
        case "GET_STATE": 
          state = await loadState(); 
          sendResponse({ state }); 
          break;
        case "BEGIN_WORKSHIFT": 
          state = await beginWorkshift(); 
          sendResponse({ state }); 
          break;
        case "END_WORKSHIFT": 
          state = await endWorkshift(); 
          sendResponse({ state }); 
          break;
        case "START_CALL": {
          const result = await startCall();
          sendResponse({ state: result.state, blocked: result.blocked });
          break;
        }
        case "END_CALL": 
          state = await endCall(); 
          sendResponse({ state }); 
          break;
        case "SET_STATUS": 
          state = await setStatus(msg.status); 
          sendResponse({ state }); 
          break;
        case "TOGGLE_OT": 
          state = await toggleOT(); 
          sendResponse({ state }); 
          break;
        case "END_SHIFT": 
          state = await endShift(); 
          sendResponse({ state }); 
          break;
        case "RESUME_SHIFT": 
          state = await resumeShift(); 
          sendResponse({ state }); 
          break;
        // NEW: Today override messages
        case "SET_TODAY_OVERRIDE":
          state = await setTodayOverride(msg.blocks);
          sendResponse({ state });
          break;
        case "CLEAR_TODAY_OVERRIDE":
          state = await clearTodayOverride();
          sendResponse({ state });
          break;
        case "SAVE_CONFIG":
          state = await loadState();
          if (msg.schedule) state.schedule = msg.schedule;
          if (msg.exchangeRate !== undefined) state.exchangeRate = msg.exchangeRate;
          if (msg.staticMinRate !== undefined) state.staticMinRate = msg.staticMinRate;
          if (msg.localTzOffset !== undefined) state.localTzOffset = msg.localTzOffset;
          if (msg.companyTzOffset !== undefined) state.companyTzOffset = msg.companyTzOffset;
          if (msg.currencyDisplay !== undefined) state.currencyDisplay = msg.currencyDisplay;
          await saveState(state);
          sendResponse({ state });
          break;
        case "EXPORT_CSV":
          state = await loadState();
          const rows = [["start","end","duration","value_usd","value_mxn"], ...state.calls.map(c => {
            const s = new Date(c.startTs).toLocaleTimeString("en-US", {hour12:false, hour:"2-digit", minute:"2-digit"});
            const e = new Date(c.endTs).toLocaleTimeString("en-US", {hour12:false, hour:"2-digit", minute:"2-digit"});
            const usd = (c.duration/60)*state.staticMinRate;
            const mxn = usd * state.exchangeRate;
            return [s, e, c.duration, usd.toFixed(2), mxn.toFixed(2)];
          })];
          sendResponse({ csv: rows.map(r => r.join(",")).join("\n") });
          break;
        // HISTORY API
        case "GET_HISTORY":
          state = await loadState();
          const dayData = getDayHistory(state, msg.dateKey);
          sendResponse({ dayData, dateKey: msg.dateKey });
          break;
        case "ADD_CALL":
          state = await loadState();
          const added = addCallToHistory(state, msg.dateKey, msg.startTime, msg.endTime);
          if (msg.dateKey === state.todayDate && added) {
            const lastCall = added.calls[added.calls.length - 1];
            state.calls.push(lastCall);
          }
          await saveState(state);
          sendResponse({ dayData: added, state });
          break;
        case "DELETE_CALL":
          state = await loadState();
          const deleted = deleteCallFromHistory(state, msg.dateKey, msg.callIndex);
          if (msg.dateKey === state.todayDate && deleted) {
            state.calls.splice(msg.callIndex, 1);
          }
          await saveState(state);
          sendResponse({ dayData: deleted, state });
          break;
        case "GET_MONTH_HISTORY":
          state = await loadState();
          const year = msg.year;
          const month = msg.month;
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const monthData = {};
          for (let d = 1; d <= daysInMonth; d++) {
            const dk = `${year}-${pad2(month+1)}-${pad2(d)}`;
            const hd = getDayHistory(state, dk);
            if (hd && hd.callCount > 0) {
              monthData[dk] = hd;
            }
          }
          sendResponse({ monthData, year, month });
          break;
        // CONTENT SCRIPTS
        case "CONTENT_CALL_DETECTED":
          state = await loadState();
          if (state.workshiftActive && !state.onCall && isTodayActive(state) && state.wfmStatus === "ready") {
            const result = await startCall();
            state = result.state;
          } else if (state.workshiftActive && !state.onCall) {
            // A call was detected but something is blocking the timer from
            // starting. Notify once every 5 minutes instead of failing silently.
            const now = Date.now();
            if (!state.lastBlockedNotifyTs || now - state.lastBlockedNotifyTs > 5 * 60 * 1000) {
              state.lastBlockedNotifyTs = now;
              await saveState(state);
              const reason = !isTodayActive(state)
                ? "Outside your scheduled work window — check Today's Schedule or toggle OT."
                : `Status is "${state.wfmStatus}", so the timer isn't tracking this call.`;
              chrome.notifications?.create?.({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'WFM Call Timer: call not being tracked',
                message: reason,
                priority: 2
              });
            }
          }
          sendResponse({ ok: true, workshiftActive: state.workshiftActive });
          break;
        case "CONTENT_CALL_ENDED":
          state = await loadState();
          if (state.onCall) await endCall();
          sendResponse({ ok: true });
          break;
        case "CONTENT_BREAK_DETECTED":
          state = await loadState();
          if (state.workshiftActive && !state.onCall && state.wfmStatus !== "not_ready") {
            state.wfmStatus = "not_ready"; 
            await saveState(state); 
            await updateBadge(state);
          }
          sendResponse({ ok: true });
          break;
        case "CONTENT_READY_DETECTED":
          state = await loadState();
          if (state.workshiftActive && !state.onCall && state.wfmStatus === "not_ready") {
            state.wfmStatus = "ready"; 
            await saveState(state); 
            await updateBadge(state);
          }
          sendResponse({ ok: true });
          break;
        case "CONTENT_WRAPUP_DETECTED":
          state = await loadState();
          if (state.onCall) {
            const d = Math.floor((Date.now() - state.callStartMono) / 1000);
            state.calls.push({ startTs: state.callStartWall, endTs: Date.now(), duration: d });
            state.onCall = false; 
            state.callStartWall = null; 
            state.callStartMono = null;
          }
          state.wfmStatus = "wrapup"; 
          await saveState(state); 
          await updateBadge(state);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ error: "Unknown message type" });
      }
    } catch (e) {
      console.error('[WFM] Message handler error:', e);
      sendResponse({ error: e.message });
    }
  })();
  return true;
});

// ===== KEYBOARD SHORTCUTS =====
chrome.commands.onCommand.addListener(async (command) => {
  try {
    switch (command) {
      case "toggle-call": { 
        const s = await loadState(); 
        if (s.onCall) await endCall(); 
        else {
          const result = await startCall();
          if (result.blocked) {
            chrome.notifications?.create?.({
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: 'WFM Call Timer',
              message: result.blocked === "outside_schedule"
                ? "Outside your scheduled work window — check Today's Schedule or toggle OT."
                : result.blocked === "no_workshift"
                ? "Begin your workshift first."
                : "Already on a call.",
              priority: 1
            });
          }
        }
        break; 
      }
      case "set-not-ready": await setStatus("not_ready"); break;
      case "set-ready": await setStatus("ready"); break;
    }
  } catch (e) {
    console.error('[WFM] Command error:', e);
  }
});

// ===== DATA MIGRATION / PRESERVATION ON UPDATE =====
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await chrome.alarms.create("tick", { periodInMinutes: 0.5 });

    const stored = await chrome.storage.local.get("wfmState");

    if (details.reason === "update") {
      console.log('[WFM] Extension updated from', details.previousVersion, 'to', chrome.runtime.getManifest().version);

      if (stored.wfmState) {
        // Preserve existing data while migrating to new format
        const mergedState = migrateState(stored.wfmState);

        // Ensure history object exists
        if (!mergedState.history) {
          mergedState.history = {};
        }
        // Ensure currencyDisplay exists
        if (!mergedState.currencyDisplay) {
          mergedState.currencyDisplay = "both";
        }
        // Ensure today's calls are preserved
        if (!mergedState.calls) {
          mergedState.calls = [];
        }
        // Ensure todayOverride exists
        if (!mergedState.todayOverride) {
          mergedState.todayOverride = null;
        }

        await chrome.storage.local.set({ wfmState: mergedState });
        console.log('[WFM] Data migrated successfully. History entries:', Object.keys(mergedState.history || {}).length);

        // Show notification about update
        chrome.notifications?.create?.({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'WFM Call Timer Updated',
          message: 'Multi-block schedules & calendar colors added. Your history is preserved.',
          priority: 1
        });
      }
    } else if (details.reason === "install") {
      console.log('[WFM] Extension installed v2.6');
      await loadState();
    } else if (details.reason === "chrome_update") {
      console.log('[WFM] Chrome updated, extension reloaded');
      if (stored.wfmState) {
        const mergedState = migrateState(stored.wfmState);
        await chrome.storage.local.set({ wfmState: mergedState });
      }
    }

    console.log('[WFM] Extension installed/updated v2.6');
  } catch (e) {
    console.error('[WFM] Install/update error:', e);
  }
});

