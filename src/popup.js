const $ = (id) => document.getElementById(id);

const PR_URL_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

function prKeyFromUrl(url) {
  if (!url) return null;
  const m = url.match(PR_URL_RE);
  if (!m) return null;
  const rest = url.slice(m[0].length);
  if (rest !== '' && !/^[/?#]/.test(rest)) return null;
  return m[0];
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function render() {
  const { status } = await chrome.storage.session.get('status');
  const statusEl = $('status');
  const listEl = $('list');
  listEl.textContent = '';

  if (!status) {
    statusEl.textContent = 'まだ同期されていません。「今すぐ同期」を押してください。';
    statusEl.className = '';
    return;
  }
  if (status.error) {
    statusEl.textContent = status.error;
    statusEl.className = 'error';
    return;
  }

  statusEl.className = '';
  statusEl.textContent =
    `${status.count}件 ・ 最終同期 ${formatTime(status.lastSync)}` +
    (status.partial ? ' ・ 検索結果が不完全な可能性があります' : '');

  const items = status.items || [];
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '該当するPull Requestはありません 🎉';
    listEl.appendChild(empty);
    return;
  }

  for (const pr of items) {
    const row = document.createElement('a');
    row.className = 'pr';
    row.href = pr.url;

    const title = document.createElement('div');
    title.className = 'pr-title';
    title.textContent = pr.title;
    if (pr.draft) {
      const badge = document.createElement('span');
      badge.className = 'draft-badge';
      badge.textContent = 'Draft';
      title.appendChild(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'pr-meta';
    meta.textContent = pr.author;

    row.appendChild(title);
    row.appendChild(meta);
    row.addEventListener('click', (e) => {
      e.preventDefault();
      openPr(pr);
    });
    listEl.appendChild(row);
  }
}

async function openPr(pr) {
  const { groupId, keyMap } = await chrome.storage.session.get(['groupId', 'keyMap']);

  // backgroundが管理しているkey→tabIdマップを最優先で使う
  // （リダイレクト等でURLがPRページでなくなっていても追跡できる）
  const mappedId = keyMap && keyMap[pr.key];
  if (typeof mappedId === 'number') {
    try {
      const tab = await chrome.tabs.get(mappedId);
      await activateTab(tab);
      return;
    } catch {
      // タブが閉じられている場合は次の手段へ
    }
  }

  // グループの内外を問わず、同じPRのタブがあればそれをアクティブにする
  try {
    const allTabs = await chrome.tabs.query({});
    const existing = allTabs.find((t) => prKeyFromUrl(t.pendingUrl || t.url) === pr.key);
    if (existing) {
      await activateTab(existing);
      return;
    }
  } catch {
    // fall through
  }

  // 新規タブで開き、管理グループがあればそこへ入れる
  const tab = await chrome.tabs.create({ url: pr.url, active: true });
  if (typeof groupId === 'number') {
    try {
      await chrome.tabs.group({ tabIds: [tab.id], groupId });
    } catch {
      // グループが消えている場合は次回同期でグループへ取り込まれる
    }
  }
  window.close();
}

async function activateTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  window.close();
}

$('sync').addEventListener('click', async () => {
  $('status').textContent = '同期中…';
  $('status').className = '';
  try {
    await chrome.runtime.sendMessage({ type: 'syncNow' });
  } catch {
    // service worker起動失敗時もstorageの内容で再描画する
  }
  await render();
});

$('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

render();
