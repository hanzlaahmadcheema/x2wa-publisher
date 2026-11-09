// Tests for Author Name Correction Manager UI in popup - zero dependencies.
//
//   node extension/test/popup-author-corrections.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const POPUP_DIR = path.join(__dirname, '..', 'popup');
const html = fs.readFileSync(path.join(POPUP_DIR, 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(POPUP_DIR, 'popup.js'), 'utf8');

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
}

function makeEl(id) {
  const el = {
    id,
    textContent: '',
    innerText: '',
    value: '',
    className: '',
    disabled: false,
    dataset: {},
    dir: 'ltr',
    options: [],
    style: {},
    _classes: new Set(),
    classList: {
      add(...c) { c.forEach((x) => el._classes.add(x)); el.className = [...el._classes].join(' '); },
      remove(...c) { c.forEach((x) => el._classes.delete(x)); el.className = [...el._classes].join(' '); },
      contains(c) { return el._classes.has(c); },
      toggle(c, on) { if (on === undefined) { el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); } else if (on) el._classes.add(c); else el._classes.delete(c); el.className = [...el._classes].join(' '); },
    },
    addEventListener(ev, fn) { el['_on_' + ev] = fn; },
    appendChild(child) {
      if (!el.children) el.children = [];
      el.children.push(child);
      return child;
    },
    click() { if (el._on_click) return el._on_click({ target: el, preventDefault() {} }); },
    focus() {},
    select() {},
  };
  let _textContent = undefined;
  Object.defineProperty(el, 'textContent', {
    get: () => {
      if (_textContent !== undefined) return _textContent;
      if (el.children && el.children.length > 0) {
        return el.children.map((c) => c.textContent).join(' ');
      }
      return '';
    },
    set: (v) => { _textContent = v; },
  });
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => _html,
    set: (v) => { _html = v; if (v === '') el.children = []; },
  });
  return el;
}

function buildDom() {
  const tagRegex = /<([a-z0-9]+)\b([^>]*)>/gi;
  const els = {};
  let m;
  while ((m = tagRegex.exec(html)) !== null) {
    const attrs = m[2];
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    if (idMatch) {
      const id = idMatch[1];
      const el = makeEl(id);
      const classMatch = attrs.match(/\bclass="([^"]+)"/);
      if (classMatch) {
        classMatch[1].split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
      }
      els[id] = el;
    }
  }
  return { els };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function runPopupHarness(initialStorage = {}, initialCorrections = [], initialRecentAuthors = null) {
  const { els } = buildDom();
  const storeData = Object.assign({}, initialStorage);
  const calls = [];
  const corrections = [...initialCorrections];
  const recentAuthors = initialRecentAuthors !== null
    ? [...initialRecentAuthors]
    : (storeData.recentPostedAuthors ? [...storeData.recentPostedAuthors] : []);

  const fetchStub = async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method, body });

    if (u.endsWith('/status')) {
      return jsonResponse(200, { state: 'ready', me: { _serialized: '923000000000@c.us' } });
    }
    if (u.endsWith('/version')) {
      return jsonResponse(200, { ok: true, branch: 'main', sha: '1234567', dirty: false });
    }
    if (u.endsWith('/groq/config')) {
      return jsonResponse(200, { configured: true, model: 'openai/gpt-oss-120b' });
    }
    if (u.endsWith('/channels')) {
      return jsonResponse(200, { channels: [{ id: 'ch1', name: 'Channel 1', role: 'owner' }] });
    }
    if (u.endsWith('/author-corrections')) {
      if (method === 'GET') {
        return jsonResponse(200, { ok: true, corrections });
      }
      if (method === 'POST') {
        const existingIdx = corrections.findIndex((c) => c.handle === body.handle);
        const entry = {
          handle: body.handle,
          urduName: body.urduName,
          originalName: body.originalName || '',
          updatedAt: Date.now(),
        };
        if (existingIdx >= 0) corrections[existingIdx] = entry;
        else corrections.push(entry);
        return jsonResponse(200, { ok: true, count: corrections.length, correction: entry });
      }
      if (method === 'DELETE') {
        const idx = corrections.findIndex((c) => c.handle === body.handle);
        if (idx >= 0) corrections.splice(idx, 1);
        return jsonResponse(200, { ok: true, deleted: idx >= 0, count: corrections.length });
      }
    }
    if (u.endsWith('/recent-posted-authors')) {
      return jsonResponse(200, { ok: true, authors: recentAuthors });
    }
    return jsonResponse(404, { error: 'not-found' });
  };

  const doc = {
    getElementById: (id) => els[id] || null,
    createElement: (tag) => {
      const el = makeEl('<' + tag + '>');
      el.tagName = tag.toUpperCase();
      return el;
    },
    addEventListener: (ev, fn) => { doc['_on_' + ev] = fn; },
  };

  const sandbox = {
    document: doc,
    window: { addEventListener() {} },
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn, ms) => { if (ms && ms > 500) return 0; return fn(); },
    fetch: fetchStub,
    chrome: {
      storage: {
        local: {
          get: (keys, cb) => cb(Object.fromEntries((keys || []).map((k) => [k, storeData[k]]))),
          set: (obj, cb) => { Object.assign(storeData, obj); cb && cb(); },
          remove: (keys, cb) => { (keys || []).forEach((k) => delete storeData[k]); cb && cb(); },
        },
      },
    },
    Buffer,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(popupJs, sandbox);

  await doc._on_DOMContentLoaded();
  return { els, store: storeData, calls, corrections, recentAuthors };
}

(async () => {
  console.log('1. Author Name Correction UI elements initialization');
  {
    const { els } = await runPopupHarness();
    check('correctAuthorBtn exists', Boolean(els.correctAuthorBtn));
    check('authorCorrectionForm exists and is hidden initially', els.authorCorrectionForm && els.authorCorrectionForm.classList.contains('hidden'));
    check('corrUrduInput exists', Boolean(els.corrUrduInput));
    check('corrSaveBtn exists', Boolean(els.corrSaveBtn));
    check('corrCancelBtn exists', Boolean(els.corrCancelBtn));
    check('correctionsCard exists', Boolean(els.correctionsCard));
    check('corrCountBadge shows 0 recent initially', els.corrCountBadge.textContent.includes('0 recent'));
  }

  console.log('\n2. Quick Correction Form Prefilling from latestTranslation');
  {
    const latestTranslation = {
      author: 'Alex Ferguson',
      handle: '@alex_ferguson',
      translatedAuthor: 'ایلکس فرگوسن غلط',
      timestamp: Date.now(),
    };
    const { els } = await runPopupHarness({ latestTranslation });

    // Click "Correct Author Name" button
    await els.correctAuthorBtn.click();

    check('authorCorrectionForm is now unhidden', !els.authorCorrectionForm.classList.contains('hidden'));
    eq('corrAuthorDisplay has author name', els.corrAuthorDisplay.textContent, 'Alex Ferguson');
    eq('corrAuthorHandle has handle', els.corrAuthorHandle.textContent, '@alex_ferguson');
    eq('corrLatestTranslated has translated name', els.corrLatestTranslated.textContent, 'ایلکس فرگوسن غلط');
    eq('corrUrduInput is prefilled with translated name', els.corrUrduInput.value, 'ایلکس فرگوسن غلط');
    eq('dataset.handle is set', els.authorCorrectionForm.dataset.handle, '@alex_ferguson');

    // Click Cancel hides form
    await els.corrCancelBtn.click();
    check('form is hidden after cancel', els.authorCorrectionForm.classList.contains('hidden'));
  }

  console.log('\n3. Saving Correction updates controller and storage');
  {
    const latestTranslation = {
      author: 'Alex Ferguson',
      handle: '@alex_ferguson',
      translatedAuthor: 'ایلکس فرگوسن غلط',
      timestamp: Date.now(),
    };
    const { els, store, calls, corrections } = await runPopupHarness({ latestTranslation });

    // Open form
    await els.correctAuthorBtn.click();

    // Type preferred Urdu spelling
    els.corrUrduInput.value = 'ایلکس فرگوسن درست';

    // Click Save
    await els.corrSaveBtn.click();

    // Verify POST was made
    const postCall = calls.find((c) => c.url.endsWith('/author-corrections') && c.method === 'POST');
    check('POST /author-corrections called', Boolean(postCall));
    eq('POST handle is @alex_ferguson', postCall.body.handle, '@alex_ferguson');
    eq('POST urduName is preferred spelling', postCall.body.urduName, 'ایلکس فرگوسن درست');
    eq('POST originalName is Alex Ferguson', postCall.body.originalName, 'Alex Ferguson');

    // Success note displayed
    check('Success note displayed', els.corrNote.textContent.includes('Saved! Future tweets from @alex_ferguson will use'));

    // Cached latestTranslation updated in storage
    eq('storage latestTranslation updated', store.latestTranslation && store.latestTranslation.translatedAuthor, 'ایلکس فرگوسن درست');

    // Badge updated
    check('Count badge updated to 1 recent', els.corrCountBadge.textContent.includes('1 recent'));
    eq('corrections array has 1 item', corrections.length, 1);
  }

  console.log('\n4. Saved author names NOT shown; only last 5 posted authors shown for correction');
  {
    // Scenario A: 2 saved corrections in controller DB, but 0 posted tweets.
    // Popup must show 0 items, not the saved database names!
    const savedCorrections = [
      { handle: '@saved_author_1', urduName: 'محفوظ مصنف ایک', originalName: 'Saved Author 1', updatedAt: Date.now() },
      { handle: '@saved_author_2', urduName: 'محفوظ مصنف دو', originalName: 'Saved Author 2', updatedAt: Date.now() },
    ];
    const { els: elsA } = await runPopupHarness({}, savedCorrections, []);

    check('Count badge shows 0 recent when no posts sent', elsA.corrCountBadge.textContent.includes('0 recent'));
    check('Empty state visible when 0 posts sent', !elsA.correctionsEmpty.classList.contains('hidden'));
    check('Saved authors are NOT rendered in popup list', !elsA.correctionsList.children || elsA.correctionsList.children.length === 0);

    // Scenario B: 6 posts sent from different authors. Only the last 5 should appear.
    const sixRecentAuthors = [
      { handle: '@author6', author: 'Author Six', translatedAuthor: 'مصنف چھ' },
      { handle: '@author5', author: 'Author Five', translatedAuthor: 'مصنف پانچ' },
      { handle: '@author4', author: 'Author Four', translatedAuthor: 'مصنف چار' },
      { handle: '@author3', author: 'Author Three', translatedAuthor: 'مصنف تین' },
      { handle: '@author2', author: 'Author Two', translatedAuthor: 'مصنف دو' },
      { handle: '@author1', author: 'Author One', translatedAuthor: 'مصنف ایک' },
    ];
    // Author Six has a saved override in controller
    const activeCorrections = [
      { handle: '@author6', urduName: 'مصنف چھ درست', originalName: 'Author Six', updatedAt: Date.now() },
      { handle: '@saved_author_1', urduName: 'محفوظ مصنف ایک', originalName: 'Saved Author 1', updatedAt: Date.now() },
    ];

    const { els: elsB, calls, corrections } = await runPopupHarness({}, activeCorrections, sixRecentAuthors);

    check('Count badge shows 5 recent (capped at 5)', elsB.corrCountBadge.textContent.includes('5 recent'));
    check('Empty state hidden', elsB.correctionsEmpty.classList.contains('hidden'));
    eq('correctionsList has exactly 5 children rendered', elsB.correctionsList.children.length, 5);

    // Check that 6th author was dropped (only last 5 items)
    const listText = elsB.correctionsList.children.map((c) => c.textContent || '').join(' ');
    check('Top recent author6 is in list', listText.includes('@author6'));
    check('author6 uses saved override spelling', listText.includes('مصنف چھ درست'));
    check('author6 has Saved badge', listText.includes('Saved'));
    check('author5 is in list', listText.includes('@author5'));
    check('author2 is in list', listText.includes('@author2'));
    check('author1 (oldest 6th) is excluded', !listText.includes('@author1'));
    check('saved_author_1 (not in recent posts) is excluded', !listText.includes('@saved_author_1'));

    // Check inline edit of a recent author (author5)
    const row5 = elsB.correctionsList.children[1];
    const actionsDiv5 = row5.children[1];
    const editBtn5 = actionsDiv5.children.find((b) => b.textContent === 'Edit');
    check('Edit button exists on row 5', Boolean(editBtn5));

    // Click Edit on author5
    await editBtn5.click();
    const input = row5.children.find((c) => c.tagName === 'INPUT');
    check('Inline input opened', Boolean(input));
    eq('Inline input prefilled with current Urdu', input.value, 'مصنف پانچ');

    // Type corrected spelling and click Save
    input.value = 'مصنف پانچ تصحیح شدہ';
    const btnRow = row5.children.find((c) => c.children && c.children.length === 2);
    const saveBtn = btnRow.children.find((b) => b.textContent === 'Save');
    await saveBtn.click();

    const postCall = calls.find((c) => c.url.endsWith('/author-corrections') && c.method === 'POST' && c.body.handle === '@author5');
    check('POST /author-corrections called for @author5', Boolean(postCall));
    eq('POST urduName is new spelling', postCall.body.urduName, 'مصنف پانچ تصحیح شدہ');

    // Check delete on author6 (which has Saved badge and Delete button)
    const row6 = elsB.correctionsList.children[0];
    const actionsDiv6 = row6.children[1];
    const delBtn6 = actionsDiv6.children.find((b) => b.textContent === 'Delete');
    check('Delete button exists on author6', Boolean(delBtn6));

    await delBtn6.click();
    const delCall = calls.find((c) => c.url.endsWith('/author-corrections') && c.method === 'DELETE' && c.body.handle === '@author6');
    check('DELETE /author-corrections called for @author6', Boolean(delCall));
  }

  if (failures > 0) {
    console.log(`\n${failures} FAILURE(S)`);
    process.exit(1);
  } else {
    console.log('\nALL POPUP AUTHOR CORRECTIONS TESTS PASSED');
  }
})();
