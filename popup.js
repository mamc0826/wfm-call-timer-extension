// ============================================================
// WFM CALL TIMER - POPUP SCRIPT (v2.5)
// Features: Workshift gating, Calendar history, Call editing, Currency preference
// ============================================================

// ===== STATE =====
let currentState = null;
let isInitialized = false;
let calendarDate = new Date();
let selectedDateKey = null;
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const CAL_DAY_NAMES = ["S","M","T","W","T","F","S"];

// ===== UTILITIES =====
function pad2(n) { return n.toString().padStart(2,"0"); }

function fmtTime(s) {
  var h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return h + ':' + pad2(m) + ':' + pad2(sec);
}

function fmtShortTime(s) {
  var h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return h + ':' + pad2(m);
}

function fmtCurrency(n) {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function getDateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
}

function parseDateKey(dk) {
  var parts = dk.split('-');
  return new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
}

// ===== CURRENCY HELPERS =====
function getCurrencyDisplay() {
  return currentState && currentState.currencyDisplay ? currentState.currencyDisplay : "both";
}

function fmtEarnings(usd, exchangeRate) {
  var mode = getCurrencyDisplay();
  var mxn = usd * exchangeRate;
  if (mode === "usd") return fmtCurrency(usd) + " USD";
  if (mode === "mxn") return fmtCurrency(mxn) + " MXN";
  return fmtCurrency(usd) + " USD / " + fmtCurrency(mxn) + " MXN";
}

function fmtEarningsShort(usd, exchangeRate) {
  var mode = getCurrencyDisplay();
  var mxn = usd * exchangeRate;
  if (mode === "usd") return fmtCurrency(usd);
  if (mode === "mxn") return fmtCurrency(mxn);
  return fmtCurrency(usd) + " / " + fmtCurrency(mxn);
}

function fmtEarningsLabel() {
  var mode = getCurrencyDisplay();
  if (mode === "usd") return "USD";
  if (mode === "mxn") return "MXN";
  return "USD / MXN";
}

// ===== TOAST =====
function showToast(message, type) {
  type = type || 'info';
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast ' + type;
  setTimeout(function() { toast.classList.add('show'); }, 10);
  setTimeout(function() { toast.classList.remove('show'); }, 2500);
}

// ===== MESSAGING =====
function sendMsg(msg) {
  return new Promise(function(resolve, reject) {
    try {
      chrome.runtime.sendMessage(msg, function(resp) {
        if (chrome.runtime.lastError) {
          console.warn('[WFM] Runtime error:', chrome.runtime.lastError.message);
          reject(chrome.runtime.lastError);
        } else {
          resolve(resp || {});
        }
      });
    } catch (e) {
      console.error('[WFM] Send message failed:', e);
      reject(e);
    }
  });
}

async function refreshState() {
  try {
    var resp = await sendMsg({type:"GET_STATE"});
    if (resp.state) {
      currentState = resp.state;
      updateUI(currentState);
      if (!isInitialized) {
        isInitialized = true;
        console.log('[WFM] State initialized');
      }
    }
  } catch (e) {
    console.error('[WFM] Failed to refresh state:', e);
  }
}

// ===== TIME CALCULATIONS =====
function totalDur(state) {
  if (!state) return 0;
  var past = state.calls.reduce(function(s,c){return s+c.duration;},0);
  var cur = (state.onCall && state.callStartMono) ? Math.floor((Date.now()-state.callStartMono)/1000) : 0;
  return past + cur;
}

function curDur(state) {
  if (!state || !state.onCall || !state.callStartMono) return 0;
  return Math.floor((Date.now()-state.callStartMono)/1000);
}

function isWithinHours(entry) {
  if (!entry || !entry.work) return false;
  var now = new Date();
  var p = entry.start.split(":").map(Number);
  var q = entry.end.split(":").map(Number);
  var nowMin = now.getHours()*60 + now.getMinutes();
  return (p[0]*60+p[1]) <= nowMin && nowMin <= (q[0]*60+q[1]);
}

// ===== UI UPDATE =====
function updateUI(state) {
  if (!state) return;
  currentState = state;

  // Workshift bar
  var wsBar = document.getElementById("workshiftBar");
  var wsText = document.getElementById("workshiftText");
  var wsSub = document.getElementById("workshiftSub");
  var btnBegin = document.getElementById("btnBeginWorkshift");
  var btnEnd = document.getElementById("btnEndWorkshift");

  if (wsBar && wsText && wsSub && btnBegin && btnEnd) {
    if (!state.workshiftActive) {
      wsBar.className = "workshift-bar inactive";
      wsText.textContent = "⏸ Workshift Not Started";
      wsSub.textContent = "Press Begin to enable auto-detection";
      btnBegin.style.display = "inline-block";
      btnEnd.style.display = "none";
    } else if (state.shiftEnded) {
      wsBar.className = "workshift-bar ended";
      wsText.textContent = "⏹ Workshift Ended";
      wsSub.textContent = "Auto-detection disabled — History available";
      btnBegin.style.display = "none";
      btnEnd.style.display = "none";
    } else {
      wsBar.className = "workshift-bar";
      wsText.textContent = "▶ Workshift Active";
      wsSub.textContent = "Auto-detection running — monitoring softphone";
      btnBegin.style.display = "none";
      btnEnd.style.display = "inline-block";
    }
  }

  var dur = curDur(state);
  var elTimer = document.getElementById("timerDisplay");
  if (elTimer) elTimer.textContent = fmtTime(dur);

  var elSub = document.getElementById("timerSub");
  if (elSub) {
    if (!state.workshiftActive) {
      elSub.textContent = "Press Begin Workshift to start tracking";
    } else if (state.onCall && state.callStartWall) {
      var ts = new Date(state.callStartWall).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
      elSub.textContent = "Active — Started at " + ts;
    } else if (state.calls.length > 0) {
      var last = state.calls[state.calls.length-1];
      elSub.textContent = "Last call: " + fmtTime(last.duration);
    } else {
      elSub.textContent = "Ready to track calls";
    }
  }

  var elStart = document.getElementById("btnStart");
  var elEnd = document.getElementById("btnEnd");
  if (elStart) elStart.disabled = !state.workshiftActive || state.onCall || state.shiftEnded;
  if (elEnd) elEnd.disabled = !state.onCall;

  var elDot = document.getElementById("statusDot");
  var elStatus = document.getElementById("statusText");
  if (elDot && elStatus) {
    if (!state.workshiftActive) {
      elDot.style.background = "var(--muted)";
      elStatus.textContent = "● OFF DUTY";
      elStatus.style.color = "var(--muted)";
    }
    else if (state.shiftEnded) { 
      elDot.style.background = "#ef4444"; 
      elStatus.textContent = "● SHIFT ENDED"; 
      elStatus.style.color = "#ef4444"; 
    }
    else if (state.onCall) { 
      elDot.style.background = "var(--accent)"; 
      elStatus.textContent = "● ON CALL"; 
      elStatus.style.color = "var(--accent)"; 
    }
    else if (state.wfmStatus === "wrapup") { 
      elDot.style.background = "#f97316"; 
      elStatus.textContent = "● WRAP-UP"; 
      elStatus.style.color = "#f97316"; 
    }
    else if (state.wfmStatus === "not_ready") { 
      elDot.style.background = "var(--amber)"; 
      elStatus.textContent = "● ON BREAK"; 
      elStatus.style.color = "var(--amber)"; 
    }
    else { 
      elDot.style.background = "var(--green)"; 
      elStatus.textContent = "● READY"; 
      elStatus.style.color = "var(--green)"; 
    }
  }

  // Currency-aware mini earnings display
  var miniUSD = document.getElementById("miniUSD");
  var miniMXN = document.getElementById("miniMXN");
  var miniLabelUSD = document.getElementById("miniLabelUSD");
  var miniLabelMXN = document.getElementById("miniLabelMXN");
  if (miniUSD && miniMXN) {
    var usd = (totalDur(state)/60) * state.staticMinRate;
    var mxn = usd * state.exchangeRate;
    var mode = getCurrencyDisplay();

    if (mode === "usd") {
      miniUSD.textContent = fmtCurrency(usd) + " USD";
      miniUSD.style.display = "inline";
      miniMXN.style.display = "none";
      if (miniLabelUSD) miniLabelUSD.textContent = "Earnings:";
      if (miniLabelMXN) miniLabelMXN.style.display = "none";
    } else if (mode === "mxn") {
      miniUSD.style.display = "none";
      miniMXN.textContent = fmtCurrency(mxn) + " MXN";
      miniMXN.style.display = "inline";
      if (miniLabelUSD) miniLabelUSD.style.display = "none";
      if (miniLabelMXN) { miniLabelMXN.style.display = "inline"; miniLabelMXN.textContent = "Earnings:"; }
    } else {
      miniUSD.textContent = fmtCurrency(usd) + " USD";
      miniMXN.textContent = fmtCurrency(mxn) + " MXN";
      miniUSD.style.display = "inline";
      miniMXN.style.display = "inline";
      if (miniLabelUSD) { miniLabelUSD.style.display = "inline"; miniLabelUSD.textContent = "USD:"; }
      if (miniLabelMXN) { miniLabelMXN.style.display = "inline"; miniLabelMXN.textContent = "MXN:"; }
    }
  }

  var dayKey = String(new Date().getDay());
  var dayData = state.schedule[dayKey];
  var dayName = DAY_NAMES[parseInt(dayKey)];
  var elSched = document.getElementById("scheduleText");
  var elSchedDot = document.getElementById("schedDot");
  var elOT = document.getElementById("btnOT");

  if (elSched && elOT) {
    if (state.shiftEnded) {
      elSched.textContent = dayName + " — Shift Ended";
      elSched.style.color = "#ef4444";
      if (elSchedDot) elSchedDot.style.background = "#ef4444";
      elOT.style.display = "none";
    } else if (dayData && dayData.work && isWithinHours(dayData)) {
      elSched.textContent = dayName + " On Duty: " + dayData.start + " – " + dayData.end;
      elSched.style.color = "var(--green)";
      if (elSchedDot) elSchedDot.style.background = "var(--green)";
      elOT.style.display = "none";
    } else {
      if (state.otToday) {
        elSched.textContent = dayName + " — OT Mode Active";
        elSched.style.color = "var(--amber)";
        if (elSchedDot) elSchedDot.style.background = "var(--amber)";
        elOT.textContent = "Drop OT";
      } else {
        var reason = (dayData && dayData.work) ? "Off Duty" : "Rest Day";
        elSched.textContent = dayName + " — " + reason;
        elSched.style.color = "var(--muted)";
        if (elSchedDot) elSchedDot.style.background = "var(--muted)";
        elOT.textContent = "Enable OT";
      }
      elOT.style.display = "inline-block";
    }
  }

  var elStats = document.getElementById("statsBar");
  if (elStats) {
    var tot = fmtTime(totalDur(state));
    var cnt = state.calls.length;
    var avg = (cnt > 0 || state.onCall) ? fmtTime(Math.floor(totalDur(state) / (cnt + (state.onCall?1:0)))) : "—";
    elStats.innerHTML = '<span>Total: ' + tot + '</span> | <span>Calls: ' + cnt + '</span> | <span>Avg: ' + avg + '</span>';
  }

  var elMic = document.getElementById("micStatus");
  if (elMic) {
    if (!state.workshiftActive) {
      elMic.textContent = "⚪ Workshift not started — Auto-detection disabled";
      elMic.style.color = "var(--muted)";
    }
    else if (state.shiftEnded) { 
      elMic.textContent = "🔴 Shift ended — History available below"; 
      elMic.style.color = "#ef4444"; 
    }
    else if (state.onCall) { 
      elMic.textContent = "🔴 On Call — Timer running"; 
      elMic.style.color = "var(--accent)"; 
    }
    else if (state.wfmStatus === "wrapup") { 
      elMic.textContent = "🟠 Wrap-Up — Finalizing notes"; 
      elMic.style.color = "#f97316"; 
    }
    else if (state.wfmStatus === "not_ready") { 
      elMic.textContent = "🟡 On Break"; 
      elMic.style.color = "var(--amber)"; 
    }
    else { 
      elMic.textContent = "🟢 Ready — Waiting for calls"; 
      elMic.style.color = "var(--green)"; 
    }
  }

  var elEndShift = document.getElementById("btnEndShift");
  var elResume = document.getElementById("btnResumeShift");
  if (elEndShift && elResume) {
    elEndShift.style.display = state.shiftEnded ? "none" : "block";
    elResume.style.display = state.shiftEnded ? "block" : "none";
  }
}

// ===== ACTIONS =====
async function doAction(type, extra) {
  var msg = {type: type};
  if (extra) Object.assign(msg, extra);
  try {
    var resp = await sendMsg(msg);
    if (resp.state) {
      updateUI(resp.state);
      return resp.state;
    }
  } catch (e) {
    console.error('[WFM] Action failed:', type, e);
    showToast('Action failed. Try again.', 'error');
  }
  return null;
}

// ===== MODALS =====
function openModal(id) {
  try {
    var m = document.getElementById(id);
    if (!m) {
      console.error('[WFM] Modal not found:', id);
      showToast('Error opening panel', 'error');
      return;
    }
    if (id === 'earningsModal') renderEarnings();
    if (id === 'scheduleModal') renderSchedule();
    if (id === 'settingsModal') renderSettings();
    if (id === 'historyModal') renderCalendar();

    m.classList.add('active');
    document.body.style.overflow = 'hidden';
  } catch (e) {
    console.error('[WFM] openModal error:', e);
    showToast('Error opening panel', 'error');
  }
}

function closeModal(id) {
  try {
    var m = document.getElementById(id);
    if (m) {
      m.classList.remove('active');
      document.body.style.overflow = '';
    }
  } catch (e) {
    console.error('[WFM] closeModal error:', e);
  }
}

function closeAllModals() {
  ['earningsModal', 'scheduleModal', 'settingsModal', 'historyModal'].forEach(function(id) {
    closeModal(id);
  });
}

// ===== CALENDAR / HISTORY (NEW) =====
function renderCalendar() {
  var grid = document.getElementById("calendarGrid");
  var monthYear = document.getElementById("calMonthYear");
  if (!grid || !monthYear) return;

  var year = calendarDate.getFullYear();
  var month = calendarDate.getMonth();
  var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  monthYear.textContent = monthNames[month] + " " + year;

  grid.innerHTML = "";

  // Day headers
  CAL_DAY_NAMES.forEach(function(d) {
    var div = document.createElement("div");
    div.className = "cal-day-header";
    div.textContent = d;
    grid.appendChild(div);
  });

  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var daysInPrevMonth = new Date(year, month, 0).getDate();
  var today = new Date();
  var todayKey = getDateKey(today);

  // Previous month padding
  for (var i = firstDay - 1; i >= 0; i--) {
    var dayNum = daysInPrevMonth - i;
    var div = createCalDay(year, month - 1, dayNum, true);
    grid.appendChild(div);
  }

  // Current month days
  for (var d = 1; d <= daysInMonth; d++) {
    var div = createCalDay(year, month, d, false);
    var dk = year + '-' + pad2(month+1) + '-' + pad2(d);
    if (dk === todayKey) div.classList.add("today");
    if (dk === selectedDateKey) div.classList.add("selected");
    grid.appendChild(div);
  }

  // Next month padding
  var remaining = (7 - ((firstDay + daysInMonth) % 7)) % 7;
  for (var j = 1; j <= remaining; j++) {
    var div = createCalDay(year, month + 1, j, true);
    grid.appendChild(div);
  }
}

function createCalDay(year, month, day, isOtherMonth) {
  var div = document.createElement("div");
  div.className = "cal-day" + (isOtherMonth ? " other-month" : "");

  var dk = year + '-' + pad2(month+1) + '-' + pad2(day);
  div.dataset.dateKey = dk;

  var num = document.createElement("span");
  num.className = "cal-day-num";
  num.textContent = day;
  div.appendChild(num);

  // Check for history data
  if (currentState && currentState.history && currentState.history[dk]) {
    var hd = currentState.history[dk];
    var earnings = document.createElement("span");
    earnings.className = "cal-day-earnings";
    // Show earnings based on currency preference
    earnings.textContent = fmtEarningsShort(hd.totalEarnings, currentState.exchangeRate);
    div.appendChild(earnings);

    var calls = document.createElement("span");
    calls.className = "cal-day-calls";
    calls.textContent = hd.callCount + " call" + (hd.callCount !== 1 ? "s" : "");
    div.appendChild(calls);

    var dot = document.createElement("span");
    dot.className = "cal-day-dot";
    div.appendChild(dot);
  } else if (dk === (currentState ? currentState.todayDate : "")) {
    // Today with current calls
    var curCalls = currentState ? currentState.calls.length : 0;
    if (curCalls > 0) {
      var earnings = document.createElement("span");
      earnings.className = "cal-day-earnings";
      var usd = (totalDur(currentState)/60) * currentState.staticMinRate;
      earnings.textContent = fmtEarningsShort(usd, currentState.exchangeRate);
      div.appendChild(earnings);

      var dot = document.createElement("span");
      dot.className = "cal-day-dot";
      div.appendChild(dot);
    }
  }

  div.addEventListener("click", function() {
    selectedDateKey = dk;
    renderCalendar();
    loadDayDetail(dk);
  });

  return div;
}

async function loadDayDetail(dateKey) {
  var panel = document.getElementById("dayDetailPanel");
  var title = document.getElementById("dayDetailTitle");
  var total = document.getElementById("dayDetailTotal");
  var statCalls = document.getElementById("dayStatCalls");
  var statDur = document.getElementById("dayStatDuration");
  var statEarn = document.getElementById("dayStatEarnings");
  var list = document.getElementById("dayCallsList");

  if (!panel) return;
  panel.style.display = "block";

  var d = parseDateKey(dateKey);
  var options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  title.textContent = d.toLocaleDateString('en-US', options);

  try {
    var resp = await sendMsg({type: "GET_HISTORY", dateKey: dateKey});
    var dayData = resp.dayData;

    if (!dayData || dayData.callCount === 0) {
      statCalls.textContent = "0";
      statDur.textContent = "0:00";
      statEarn.textContent = fmtEarningsShort(0, currentState.exchangeRate);
      list.innerHTML = '<div class="log-empty">No calls recorded for this day.</div>';
      total.textContent = "";
      return;
    }

    statCalls.textContent = dayData.callCount;
    statDur.textContent = fmtShortTime(dayData.totalDuration);
    statEarn.textContent = fmtEarningsShort(dayData.totalEarnings, currentState.exchangeRate);
    total.textContent = fmtEarnings(dayData.totalEarnings, currentState.exchangeRate) + " total";

    list.innerHTML = "";
    dayData.calls.forEach(function(c, i) {
      var item = document.createElement("div");
      item.className = "day-call-item";

      var start = new Date(c.startTs).toLocaleTimeString("en-US",{hour12:false,hour:"2-digit",minute:"2-digit"});
      var end = new Date(c.endTs).toLocaleTimeString("en-US",{hour12:false,hour:"2-digit",minute:"2-digit"});
      var usdVal = (c.duration/60)*currentState.staticMinRate;
      var valText = fmtEarningsShort(usdVal, currentState.exchangeRate);

      item.innerHTML = 
        '<span class="day-call-time">' + start + ' → ' + end + '</span>' +
        '<span class="day-call-dur">' + fmtTime(c.duration) + '</span>' +
        '<span class="day-call-val">' + valText + '</span>' +
        '<span class="day-call-actions">' +
          '<button class="call-action-btn delete" data-idx="' + i + '" title="Delete">🗑</button>' +
        '</span>';

      list.appendChild(item);
    });

    // Attach delete handlers
    list.querySelectorAll('.call-action-btn.delete').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(this.dataset.idx);
        deleteCall(dateKey, idx);
      });
    });

  } catch (e) {
    console.error('[WFM] Load day detail error:', e);
    list.innerHTML = '<div class="log-empty">Error loading data.</div>';
  }
}



async function refreshDayEarnings(dateKey) {
  var statEarn = document.getElementById("dayStatEarnings");
  var total = document.getElementById("dayDetailTotal");
  if (!statEarn || !currentState) return;

  try {
    var resp = await sendMsg({type: "GET_HISTORY", dateKey: dateKey});
    var dayData = resp.dayData;
    if (dayData) {
      statEarn.textContent = fmtEarningsShort(dayData.totalEarnings, currentState.exchangeRate);
      if (total) total.textContent = fmtEarnings(dayData.totalEarnings, currentState.exchangeRate) + " total";
      showToast("Earnings refreshed!", "success");
    }
  } catch (e) {
    showToast("Failed to refresh earnings", "error");
  }
}

async function deleteCall(dateKey, callIndex) {
  if (!confirm('Delete this call record?')) return;
  try {
    var resp = await sendMsg({type: "DELETE_CALL", dateKey: dateKey, callIndex: callIndex});
    if (resp.dayData) {
      showToast('Call deleted', 'success');
      loadDayDetail(dateKey);
      renderCalendar();
      await refreshState();
      // Refresh earnings modal if open
      var earnModal = document.getElementById("earningsModal");
      if (earnModal && earnModal.classList.contains("active")) {
        renderEarnings();
      }
    }
  } catch (e) {
    showToast('Failed to delete call', 'error');
  }
}

async function addCall(dateKey, startTime, endTime) {
  if (!startTime || !endTime) {
    showToast('Enter both start and end times', 'error');
    return;
  }
  var timeRe = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  if (!timeRe.test(startTime) || !timeRe.test(endTime)) {
    showToast('Use HH:MM format (e.g., 09:30)', 'error');
    return;
  }
  var p = startTime.split(':').map(Number);
  var q = endTime.split(':').map(Number);
  if (p[0]*60+p[1] >= q[0]*60+q[1]) {
    showToast('End time must be after start time', 'error');
    return;
  }

  try {
    var resp = await sendMsg({type: "ADD_CALL", dateKey: dateKey, startTime: startTime, endTime: endTime});
    if (resp.dayData) {
      showToast('Call added!', 'success');
      loadDayDetail(dateKey);
      renderCalendar();
      await refreshState();
      // Refresh earnings modal if open
      var earnModal = document.getElementById("earningsModal");
      if (earnModal && earnModal.classList.contains("active")) {
        renderEarnings();
      }
    }
  } catch (e) {
    showToast('Failed to add call', 'error');
  }
}

function changeMonth(delta) {
  calendarDate.setMonth(calendarDate.getMonth() + delta);
  renderCalendar();
  document.getElementById("dayDetailPanel").style.display = "none";
  selectedDateKey = null;
}

// ===== EARNINGS =====
function renderEarnings() {
  if (!currentState) return;
  var usd = (totalDur(currentState)/60) * currentState.staticMinRate;
  var mxn = usd * currentState.exchangeRate;
  var elU = document.getElementById("earningsUSD");
  var elM = document.getElementById("earningsMXN");
  var elFx = document.getElementById("fxRate");
  if (elU) elU.textContent = fmtCurrency(usd) + " USD";
  if (elM) elM.textContent = fmtCurrency(mxn) + " MXN";
  // Don't overwrite fxRate input - let user edit it freely
  // Only set initial value if empty
  if (elFx && !elFx.value) elFx.value = currentState.exchangeRate;

  var logBox = document.getElementById("logBox");
  if (logBox) {
    logBox.innerHTML = "";
    var calls = currentState.calls.slice().reverse();
    if (calls.length === 0) { 
      logBox.innerHTML = '<div class="log-empty">No calls recorded today.</div>'; 
    }
    else {
      calls.forEach(function(c, i) {
        var start = new Date(c.startTs).toLocaleTimeString("en-US",{hour12:false,hour:"2-digit",minute:"2-digit"});
        var end = new Date(c.endTs).toLocaleTimeString("en-US",{hour12:false,hour:"2-digit",minute:"2-digit"});
        var usdVal = (c.duration/60)*currentState.staticMinRate;
        var valText = fmtEarningsShort(usdVal, currentState.exchangeRate);
        var div = document.createElement("div");
        div.style.cssText = "padding:2px 0; border-bottom:1px solid var(--border);";
        div.textContent = "#" + (calls.length-i) + " [" + start + "→" + end + "] (" + fmtTime(c.duration) + ") → " + valText;
        logBox.appendChild(div);
      });
    }
  }
}

async function saveFx() {
  var rate = parseFloat(document.getElementById("fxRate").value);
  if (isNaN(rate) || rate <= 0) {
    showToast('Enter a valid exchange rate', 'error');
    return;
  }
  try {
    var resp = await sendMsg({type:"SAVE_CONFIG", exchangeRate: rate});
    if (resp.state) { 
      currentState = resp.state; 
      // Sync the settings modal input too (only if not currently focused)
      var settingsFx = document.getElementById("settingsFx");
      if (settingsFx && document.activeElement !== settingsFx) settingsFx.value = rate;
      renderEarnings();
      updateUI(currentState);
      showToast('Exchange rate saved!', 'success');
    }
  } catch (e) {
    showToast('Failed to save rate', 'error');
  }
}

async function exportCSV() {
  try {
    var resp = await sendMsg({type:"EXPORT_CSV"});
    if (resp.csv) {
      var blob = new Blob([resp.csv], {type:"text/csv"});
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "call_log_" + new Date().toISOString().split("T")[0] + ".csv";
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV exported!', 'success');
    }
  } catch (e) {
    showToast('Export failed', 'error');
  }
}

// ===== SCHEDULE =====
function renderSchedule() {
  var container = document.getElementById("scheduleTable");
  if (!container || !currentState) return;
  container.innerHTML = "";

  var header = document.createElement("div");
  header.className = "sched-row sched-header";
  header.innerHTML = '<label style="width:40px">Day</label><span style="width:24px;text-align:center">On</span><span style="width:65px;text-align:center">Start</span><span style="width:65px;text-align:center">End</span>';
  container.appendChild(header);

  DAY_NAMES.forEach(function(name, i) {
    var key = String(i);
    var entry = currentState.schedule[key] || {work:false, start:"", end:""};
    var row = document.createElement("div");
    row.className = "sched-row";
    row.innerHTML = '<label>' + name + '</label><input type="checkbox" class="sched-work" data-key="' + key + '"' + (entry.work?" checked":"") + '><input type="text" class="sched-start" data-key="' + key + '" value="' + entry.start + '" placeholder="HH:MM" maxlength="5"' + (entry.work?"":" disabled") + '><input type="text" class="sched-end" data-key="' + key + '" value="' + entry.end + '" placeholder="HH:MM" maxlength="5"' + (entry.work?"":" disabled") + '>';
    container.appendChild(row);
  });

  container.querySelectorAll('.sched-work').forEach(function(cb) {
    cb.addEventListener('change', function() {
      var key = this.dataset.key;
      var start = container.querySelector('.sched-start[data-key="' + key + '"]');
      var end = container.querySelector('.sched-end[data-key="' + key + '"]');
      if (start) start.disabled = !this.checked;
      if (end) end.disabled = !this.checked;
    });
  });

  var elRate = document.getElementById("rateInput");
  if (elRate) elRate.value = currentState.staticMinRate;
}

async function saveSchedule() {
  var newSchedule = {};
  var workEls = document.querySelectorAll(".sched-work");
  var startEls = document.querySelectorAll(".sched-start");
  var endEls = document.querySelectorAll(".sched-end");
  var valid = true;

  workEls.forEach(function(el, i) {
    var key = el.dataset.key;
    var work = el.checked;
    var start = startEls[i].value.trim();
    var end = endEls[i].value.trim();
    if (work) {
      var timeRe = /^([01]?\d|2[0-3]):([0-5]\d)$/;
      if (!timeRe.test(start) || !timeRe.test(end)) {
        showToast('Invalid time for ' + DAY_NAMES[i] + '. Use HH:MM.', 'error');
        valid = false; return;
      }
      var p = start.split(":").map(Number);
      var q = end.split(":").map(Number);
      if (p[0]*60+p[1] >= q[0]*60+q[1]) {
        showToast('Start must be before end for ' + DAY_NAMES[i] + '.', 'error');
        valid = false; return;
      }
    }
    newSchedule[key] = {work: work, start: start, end: end};
  });
  if (!valid) return;

  var rate = parseFloat(document.getElementById("rateInput").value);
  if (isNaN(rate) || rate <= 0) { 
    showToast('Enter a valid pay rate.', 'error'); 
    return; 
  }

  try {
    var resp = await sendMsg({type:"SAVE_CONFIG", schedule: newSchedule, staticMinRate: rate});
    if (resp.state) { 
      currentState = resp.state; 
      closeModal('scheduleModal'); 
      updateUI(currentState);
      showToast('Schedule saved!', 'success');
    }
  } catch (e) {
    showToast('Failed to save schedule', 'error');
  }
}

// ===== SETTINGS =====
function renderSettings() {
  if (!currentState) {
    console.warn('[WFM] Cannot render settings: state not loaded');
    return;
  }

  var elLocal = document.getElementById("localTzSelect");
  var elCompany = document.getElementById("companyTzSelect");
  var elRate = document.getElementById("settingsRate");
  var elFx = document.getElementById("settingsFx");
  var elCurrency = document.getElementById("currencyDisplaySelect");

  if (elLocal) elLocal.value = String(currentState.localTzOffset || -6);
  if (elCompany) elCompany.value = String(currentState.companyTzOffset || -4);
  if (elRate) elRate.value = currentState.staticMinRate;
  // Don't overwrite fxRate input - let user edit it freely
  // Only set initial value if empty
  if (elFx && !elFx.value) elFx.value = currentState.exchangeRate;
  if (elCurrency) elCurrency.value = currentState.currencyDisplay || "both";

  var sched = document.getElementById("settingsSchedule");
  if (!sched) return;

  sched.innerHTML = "";
  var header = document.createElement("div");
  header.className = "sched-row sched-header";
  header.innerHTML = '<label style="width:36px">Day</label><span style="width:20px;text-align:center">On</span><span style="width:60px;text-align:center">Start</span><span style="width:60px;text-align:center">End</span>';
  sched.appendChild(header);

  DAY_NAMES.forEach(function(name, i) {
    var key = String(i);
    var entry = currentState.schedule[key] || {work:false, start:"", end:""};
    var row = document.createElement("div");
    row.className = "sched-row";
    row.innerHTML = '<label>' + name + '</label><input type="checkbox" class="sett-work" data-key="' + key + '"' + (entry.work?" checked":"") + '><input type="text" class="sett-start" data-key="' + key + '" value="' + entry.start + '" placeholder="HH:MM" maxlength="5"' + (entry.work?"":" disabled") + '><input type="text" class="sett-end" data-key="' + key + '" value="' + entry.end + '" placeholder="HH:MM" maxlength="5"' + (entry.work?"":" disabled") + '>';
    sched.appendChild(row);
  });

  sched.querySelectorAll('.sett-work').forEach(function(cb) {
    cb.addEventListener('change', function() {
      var key = this.dataset.key;
      var start = sched.querySelector('.sett-start[data-key="' + key + '"]');
      var end = sched.querySelector('.sett-end[data-key="' + key + '"]');
      if (start) start.disabled = !this.checked;
      if (end) end.disabled = !this.checked;
    });
  });
}

async function saveSettings() {
  var newSchedule = {};
  var workEls = document.querySelectorAll(".sett-work");
  var startEls = document.querySelectorAll(".sett-start");
  var endEls = document.querySelectorAll(".sett-end");
  var valid = true;

  workEls.forEach(function(el, i) {
    var key = el.dataset.key;
    var work = el.checked;
    var start = startEls[i].value.trim();
    var end = endEls[i].value.trim();
    if (work) {
      var timeRe = /^([01]?\d|2[0-3]):([0-5]\d)$/;
      if (!timeRe.test(start) || !timeRe.test(end)) {
        showToast('Invalid time for ' + DAY_NAMES[i] + '. Use HH:MM.', 'error');
        valid = false; return;
      }
      var p = start.split(":").map(Number);
      var q = end.split(":").map(Number);
      if (p[0]*60+p[1] >= q[0]*60+q[1]) {
        showToast('Start must be before end for ' + DAY_NAMES[i] + '.', 'error');
        valid = false; return;
      }
    }
    newSchedule[key] = {work: work, start: start, end: end};
  });
  if (!valid) return;

  var rate = parseFloat(document.getElementById("settingsRate").value);
  var fx = parseFloat(document.getElementById("settingsFx").value);
  var localTz = parseFloat(document.getElementById("localTzSelect").value);
  var companyTz = parseFloat(document.getElementById("companyTzSelect").value);
  var currencyDisplay = document.getElementById("currencyDisplaySelect").value;

  if (isNaN(rate) || rate <= 0 || isNaN(fx) || fx <= 0) { 
    showToast('Enter valid positive numbers.', 'error'); 
    return; 
  }

  try {
    var resp = await sendMsg({
      type: "SAVE_CONFIG", 
      schedule: newSchedule, 
      staticMinRate: rate, 
      exchangeRate: fx, 
      localTzOffset: localTz, 
      companyTzOffset: companyTz,
      currencyDisplay: currencyDisplay
    });
    if (resp.state) { 
      currentState = resp.state; 
      // Sync the earnings modal input too (only if not currently focused)
      var fxRate = document.getElementById("fxRate");
      if (fxRate && document.activeElement !== fxRate) fxRate.value = currentState.exchangeRate;
      closeModal('settingsModal'); 
      updateUI(currentState);
      showToast('All settings saved!', 'success');
    }
  } catch (e) {
    showToast('Failed to save settings', 'error');
  }
}

// ===== CLOCK =====
(function() {
  function updateClock() {
    var now = new Date();
    var utc = now.getTime() + (now.getTimezoneOffset() * 60000);

    var cst = new Date(utc - 21600000);
    var ch = cst.getHours(), cm = cst.getMinutes();
    var campm = ch >= 12 ? 'PM' : 'AM';
    ch = ch % 12; ch = ch ? ch : 12;
    var el1 = document.getElementById('localTime');
    if (el1) el1.textContent = ch + ':' + (cm<10?'0':'') + cm + ' ' + campm + ' CST';

    var edt = new Date(utc - 14400000);
    var eh = edt.getHours(), em = edt.getMinutes();
    var eampm = eh >= 12 ? 'PM' : 'AM';
    eh = eh % 12; eh = eh ? eh : 12;
    var el2 = document.getElementById('easternTime');
    if (el2) el2.textContent = eh + ':' + (em<10?'0':'') + em + ' ' + eampm + ' EDT';
  }
  updateClock();
  setInterval(updateClock, 1000);
})();

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', function() {
  // Header buttons
  document.getElementById('btnHistoryIcon').addEventListener('click', function() { openModal('historyModal'); });
  document.getElementById('btnEarningsIcon').addEventListener('click', function() { openModal('earningsModal'); });
  document.getElementById('btnScheduleIcon').addEventListener('click', function() { openModal('scheduleModal'); });
  document.getElementById('btnSettingsIcon').addEventListener('click', function() { openModal('settingsModal'); });

  // Workshift buttons
  document.getElementById("btnBeginWorkshift").addEventListener("click", function() {
    doAction("BEGIN_WORKSHIFT").then(function(state) {
      if (state) showToast('Workshift started! Auto-detection enabled.', 'success');
    });
  });
  document.getElementById("btnEndWorkshift").addEventListener("click", function() {
    if (confirm("End your workshift? This will stop all auto-detection and end any active call.")) {
      doAction("END_WORKSHIFT").then(function(state) {
        if (state) showToast('Workshift ended. History is available.', 'info');
      });
    }
  });

  // Main controls
  document.getElementById("btnStart").addEventListener("click", function() { doAction("START_CALL"); });
  document.getElementById("btnEnd").addEventListener("click", function() { doAction("END_CALL"); });
  document.getElementById("btnBreak").addEventListener("click", function() { doAction("SET_STATUS", {status:"not_ready"}); });
  document.getElementById("btnReady").addEventListener("click", function() { doAction("SET_STATUS", {status:"ready"}); });
  document.getElementById("btnOT").addEventListener("click", function() { doAction("TOGGLE_OT"); });
  document.getElementById("btnEndShift").addEventListener("click", function() {
    if (confirm("End your shift for the day? You can resume later for overtime.")) doAction("END_SHIFT");
  });
  document.getElementById("btnResumeShift").addEventListener("click", function() { doAction("RESUME_SHIFT"); });

  // Calendar navigation
  document.getElementById("calPrevMonth").addEventListener("click", function() { changeMonth(-1); });
  document.getElementById("calNextMonth").addEventListener("click", function() { changeMonth(1); });

  // Time adjustment helpers
  function adjustTime(inputId, deltaMinutes) {
    var input = document.getElementById(inputId);
    var val = input.value;
    if (!val) { val = "06:00"; }
    var parts = val.split(':').map(Number);
    var totalMin = parts[0] * 60 + parts[1] + deltaMinutes;
    // Wrap around 24h
    totalMin = ((totalMin % 1440) + 1440) % 1440;
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    input.value = pad2(h) + ':' + pad2(m);
  }

  // Time control buttons
  document.getElementById("btnStartDown").addEventListener("click", function() {
    adjustTime("addCallStart", -30);
  });
  document.getElementById("btnStartUp").addEventListener("click", function() {
    adjustTime("addCallStart", 30);
  });
  document.getElementById("btnEndDown").addEventListener("click", function() {
    adjustTime("addCallEnd", -30);
  });
  document.getElementById("btnEndUp").addEventListener("click", function() {
    adjustTime("addCallEnd", 30);
  });

  // Add call form
  document.getElementById("btnAddCall").addEventListener("click", function() {
    var start = document.getElementById("addCallStart").value;
    var end = document.getElementById("addCallEnd").value;
    if (selectedDateKey) {
      addCall(selectedDateKey, start, end);
      // Reset to defaults after adding
      document.getElementById("addCallStart").value = "06:00";
      document.getElementById("addCallEnd").value = "07:00";
    }
  });

  // Refresh earnings button
  document.getElementById("btnRefreshEarnings").addEventListener("click", function() {
    if (selectedDateKey) {
      refreshDayEarnings(selectedDateKey);
    }
  });

  // Modal actions
  document.getElementById("btnSaveFx").addEventListener("click", saveFx);
  document.getElementById("btnExportCSV").addEventListener("click", exportCSV);
  document.getElementById("btnSaveSchedule").addEventListener("click", saveSchedule);
  document.getElementById("btnSaveSettings").addEventListener("click", saveSettings);

  // Modal close buttons
  document.querySelectorAll('.modal-close').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var modalId = this.getAttribute('data-modal');
      if (modalId) closeModal(modalId);
    });
  });

  // Modal backdrop click
  document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });

  // Keyboard
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  console.log("[WFM] Popup DOM ready, all listeners attached");
});

// ===== INIT =====
(async function() {
  console.log("[WFM] Popup initializing...");
  await refreshState();

  setInterval(async function() {
    try {
      var resp = await sendMsg({type:"GET_STATE"});
      if (resp.state) {
        currentState = resp.state;
        updateUI(resp.state);
        // Re-render earnings modal if open
        var earnModal = document.getElementById("earningsModal");
        if (earnModal && earnModal.classList.contains("active")) {
          renderEarnings();
        }
      }
    } catch (e) {
      // Silent fail on polling
    }
  }, 1000);

  console.log("[WFM] Popup ready");
})();

