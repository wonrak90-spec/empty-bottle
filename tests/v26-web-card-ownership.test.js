// Regression guard for the 2026-10-01 "WMS 자동인식 버튼 표시/중복 및 사진촬영
// 버튼 숨김" issue.
//
// Root cause: v26-web.js picked the WMS/vendor cards by position
// (`single.querySelectorAll(':scope > .card')[0]` / `[1]`). A later layer
// (v55-wms-inbound-progress.js) prepends #v55InboundProgressCard to #single,
// which shifted those indices. simplifySingleUi() re-runs on 400ms/1500ms
// timers, so those later passes applied the VENDOR hide-regex to the WMS card
// and hid 🎥 WMS 자동 인식 and 🖼 갤러리.
const fs = require('fs');
const assert = require('assert');

const web = fs.readFileSync('v26-web.js', 'utf8');
const progress = fs.readFileSync('v55-wms-inbound-progress.js', 'utf8');

// 1. Cards must not be selected by positional index.
assert.ok(
  !/querySelectorAll\(['"]:scope > \.card['"]\)[\s\S]{0,80}?\[\s*0\s*\]/.test(web),
  'v26-web.js must not identify the WMS card by positional index'
);
assert.ok(
  web.includes("$('wmsPhoto')") && web.includes("$('vendorPhoto')"),
  'v26-web.js must anchor the WMS/vendor cards to #wmsPhoto / #vendorPhoto'
);
assert.ok(
  /closest\(['"]\.card['"]\)/.test(web),
  'v26-web.js must resolve each card via closest(".card")'
);

// 2. The hide-loops must never hide a button belonging to EITHER action grid,
//    so a mode mix-up can no longer hide the grid it just built.
const hideGuards = web.match(/if\(b\.closest\([^)]*\)[^\n]*\)return;/g) || [];
assert.ok(hideGuards.length >= 2, 'both hide-loops must keep their grid guard');
hideGuards.forEach(g => {
  assert.ok(
    g.includes('#v26Actions_wms') && g.includes('#v26Actions_vendor'),
    'hide-loop guard must exempt both action grids, got: ' + g
  );
});

// 3. Manual entry must open the collapsed V56 detail card before scrolling,
//    otherwise ✍ 직접 입력 focuses a display:none field and looks dead.
assert.ok(web.includes('revealDetail'), 'manual entry must reveal collapsed detail cards');
assert.ok(
  /v56-show-detail|V56FastFlow[\s\S]{0,40}showDetail/.test(web),
  'revealDetail must un-collapse the V56 fast-flow detail cards'
);

// 4. Document the dependency that caused the shift, so this stays visible.
assert.ok(
  progress.includes('v55InboundProgressCard'),
  'sanity: v55-wms-inbound-progress.js still injects a card into #single'
);

console.log('PASS v26-web card ownership: anchor-based card lookup + grid-safe hide guards + manual-entry reveal');
