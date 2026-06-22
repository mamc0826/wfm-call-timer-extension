// WFM Call Timer - Background Service Worker v2.5
// Added: Historical data storage, call editing, calendar support, currency preference

const DEFAULTS = {
  schedule: {
    "0": { work: false, start: "", end: "" },
    "1": { work: true,  start: "08:00", end: "16:30" },
    "2": { work: true,  start: "08:00", end: "16:30" },
    "3": { work: false, start: "", end: "" },
    "4": { work: false, start: "", end: "" },
    "5": { work: true,  start: "08:00", end: "16:30" },
    "6": { work: false, start: "", end: "" },
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
  // NEW: Currency display preference ("usd", "mxn", "both")
  currencyDisplay: "both",
  // NEW: Historical data storage
  history: {},  // Format: "2026-06-15": { calls: [...], totalDuration: 0, totalEarnings: 0 }
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

function isWithinHours(entry) {
  if (!entry || !entry.work) return false;
  const now = new Date();
  const [sh, sm] = entry.start.split(":").map(Number);
  const [eh, em] = entry.end.split(":").map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return (sh * 60 + sm) <= nowMin && nowMin <= (eh * 60 + em);
}

function isTodayActive(state) {
  const entry = state.schedule[getDayKey()];
  if (!entry) return false;
  if (state.otToday) return true;
  if (state.shiftEnded) return false;
  return isWithinHours(entry);
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

// ===== STATE MANAGEMENT =====
async function loadState() {
  try {
    const stored = await chrome.storage.local.get("wfmState");
    let state = stored.wfmState ? { ...DEFAULTS, ...stored.wfmState } : { ...DEFAULTS };
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
      await saveState(state);
      console.log('[WFM] New day detected, stats reset');
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
    // Ensure currencyDisplay has a value
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

// ===== HISTORY FUNCTIONS (NEW) =====
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
async function startCall() {
  const state = await loadState();
  if (state.onCall || !isTodayActive(state)) return state;
  state.onCall = true;
  state.callStartWall = Date.now();
  state.callStartMono = Date.now();
  state.wfmStatus = "ready";
  await saveState(state);
  await updateBadge(state);
  console.log('[WFM] Call started');
  return state;
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
        case "START_CALL": 
          state = await startCall(); 
          sendResponse({ state }); 
          break;
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
        // HISTORY API (NEW)
        case "GET_HISTORY":
          state = await loadState();
          const dayData = getDayHistory(state, msg.dateKey);
          sendResponse({ dayData, dateKey: msg.dateKey });
          break;
        case "ADD_CALL":
          state = await loadState();
          const added = addCallToHistory(state, msg.dateKey, msg.startTime, msg.endTime);
          // If adding to today, also sync state.calls so main UI reflects it
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
          // If deleting from today, also sync state.calls so main UI reflects it
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
            await startCall();
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
        else await startCall(); 
        break; 
      }
      case "set-not-ready": await setStatus("not_ready"); break;
      case "set-ready": await setStatus("ready"); break;
    }
  } catch (e) {
    console.error('[WFM] Command error:', e);
  }
});

// ===== INSTALL =====
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.alarms.create("tick", { periodInMinutes: 0.5 });
    await loadState();
    console.log('[WFM] Extension installed/updated v2.5');
  } catch (e) {
    console.error('[WFM] Install error:', e);
  }
});

console.log('[WFM] Background service worker loaded v2.5');

