const DEFAULT_SETTINGS = {
  token: '',
  query: 'is:pr is:open review-requested:@me archived:false',
  groupTitle: 'Pull Requests',
  groupColor: 'blue',
  maxItems: 15,
  intervalMinutes: 1,
  removeStale: true,
  discardAfterLoad: true,
  showCount: true,
};

const $ = (id) => document.getElementById(id);

async function loadSettings() {
  const stored = await chrome.storage.local.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  $('token').value = settings.token;
  $('query').value = settings.query;
  $('groupTitle').value = settings.groupTitle;
  $('groupColor').value = settings.groupColor;
  $('maxItems').value = settings.maxItems;
  $('intervalMinutes').value = settings.intervalMinutes;
  $('removeStale').checked = settings.removeStale;
  $('discardAfterLoad').checked = settings.discardAfterLoad;
  $('showCount').checked = settings.showCount;
}

function readForm() {
  return {
    token: $('token').value.trim(),
    query: $('query').value.trim(),
    groupTitle: $('groupTitle').value.trim() || DEFAULT_SETTINGS.groupTitle,
    groupColor: $('groupColor').value,
    maxItems: Math.min(50, Math.max(1, Number($('maxItems').value) || DEFAULT_SETTINGS.maxItems)),
    intervalMinutes: Math.min(60, Math.max(1, Number($('intervalMinutes').value) || 1)),
    removeStale: $('removeStale').checked,
    discardAfterLoad: $('discardAfterLoad').checked,
    showCount: $('showCount').checked,
  };
}

function showMessage(text, ok) {
  const el = $('message');
  el.textContent = text;
  el.className = ok ? 'ok' : 'error';
}

function showAuthMessage(text, ok) {
  const el = $('authMessage');
  el.textContent = text;
  el.className = ok ? 'ok' : 'error';
}

$('save').addEventListener('click', async () => {
  const settings = readForm();
  if (!settings.token) {
    showMessage('トークンを入力してください。', false);
    return;
  }
  if (!settings.query) {
    showMessage('検索クエリを入力してください。', false);
    return;
  }
  await chrome.storage.local.set({ settings });
  showMessage('保存しました。同期を開始します…', true);
  try {
    const status = await chrome.runtime.sendMessage({ type: 'syncNow' });
    if (status && status.error) {
      showMessage(`同期エラー: ${status.error}`, false);
    } else if (status && typeof status.count === 'number') {
      showMessage(`保存しました。${status.count}件のPRを同期しました。`, true);
    }
  } catch {
    // service workerの起動タイミング次第で失敗しうるが、アラームで同期される
  }
});

$('test').addEventListener('click', async () => {
  const token = $('token').value.trim();
  if (!token) {
    showAuthMessage('トークンを入力してください。', false);
    return;
  }
  showAuthMessage('確認中…', true);
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      showAuthMessage(`認証エラー (HTTP ${res.status})。トークンを確認してください。`, false);
      return;
    }
    const user = await res.json();
    showAuthMessage(`認証OK: ${user.login} として接続できます。`, true);
  } catch (err) {
    showAuthMessage(`接続エラー: ${err.message}`, false);
  }
});

loadSettings();
