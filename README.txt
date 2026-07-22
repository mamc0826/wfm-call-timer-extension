WFM Call Timer v2.6 — Multi-Block Schedules & Calendar Color Coding
====================================================================

✅ NEW FEATURES IN v2.6:

1. 📅 MULTI-BLOCK DAILY SCHEDULES
   → Each day can now have MULTIPLE work blocks with breaks in between
   → Example: 08:00–10:00, 12:00–14:00, 16:00–19:00
   → Auto-detection only runs during work blocks

2. 📝 TODAY'S SCHEDULE OVERRIDE
   → New "📝 Today" button in the schedule bar
   → Set custom work blocks for TODAY only (perfect for overtime days)
   → Option to also save as recurring schedule for that day of week
   → Clears automatically at midnight

3. 🎨 CALENDAR COLOR CODING (like your reference image!)
   → 🔴 RED days = Light work (< 3 hours)
   → 🟡 YELLOW days = Moderate work (3–5 hours)  
   → 🟢 GREEN days = Heavy work (5+ hours)
   → Color legend shown above calendar for easy reference
   → Hours badge shown in day detail panel too

4. 🔄 FULL DATA MIGRATION
   → Your existing v2.5 history, calls, and earnings are PRESERVED
   → Old single-block schedule format auto-converts to new multi-block format
   → No data loss when updating

📁 Files:
  manifest.json    v2.6.0
  popup.html       UI with calendar, today schedule, block editor
  popup.js         All logic including multi-block schedules
  background.js    Multi-block storage API + data migration
  detector.js      Content script (minor compatibility update)

⚠️ You still need your icons/ folder from the old extension!

🚀 Deploy: Replace all files in your extension folder, reload in chrome://extensions

🗑️ To clear old data and start fresh: 
   → Click extension icon → right-click → "Inspect popup" → Console → 
     chrome.storage.local.clear() → reload extension
