// ============================================================
// WFM CALL TIMER - POPUP SCRIPT (v2.6)
// Features: Multi-block daily schedules, today override, calendar color coding
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

function timeToMinutes(timeStr) {
  var p = timeStr.split(":").map(Number);
  return p[0]*60 + p[1];
}

function isWithinBlocks(blocks) {
  if (!blocks || blocks.length === 0) return false;
  var now = new Date();
  var nowMin = now.getHours()*60 + now.getMinutes();
  for (var i = 0; i < blocks.length; i++) {
    var startMin = timeToMinutes(blocks[i].start);
    var endMin = timeToMinutes(blocks[i].end);
    if (startMin <= nowMin && nowMin <= endMin) return true;
  }
  return false;
}

function isTodayActive(state) {
  if (!state) return false;
  // Check today override first
  if (state.todayOverride && state.todayOverride.blocks && state.todayOverride.blocks.length > 0) {
    return isWithinBlocks(state.todayOverride.blocks);
  }
  var entry = state.schedule[getDayKey()];
  if (!entry) return false;
  if (state.otToday) return true;
  if (state.shiftEnded) return false;
  return entry.work && isWithinBlocks(entry.blocks);
}

function getDayKey() {
  return String(new Date().getDay());
}

function getBlockDurationHours(blocks) {
  if (!blocks || blocks.length === 0) return 0;
  var total = 0;
  for (var i = 0; i < blocks.length; i++) {
    total += (timeToMinutes(blocks[i].end) - timeToMinutes(blocks[i].start));
  }
  return total / 60;
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

  // Schedule bar - now supports multi-block display
  var dayKey = String(new Date().getDay());
  var dayData = state.schedule[dayKey];
  var dayName = DAY_NAMES[parseInt(dayKey)];
  var elSched = document.getElementById("scheduleText");
  var elSchedDot = document.getElementById("schedDot");
  var elOT = document.getElementById("btnOT");
  var elTodaySched = document.getElementById("todayScheduleBtn");

  if (elSched && elOT) {
    if (state.shiftEnded) {
      elSched.textContent = dayName + " — Shift Ended";
      elSched.style.color = "#ef4444";
      if (elSchedDot) elSchedDot.style.background = "#ef4444";
      elOT.style.display = "none";
      if (elTodaySched) elTodaySched.style.display = "none";
    } else if (state.todayOverride && state.todayOverride.blocks && state.todayOverride.blocks.length > 0) {
      // Today override active
      var overrideText = state.todayOverride.blocks.map(function(b) { return b.start + "–" + b.end; }).join(", ");
      elSched.textContent = dayName + " Custom: " + overrideText;
      elSched.style.color = "var(--accent)";
      if (elSchedDot) elSchedDot.style.background = "var(--accent)";
      elOT.style.display = "none";
      if (elTodaySched) elTodaySched.style.display = "inline-block";
    } else if (dayData && dayData.work && isWithinBlocks(dayData.blocks)) {
      var schedText = dayData.blocks.map(function(b) { return b.start + "–" + b.end; }).join(", ");
      elSched.textContent = dayName + " On Duty: " + schedText;
      elSched.style.color = "var(--green)";
      if (elSchedDot) elSchedDot.style.background = "var(--green)";
      elOT.style.display = "none";
      if (elTodaySched) elTodaySched.style.display = "inline-block";
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
      if (elTodaySched) elTodaySched.style.display = "inline-block";
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
    if (id === 'todayScheduleModal') renderTodaySchedule();

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
  ['earningsModal', 'scheduleModal', 'settingsModal', 'historyModal', 'todayScheduleModal'].forEach(function(id) {
    closeModal(id);
  });
}

// ===== CALENDAR COLOR CODING =====
function getDayHoursColor(hours) {
  // Red: < 3 hours (light work)
  // Yellow: 3-5 hours (moderate)
  // Green: >= 5 hours (heavy)
  if (hours >= 5) return 'green';
  if (hours >= 3) return 'yellow';
  return 'red';
}

function getDayHoursWorked(state, dateKey) {
  // Get hours from history or today's data
  var hours = 0;
  if (state.history && state.history[dateKey]) {
    hours = state.history[dateKey].totalDuration / 3600;
  }
  // Check if it's today
  if (dateKey === state.todayDate) {
    var todayHours = totalDur(state) / 3600;
    if (todayHours > hours) hours = todayHours;
  }
  return hours;
}

// ===== CALENDAR / HISTORY =====
function calculateMonthTotals(year, month) {
  if (!currentState || !currentState.history) return { totalUSD: 0, totalMXN: 0, totalCalls: 0, totalDuration: 0 };

  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var totalUSD = 0;
  var totalDuration = 0;
  var totalCalls = 0;

  for (var d = 1; d <= daysInMonth; d++) {
    var dk = year + '-' + pad2(month+1) + '-' + pad2(d);
    if (currentState.history[dk]) {
      totalUSD += currentState.history[dk].totalEarnings;
      totalDuration += currentState.history[dk].totalDuration;
      totalCalls += currentState.history[dk].callCount;
    }
  }

  // Also include today's data if we're viewing the current month
  var today = new Date();
  var todayKey = getDateKey(today);
  if (today.getFullYear() === year && today.getMonth() === month && currentState.todayDate === todayKey) {
    var todayUSD = (totalDur(currentState)/60) * currentState.staticMinRate;
    var todayDur = totalDur(currentState);
    var todayCalls = currentState.calls.length;
    totalUSD += todayUSD;
    totalDuration += todayDur;
    totalCalls += todayCalls;
  }

  var totalMXN = totalUSD * (currentState.exchangeRate || 17.50);

  return { totalUSD: totalUSD, totalMXN: totalMXN, totalCalls: totalCalls, totalDuration: totalDuration };
}

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

  // Render month totals at bottom
  renderMonthTotals(year, month);
}

function renderMonthTotals(year, month) {
  var totalsPanel = document.getElementById("monthTotalsPanel");
  var totalUSD = document.getElementById("monthTotalUSD");
  var totalMXN = document.getElementById("monthTotalMXN");
  var totalCalls = document.getElementById("monthTotalCalls");
  var totalDur = document.getElementById("monthTotalDuration");

  if (!totalsPanel) return;

  totalsPanel.style.display = "block";

  var totals = calculateMonthTotals(year, month);

  if (totalUSD) totalUSD.textContent = fmtCurrency(totals.totalUSD) + " USD";
  if (totalMXN) totalMXN.textContent = fmtCurrency(totals.totalMXN) + " MXN";
  if (totalCalls) totalCalls.textContent = totals.totalCalls;
  if (totalDur) totalDur.textContent = fmtShortTime(totals.totalDuration);
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

  // Color coding based on hours worked
  var hoursWorked = 0;
  var hasData = false;

  if (currentState) {
    hoursWorked = getDayHoursWorked(currentState, dk);
    if (hoursWorked > 0) hasData = true;
  }

  // Apply color coding class
  if (hasData && !isOtherMonth) {
    var colorCode = getDayHoursColor(hoursWorked);
    div.classList.add('cal-day-' + colorCode);
  }

  // Check for history data
  if (currentState && currentState.history && currentState.history[dk]) {
    var hd = currentState.history[dk];
    var earnings = document.createElement("span");
    earnings.className = "cal-day-earnings";
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
  var hoursBadge = document.getElementById("dayHoursBadge");

  if (!panel) return;
  panel.style.display = "block";

  var d = parseDateKey(dateKey);
  var options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  title.textContent = d.toLocaleDateString('en-US', options);

  try {
    var resp = await sendMsg({type: "GET_HISTORY", dateKey: dateKey});
    var dayData = resp.dayData;

    // Show hours badge
    if (hoursBadge) {
      var hours = 0;
      if (dayData) hours = dayData.totalDuration / 3600;
      if (dateKey === currentState.todayDate) {
        var todayHours = totalDur(currentState) / 3600;
        if (todayHours > hours) hours = todayHours;
      }
      var colorCode = getDayHoursColor(hours);
      var colorLabel = colorCode === 'green' ? 'Heavy Day' : (colorCode === 'yellow' ? 'Moderate' : 'Light Day');
      hoursBadge.className = 'day-hours-badge day-hours-' + colorCode;
      hoursBadge.textContent = hours.toFixed(1) + ' hrs — ' + colorLabel;
      hoursBadge.style.display = hours > 0 ? 'inline-block' : 'none';
    }

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
      renderMonthTotals(calendarDate.getFullYear(), calendarDate.getMonth());
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

// ===== TODAY SCHEDULE MODAL (NEW) =====
function renderTodaySchedule() {
  if (!currentState) return;
  var container = document.getElementById("todayBlocksContainer");
  if (!container) return;

  container.innerHTML = "";

  // Get current blocks: either from override or from regular schedule
  var dayKey = getDayKey();
  var scheduleEntry = currentState.schedule[dayKey];
  var blocks = [];

  if (currentState.todayOverride && currentState.todayOverride.blocks) {
    blocks = currentState.todayOverride.blocks;
  } else if (scheduleEntry && scheduleEntry.work && scheduleEntry.blocks) {
    blocks = scheduleEntry.blocks;
  }

  if (blocks.length === 0) {
    // Show empty state with hint
    container.innerHTML = '<div class="today-empty-hint">No work blocks set. Add your work periods below.</div>';
  }

  blocks.forEach(function(block, index) {
    addTodayBlockRow(block.start, block.end, index);
  });

  // Update the "Apply to recurring" checkbox state
  var recurringCheckbox = document.getElementById("applyToRecurring");
  if (recurringCheckbox) {
    recurringCheckbox.checked = false;
  }
}

function addTodayBlockRow(start, end, index) {
  var container = document.getElementById("todayBlocksContainer");
  if (!container) return;

  var row = document.createElement("div");
  row.className = "today-block-row";
  row.dataset.index = index;

  row.innerHTML = 
    '<div class="today-block-time">' +
      '<div class="time-input-group">' +
        '<span class="time-label">Start</span>' +
        '<input type="text" class="today-block-start" value="' + (start || "08:00") + '" maxlength="5" placeholder="HH:MM">' +
      '</div>' +
      '<span class="time-separator">→</span>' +
      '<div class="time-input-group">' +
        '<span class="time-label">End</span>' +
        '<input type="text" class="today-block-end" value="' + (end || "10:00") + '" maxlength="5" placeholder="HH:MM">' +
      '</div>' +
    '</div>' +
    '<button class="today-block-remove" title="Remove block">×</button>';

  container.appendChild(row);

  // Attach remove handler
  row.querySelector('.today-block-remove').addEventListener('click', function() {
    row.remove();
    reindexTodayBlocks();
  });
}

function reindexTodayBlocks() {
  var rows = document.querySelectorAll('.today-block-row');
  rows.forEach(function(row, i) {
    row.dataset.index = i;
  });
}

function getTodayBlocksFromUI() {
  var rows = document.querySelectorAll('.today-block-row');
  var blocks = [];
  var timeRe = /^([01]?\d|2[0-3]):([0-5]\d)$/;

  for (var i = 0; i < rows.length; i++) {
    var start = rows[i].querySelector('.today-block-start').value.trim();
    var end = rows[i].querySelector('.today-block-end').value.trim();

    if (!timeRe.test(start) || !timeRe.test(end)) {
      showToast('Invalid time in block ' + (i+1) + '. Use HH:MM.', 'error');
      return null;
    }

    var p = start.split(':').map(Number);
    var q = end.split(':').map(Number);
    if (p[0]*60+p[1] >= q[0]*60+q[1]) {
      showToast('End must be after start in block ' + (i+1), 'error');
      return null;
    }

    blocks.push({start: start, end: end});
  }

  return blocks;
}

async function saveTodaySchedule() {
  var blocks = getTodayBlocksFromUI();
  if (blocks === null) return; // validation failed

  var applyToRecurring = document.getElementById("applyToRecurring").checked;

  try {
    // Save as today override
    var resp = await sendMsg({type: "SET_TODAY_OVERRIDE", blocks: blocks});
    if (resp.state) {
      currentState = resp.state;

      // If user wants to save to recurring schedule too
      if (applyToRecurring && blocks.length > 0) {
        var dayKey = getDayKey();
        var newSchedule = JSON.parse(JSON.stringify(currentState.schedule));
        newSchedule[dayKey] = { work: true, blocks: blocks };

        var configResp = await sendMsg({type: "SAVE_CONFIG", schedule: newSchedule});
        if (configResp.state) {
          currentState = configResp.state;
        }
      }

      updateUI(currentState);
      closeModal('todayScheduleModal');
      showToast('Today\'s schedule saved! Auto-detection active during work blocks.', 'success');
    }
  } catch (e) {
    console.error('[WFM] Save today schedule error:', e);
    showToast('Failed to save schedule', 'error');
  }
}

async function clearTodayOverride() {
  try {
    var resp = await sendMsg({type: "CLEAR_TODAY_OVERRIDE"});
    if (resp.state) {
      currentState = resp.state;
      updateUI(currentState);
      closeModal('todayScheduleModal');
      showToast('Custom schedule cleared. Using regular schedule.', 'info');
    }
  } catch (e) {
    showToast('Failed to clear schedule', 'error');
  }
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
  if (elFx && document.activeElement !== elFx) elFx.value = currentState.exchangeRate;

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

// ===== SCHEDULE (Multi-block weekly) =====
function renderSchedule() {
  var container = document.getElementById("scheduleTable");
  if (!container || !currentState) return;
  container.innerHTML = "";

  var header = document.createElement("div");
  header.className = "sched-row sched-header";
  header.innerHTML = '<label style="width:40px">Day</label><span style="width:24px;text-align:center">On</span><span style="flex:1;text-align:center">Work Blocks</span>';
  container.appendChild(header);

  DAY_NAMES.forEach(function(name, i) {
    var key = String(i);
    var entry = currentState.schedule[key] || {work:false, blocks:[]};
    var row = document.createElement("div");
    row.className = "sched-row multi-block-row";
    row.dataset.day = key;

    var blocksHtml = '';
    if (entry.work && entry.blocks && entry.blocks.length > 0) {
      blocksHtml = entry.blocks.map(function(b, idx) {
        return '<span class="block-chip">' + b.start + '–' + b.end + '</span>';
      }).join('');
    } else {
      blocksHtml = '<span class="block-chip empty">No blocks</span>';
    }

    row.innerHTML = 
      '<label>' + name + '</label>' +
      '<input type="checkbox" class="sched-work" data-key="' + key + '"' + (entry.work?" checked":"") + '>' +
      '<div class="sched-blocks" data-key="' + key + '">' + blocksHtml + '</div>' +
      '<button class="btn-edit-blocks" data-key="' + key + '" title="Edit blocks">✎</button>';

    container.appendChild(row);
  });

  // Attach edit handlers
  container.querySelectorAll('.btn-edit-blocks').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var dayKey = this.dataset.key;
      openDayBlockEditor(dayKey);
    });
  });

  container.querySelectorAll('.sched-work').forEach(function(cb) {
    cb.addEventListener('change', function() {
      var key = this.dataset.key;
      var blocksDiv = container.querySelector('.sched-blocks[data-key="' + key + '"]');
      if (blocksDiv) {
        if (!this.checked) {
          blocksDiv.innerHTML = '<span class="block-chip empty">No blocks</span>';
        } else {
          // Enable default single block
          blocksDiv.innerHTML = '<span class="block-chip">08:00–16:30</span>';
        }
      }
    });
  });

  var elRate = document.getElementById("rateInput");
  if (elRate) elRate.value = currentState.staticMinRate;
}

// Day block editor for weekly schedule
var editingDayKey = null;

function openDayBlockEditor(dayKey) {
  editingDayKey = dayKey;
  var modal = document.getElementById("dayBlockEditorModal");
  var title = document.getElementById("dayBlockEditorTitle");
  var container = document.getElementById("dayBlockEditorContainer");

  if (!modal || !container) return;

  title.textContent = DAY_NAMES[parseInt(dayKey)] + ' Work Blocks';
  container.innerHTML = "";

  var entry = currentState.schedule[dayKey] || {work: false, blocks: []};
  var blocks = (entry.work && entry.blocks) ? entry.blocks : [];

  if (blocks.length === 0) {
    addDayBlockEditorRow("08:00", "10:00");
  } else {
    blocks.forEach(function(b) {
      addDayBlockEditorRow(b.start, b.end);
    });
  }

  modal.classList.add('active');
}

function addDayBlockEditorRow(start, end) {
  var container = document.getElementById("dayBlockEditorContainer");
  if (!container) return;

  var row = document.createElement("div");
  row.className = "day-block-editor-row";

  row.innerHTML = 
    '<div class="time-input-group">' +
      '<span class="time-label">Start</span>' +
      '<input type="text" class="block-editor-start" value="' + (start || "08:00") + '" maxlength="5">' +
    '</div>' +
    '<span class="time-separator">→</span>' +
    '<div class="time-input-group">' +
      '<span class="time-label">End</span>' +
      '<input type="text" class="block-editor-end" value="' + (end || "10:00") + '" maxlength="5">' +
    '</div>' +
    '<button class="block-editor-remove" title="Remove">×</button>';

  container.appendChild(row);

  row.querySelector('.block-editor-remove').addEventListener('click', function() {
    row.remove();
  });
}

async function saveDayBlockEditor() {
  if (!editingDayKey) return;

  var rows = document.querySelectorAll('.day-block-editor-row');
  var blocks = [];
  var timeRe = /^([01]?\d|2[0-3]):([0-5]\d)$/;

  for (var i = 0; i < rows.length; i++) {
    var start = rows[i].querySelector('.block-editor-start').value.trim();
    var end = rows[i].querySelector('.block-editor-end').value.trim();

    if (!timeRe.test(start) || !timeRe.test(end)) {
      showToast('Invalid time in block ' + (i+1), 'error');
      return;
    }

    var p = start.split(':').map(Number);
    var q = end.split(':').map(Number);
    if (p[0]*60+p[1] >= q[0]*60+q[1]) {
      showToast('End must be after start in block ' + (i+1), 'error');
      return;
    }

    blocks.push({start: start, end: end});
  }

  var newSchedule = JSON.parse(JSON.stringify(currentState.schedule));
  newSchedule[editingDayKey] = { work: blocks.length > 0, blocks: blocks };

  try {
    var resp = await sendMsg({type: "SAVE_CONFIG", schedule: newSchedule});
    if (resp.state) {
      currentState = resp.state;
      renderSchedule();
      updateUI(currentState);
      closeModal('dayBlockEditorModal');
      showToast('Schedule updated!', 'success');
    }
  } catch (e) {
    showToast('Failed to save schedule', 'error');
  }
}

async function saveSchedule() {
  // In multi-block mode, schedule is saved per-day via the block editor
  // This button now just saves the pay rate
  var rate = parseFloat(document.getElementById("rateInput").value);
  if (isNaN(rate) || rate <= 0) { 
    showToast('Enter a valid pay rate.', 'error'); 
    return; 
  }

  try {
    var resp = await sendMsg({type:"SAVE_CONFIG", staticMinRate: rate});
    if (resp.state) { 
      currentState = resp.state; 
      closeModal('scheduleModal'); 
      updateUI(currentState);
      showToast('Pay rate saved!', 'success');
    }
  } catch (e) {
    showToast('Failed to save pay rate', 'error');
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
  if (elRate && document.activeElement !== elRate) elRate.value = currentState.staticMinRate;
  if (elFx && document.activeElement !== elFx) elFx.value = currentState.exchangeRate;
  if (elCurrency) elCurrency.value = currentState.currencyDisplay || "both";

  var sched = document.getElementById("settingsSchedule");
  if (!sched) return;

  sched.innerHTML = "";
  var header = document.createElement("div");
  header.className = "sched-row sched-header";
  header.innerHTML = '<label style="width:36px">Day</label><span style="width:20px;text-align:center">On</span><span style="flex:1;text-align:center">Blocks</span>';
  sched.appendChild(header);

  DAY_NAMES.forEach(function(name, i) {
    var key = String(i);
    var entry = currentState.schedule[key] || {work:false, blocks:[]};
    var row = document.createElement("div");
    row.className = "sched-row";

    var blocksText = (entry.work && entry.blocks && entry.blocks.length > 0) 
      ? entry.blocks.map(function(b) { return b.start + '–' + b.end; }).join(', ')
      : '—';

    row.innerHTML = '<label>' + name + '</label><input type="checkbox" class="sett-work" data-key="' + key + '"' + (entry.work?" checked":"") + ' disabled><span style="flex:1;font-size:11px;color:var(--muted);padding-left:8px;">' + blocksText + '</span>';
    sched.appendChild(row);
  });
}

async function saveSettings() {
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
      staticMinRate: rate, 
      exchangeRate: fx, 
      localTzOffset: localTz, 
      companyTzOffset: companyTz,
      currencyDisplay: currencyDisplay
    });
    if (resp.state) { 
      currentState = resp.state; 
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

  // Today schedule button
  var todaySchedBtn = document.getElementById('todayScheduleBtn');
  if (todaySchedBtn) {
    todaySchedBtn.addEventListener('click', function() { openModal('todayScheduleModal'); });
  }

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
    totalMin = ((totalMin % 1440) + 1440) % 1440;
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    input.value = pad2(h) + ':' + pad2(m);
  }

  // Time control buttons for add call
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

  // Today schedule modal buttons
  var btnAddTodayBlock = document.getElementById("btnAddTodayBlock");
  if (btnAddTodayBlock) {
    btnAddTodayBlock.addEventListener('click', function() {
      addTodayBlockRow("08:00", "10:00");
    });
  }

  var btnSaveTodaySchedule = document.getElementById("btnSaveTodaySchedule");
  if (btnSaveTodaySchedule) {
    btnSaveTodaySchedule.addEventListener('click', saveTodaySchedule);
  }

  var btnClearTodayOverride = document.getElementById("btnClearTodayOverride");
  if (btnClearTodayOverride) {
    btnClearTodayOverride.addEventListener('click', clearTodayOverride);
  }

  // Day block editor buttons
  var btnAddDayBlock = document.getElementById("btnAddDayBlock");
  if (btnAddDayBlock) {
    btnAddDayBlock.addEventListener('click', function() {
      addDayBlockEditorRow("08:00", "10:00");
    });
  }

  var btnSaveDayBlocks = document.getElementById("btnSaveDayBlocks");
  if (btnSaveDayBlocks) {
    btnSaveDayBlocks.addEventListener('click', saveDayBlockEditor);
  }

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
        var earnModal = document.getElementById("earningsModal");
        if (earnModal && earnModal.classList.contains("active")) {
          renderEarnings();
        }
        var histModal = document.getElementById("historyModal");
        if (histModal && histModal.classList.contains("active")) {
          renderMonthTotals(calendarDate.getFullYear(), calendarDate.getMonth());
        }
      }
    } catch (e) {
      // Silent fail on polling
    }
  }, 1000);

  console.log("[WFM] Popup ready");
})();


