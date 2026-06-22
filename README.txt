WFM Call Timer v2.5 — History & Calendar
========================================

✅ NEW FEATURES:

1. REMOVED: "Shift Ended" overlay that blocked the UI
   → You can now view history and earnings even after shift ends

2. ADDED: 📊 History button (top bar)
   → Calendar view showing all days with recorded calls
   → Green dots indicate days with earnings
   → Click any day to see detailed call list

3. ADDED: Call editing in History
   → Delete individual calls (🗑 button)
   → Add missing calls with start/end times
   → Useful when computer didn't record a call

4. ADDED: Workshift gating (v2.4 carryover)
   → Press "Begin Workshift" to enable auto-detection
   → Press "End Workshift" to stop all detection
   → App won't start timer just from opening job homepage

📁 Files:
  manifest.json    v2.5.0
  popup.html       UI with calendar modal
  popup.js         All logic including calendar
  background.js    History storage API
  detector.js      Content script (unchanged)

⚠️ You still need your icons/ folder from old extension!

🚀 Deploy: Replace files in your extension folder, reload in chrome://extensions
