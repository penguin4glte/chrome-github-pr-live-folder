// GitHub PR Live Folder - service worker
// 1分ごとにGitHubのPull Requestを検索し、Chromeのタブグループへ同期する。

const ALARM_NAME = 'sync-pull-requests';
const STARTUP_ALARM = 'startup-sync';

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

// PRページのURL（/files や #discussion 等が付いていても同じPRとして扱う）
const PR_URL_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

function prKeyFromUrl(url) {
  if (!url) return null;
  const m = url.match(PR_URL_RE);
  if (!m) return null;
  // 直後が境界（末尾・/・?・#）の場合のみPRページとみなす
  const rest = url.slice(m[0].length);
  if (rest !== '' && !/^[/?#]/.test(rest)) return null;
  return m[0];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

// ---------------------------------------------------------------------------
// セッション状態（key→tabIdマップ等）
// タブのURLはSSOリダイレクト等で変わりうるため、URLだけに頼らず
// 「どのタブがどのPRのものか」をstorage.sessionで追跡する。
// 読み書きはチェーンで直列化し、イベント同士の上書きを防ぐ。
// ---------------------------------------------------------------------------

let sessionChain = Promise.resolve();

function updateSession(updater) {
  const run = async () => {
    const s = await chrome.storage.session.get(['keyMap', 'pendingDiscard', 'pendingStaleIds']);
    const next = updater({
      keyMap: s.keyMap || {},
      pendingDiscard: Array.isArray(s.pendingDiscard) ? s.pendingDiscard : [],
      pendingStaleIds: Array.isArray(s.pendingStaleIds) ? s.pendingStaleIds : [],
    });
    if (next) await chrome.storage.session.set(next);
  };
  sessionChain = sessionChain.then(run, run);
  return sessionChain;
}

async function getKeyMap() {
  const { keyMap } = await chrome.storage.session.get('keyMap');
  return keyMap || {};
}

// ---------------------------------------------------------------------------
// 初期化・アラーム
// ---------------------------------------------------------------------------

// 起動直後のセッション復元（前回のタブグループの復元）とレースしないよう、
// この時刻までは定期アラームによる同期を見送る（STARTUP_ALARMが初回同期を担う）
let deferSyncUntil = 0;

chrome.runtime.onInstalled.addListener(() => init(false));
chrome.runtime.onStartup.addListener(() => {
  deferSyncUntil = Date.now() + 30 * 1000;
  chrome.storage.session.set({ deferSyncUntil }).catch(() => {});
  init(true);
});

async function init(deferFirstSync) {
  const settings = await getSettings();
  await scheduleAlarm(settings);
  if (deferFirstSync) {
    await chrome.alarms.create(STARTUP_ALARM, { delayInMinutes: 0.5 });
  } else {
    syncNow('init').catch(() => {});
  }
}

// アラームは拡張の無効化→再有効化などで消えることがあり、その際は
// onInstalled / onStartup のどちらも発火しない。SW起動のたびに確認して復旧する。
// onInstalled/onStartup の処理がアラームを作り終えるのを待ってから確認するため、
// 1秒遅らせる（インストール直後に二重で同期しないように）。
setTimeout(async () => {
  try {
    const existing = await chrome.alarms.get(ALARM_NAME);
    if (!existing) {
      await scheduleAlarm(await getSettings());
      await chrome.alarms.create(STARTUP_ALARM, { delayInMinutes: 0.5 });
    }
  } catch {
    // ignore
  }
}, 1000);

async function scheduleAlarm(settings) {
  const period = Math.max(1, Number(settings.intervalMinutes) || 1);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: period });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === STARTUP_ALARM) {
    syncNow('startup').catch(() => {});
    return;
  }
  if (alarm.name !== ALARM_NAME) return;
  // ブラウザ再起動時、前セッションから持ち越された期限切れの定期アラームが
  // 起動直後に発火することがある。その場合はSTARTUP_ALARMの初回同期に任せる。
  let until = deferSyncUntil;
  if (!until) {
    try {
      const s = await chrome.storage.session.get('deferSyncUntil');
      until = s.deferSyncUntil || 0;
    } catch {
      until = 0;
    }
  }
  if (Date.now() < until) return;
  syncNow('alarm').catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    getSettings()
      .then((settings) => scheduleAlarm(settings))
      .then(() => syncNow('settings-changed'))
      .catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'syncNow') {
    syncNow('manual')
      .then(() => getStatus())
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err && err.message || err) }));
    return true; // async response
  }
  return false;
});

// ---------------------------------------------------------------------------
// 同期本体
// ---------------------------------------------------------------------------

let inflight = null;
let pending = null;

// 同期中に呼ばれた場合は「現在の同期の後にもう1回」をキューする。
// 設定変更が同期中に起きても、必ず新しい設定で同期し直されるようにするため。
function syncNow(trigger) {
  if (inflight) {
    if (!pending) {
      pending = inflight
        .catch(() => {})
        .then(() => {
          pending = null;
          return syncNow(trigger);
        });
    }
    return pending;
  }
  inflight = doSync(trigger).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doSync(trigger) {
  const settings = await getSettings();

  if (!settings.token) {
    await setStatus({ error: 'GitHubトークンが未設定です。設定画面から登録してください。' });
    await setBadge('!', '#d93025');
    return;
  }
  if (!settings.query.trim()) {
    await setStatus({ error: '検索クエリが未設定です。' });
    await setBadge('!', '#d93025');
    return;
  }

  let prs;
  let partial;
  try {
    ({ items: prs, partial } = await fetchPullRequests(settings));
  } catch (err) {
    await setStatus({ error: String(err && err.message || err) });
    await setBadge('!', '#d93025');
    return;
  }

  try {
    await syncTabGroup(settings, prs, partial);
  } catch (err) {
    // タブ操作はユーザーのドラッグ中などに失敗しうる。次回の同期でリトライされる。
    console.warn('tab sync failed:', err);
  }

  // グループ復元（ブラウザ再起動後など）で内容ベースの照合に使う
  await chrome.storage.local.set({ managedKeys: prs.map((pr) => pr.key) });

  await setStatus({
    lastSync: Date.now(),
    count: prs.length,
    partial: Boolean(partial),
    query: settings.query,
    items: prs,
    error: null,
  });
  await setBadge(String(prs.length), '#1a7f37');
}

async function fetchPullRequests(settings) {
  // is:pr がないとIssueが取得枠を消費して件数がずれるため、必ず付与する
  let query = settings.query;
  if (!/(^|\s)(is|type):pr(\s|$)/.test(query)) {
    query = `is:pr ${query}`;
  }

  const url = new URL('https://api.github.com/search/issues');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(Math.min(50, Math.max(1, settings.maxItems))));

  const res = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${settings.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = [
        body.message,
        ...(Array.isArray(body.errors) ? body.errors : []).map(
          (e) => (typeof e === 'string' ? e : e && (e.message || e.code))
        ),
      ]
        .filter(Boolean)
        .join(' - ');
    } catch {
      // ignore body parse errors
    }
    if (res.status === 401) detail = 'トークンが無効です。設定画面で確認してください。' + (detail ? ` (${detail})` : '');
    if (res.status === 422) detail = '検索クエリが不正です。設定画面でクエリを確認してください。' + (detail ? ` (${detail})` : '');
    throw new Error(`GitHub API ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const items = (data.items || [])
    .filter((item) => item.pull_request)
    .map((item) => ({
      key: prKeyFromUrl(item.html_url) || item.html_url,
      url: item.html_url,
      title: item.title,
      author: item.user ? item.user.login : '',
      draft: Boolean(item.draft),
      updatedAt: item.updated_at,
    }));

  // 検索がタイムアウトすると200のまま部分的な結果が返る。
  // その場合にstale削除を行うとオープン中のPRのタブまで消してしまう。
  return { items, partial: Boolean(data.incomplete_results) };
}

// ---------------------------------------------------------------------------
// タブグループ操作
// ---------------------------------------------------------------------------

async function syncTabGroup(settings, prs, partial) {
  const group = await findManagedGroup(settings);

  if (!group) {
    if (prs.length === 0) return; // 空のグループは作れない
    await createGroup(settings, prs);
    return;
  }

  let groupId = group.id;
  const keyMap = await getKeyMap();
  const groupTabs = await chrome.tabs.query({ groupId });
  const { tabByKey } = buildTabIndex(groupTabs, keyMap);
  const currentKeys = new Set(prs.map((pr) => pr.key));

  // 1. 新しいPRのタブを追加。
  //    必ず削除より先に行う: 先に削除するとグループが空→消滅し、
  //    追加したタブがグループに入れず孤児になるため。
  const toAdd = prs.filter((pr) => !tabByKey.has(pr.key));
  if (toAdd.length > 0) {
    groupId = await addTabsToGroup(settings, group, toAdd);
  }

  // 2. クローズ/マージされたPRのタブと、同一PRの重複タブを削除
  let retainedStale = 0;
  if (settings.removeStale && !partial) {
    retainedStale = await removeStaleTabs(groupId, currentKeys);
  } else {
    await updateSession(() => ({ pendingStaleIds: [] }));
  }

  // 3. PRの並び（更新が新しい順）に合わせてタブを並べ替え
  await reorderGroupTabs(groupId, prs);

  // 4. タイトル・色を更新（閲覧中のため残したstaleタブも件数に含める）
  await updateGroupAppearance(settings, groupId, prs.length + retainedStale);
}

function buildTabIndex(groupTabs, keyMap) {
  const idToMapKey = new Map();
  for (const [key, id] of Object.entries(keyMap)) idToMapKey.set(id, key);

  const tabByKey = new Map(); // key -> 代表タブ（アクティブなタブを優先）
  const keyForTab = new Map(); // tabId -> key
  for (const tab of groupTabs) {
    // URLが（リダイレクト等で）PRページでなくなっていても、keyMapで追跡できる
    const key = prKeyFromUrl(tab.pendingUrl || tab.url) || idToMapKey.get(tab.id) || null;
    if (!key) continue;
    keyForTab.set(tab.id, key);
    const existing = tabByKey.get(key);
    if (!existing || (tab.active && !existing.active)) tabByKey.set(key, tab);
  }
  return { tabByKey, keyForTab };
}

// PRリスト分のタブを確保する。グループ外に同じPRの未グループタブ
// （popupのフォールバック等で開かれた孤児）があれば再利用する。
async function collectTabsForPrs(windowId, prList) {
  const orphanByKey = new Map();
  try {
    const loose = await chrome.tabs.query({
      windowId,
      pinned: false,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    });
    for (const t of loose) {
      const k = prKeyFromUrl(t.pendingUrl || t.url);
      if (k && !t.active && !orphanByKey.has(k)) orphanByKey.set(k, t);
    }
  } catch {
    // ignore
  }

  const tabIds = [];
  const createdIds = [];
  const newEntries = {};
  for (const pr of prList) {
    const orphan = orphanByKey.get(pr.key);
    if (orphan) {
      tabIds.push(orphan.id);
      newEntries[pr.key] = orphan.id;
      continue;
    }
    const tab = await chrome.tabs.create({ windowId, url: pr.url, active: false });
    tabIds.push(tab.id);
    createdIds.push(tab.id);
    newEntries[pr.key] = tab.id;
  }

  await updateSession((s) => ({
    keyMap: { ...s.keyMap, ...newEntries },
    // 拡張が自分で開いたタブだけを読み込み完了後にdiscardする
    pendingDiscard: [...s.pendingDiscard, ...createdIds],
  }));
  return tabIds;
}

async function addTabsToGroup(settings, group, toAdd) {
  const tabIds = await collectTabsForPrs(group.windowId, toAdd);
  try {
    await chrome.tabs.group({ tabIds, groupId: group.id });
    return group.id;
  } catch {
    // 同期中にグループが閉じられた場合は作り直す
    const groupId = await chrome.tabs.group({
      tabIds,
      createProperties: { windowId: group.windowId },
    });
    await chrome.tabGroups.update(groupId, { color: settings.groupColor, collapsed: true });
    await chrome.storage.session.set({ groupId });
    return groupId;
  }
}

async function createGroup(settings, prs) {
  const win = await getTargetWindow();
  const tabIds = await collectTabsForPrs(win.id, prs);
  const groupId = await chrome.tabs.group({
    tabIds,
    createProperties: { windowId: win.id },
  });
  await chrome.tabGroups.update(groupId, {
    title: settings.showCount ? `${settings.groupTitle} (${prs.length})` : settings.groupTitle,
    color: settings.groupColor,
    collapsed: true,
  });
  await chrome.storage.session.set({ groupId });
}

// 戻り値: 閲覧中のため削除を見送ったstaleタブの数
async function removeStaleTabs(groupId, currentKeys) {
  const keyMap = await getKeyMap();
  const groupTabs = await chrome.tabs.query({ groupId });
  const { tabByKey, keyForTab } = buildTabIndex(groupTabs, keyMap);

  const removeIds = [];
  const retainedStaleIds = [];
  for (const tab of groupTabs) {
    const key = keyForTab.get(tab.id);
    if (!key) continue; // PR以外のタブには触らない
    const isStale = !currentKeys.has(key);
    const isDuplicate = !isStale && tabByKey.get(key).id !== tab.id;
    if (!isStale && !isDuplicate) continue;
    if (tab.active) {
      // ユーザーが見ているタブは奪わない。フォーカスが外れたら閉じる。
      if (isStale) retainedStaleIds.push(tab.id);
      continue;
    }
    removeIds.push(tab.id);
  }

  await updateSession(() => ({ pendingStaleIds: retainedStaleIds }));

  // 個別に削除し、1つの失敗（直前にユーザーが閉じた等）が他へ波及しないようにする
  for (const id of removeIds) {
    try {
      await chrome.tabs.remove(id);
    } catch {
      // ignore
    }
  }
  return retainedStaleIds.length;
}

async function reorderGroupTabs(groupId, prs) {
  const keyMap = await getKeyMap();
  const groupTabs = await chrome.tabs.query({ groupId });
  if (groupTabs.length === 0) return;
  groupTabs.sort((a, b) => a.index - b.index);
  const startIndex = groupTabs[0].index;

  const { tabByKey } = buildTabIndex(groupTabs, keyMap);

  let pos = 0;
  const orderedIds = [];
  for (const pr of prs) {
    const tab = tabByKey.get(pr.key);
    if (!tab) continue;
    orderedIds.push(tab.id);
    try {
      await chrome.tabs.move(tab.id, { index: startIndex + pos });
    } catch {
      // ユーザーがタブをドラッグ中などは失敗する。次回同期で直る。
      break;
    }
    pos++;
  }

  // 並べ替えでグループから外れたタブがあれば戻す（境界に移動した際の保険）
  if (orderedIds.length > 0) {
    try {
      await chrome.tabs.group({ tabIds: orderedIds, groupId });
    } catch {
      // ignore
    }
  }
}

async function updateGroupAppearance(settings, groupId, count) {
  const title = settings.showCount ? `${settings.groupTitle} (${count})` : settings.groupTitle;
  try {
    await chrome.tabGroups.update(groupId, { title, color: settings.groupColor });
  } catch {
    // グループが消えていたら次回同期で作り直される
  }
}

// 管理対象のグループを探す。
// グループIDはブラウザ再起動で変わるため、IDが無効なときは
// 「前回同期したPRのタブをどれだけ含むか」（内容）で照合する。
// タイトルだけの照合はユーザーの無関係なグループを乗っ取る恐れがあるため、
// 厳密なパターン一致 + PRタブを含むことを条件にする。
async function findManagedGroup(settings) {
  const { groupId } = await chrome.storage.session.get('groupId');
  if (typeof groupId === 'number') {
    try {
      return await chrome.tabGroups.get(groupId);
    } catch {
      // グループが閉じられた（ID失効）
    }
  }

  const groups = await chrome.tabGroups.query({});
  if (groups.length === 0) return null;

  const { managedKeys } = await chrome.storage.local.get('managedKeys');
  const managed = new Set(Array.isArray(managedKeys) ? managedKeys : []);
  const titleRe = new RegExp(`^${escapeRegExp(settings.groupTitle)}(?: \\(\\d+\\))?$`);

  let best = null;
  let bestScore = 0;
  const candidates = [];
  for (const g of groups) {
    let tabs;
    try {
      tabs = await chrome.tabs.query({ groupId: g.id });
    } catch {
      continue;
    }
    const prTabCount = tabs.filter((t) => prKeyFromUrl(t.pendingUrl || t.url)).length;
    const overlap = tabs.filter((t) => {
      const k = prKeyFromUrl(t.pendingUrl || t.url);
      return k && managed.has(k);
    }).length;
    const titleMatch = titleRe.test(g.title || '');

    // 内容ベース: 管理中PRの過半数を含み、かつグループの過半数が管理中PRのタブ
    const contentAdoptable =
      managed.size > 0 &&
      overlap >= Math.max(1, Math.ceil(managed.size / 2)) &&
      overlap >= Math.ceil(tabs.length / 2);
    const adoptable = contentAdoptable || (titleMatch && prTabCount > 0);
    if (!adoptable) continue;

    const score = overlap + (titleMatch ? 0.5 : 0);
    candidates.push({ group: g, tabs, titleMatch });
    if (score > bestScore) {
      best = g;
      bestScore = score;
    }
  }
  if (!best) return null;

  await chrome.storage.session.set({ groupId: best.id });

  // セッション復元とのレース等で同名の管理グループが複数できていたら統合する
  for (const c of candidates) {
    if (c.group.id === best.id || !c.titleMatch) continue;
    try {
      await chrome.tabs.group({ tabIds: c.tabs.map((t) => t.id), groupId: best.id });
    } catch {
      // ignore
    }
  }

  try {
    return await chrome.tabGroups.get(best.id);
  } catch {
    return null;
  }
}

async function getTargetWindow() {
  try {
    const win = await chrome.windows.getLastFocused();
    if (win && win.type === 'normal' && win.id !== chrome.windows.WINDOW_ID_NONE) return win;
  } catch {
    // fall through
  }
  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (wins.length === 0) throw new Error('通常ウィンドウが見つかりません');
  return wins[0];
}

// ---------------------------------------------------------------------------
// タブイベント
// ---------------------------------------------------------------------------

// 拡張が開いたタブの初回読み込み完了後にdiscardしてメモリを節約する。
// ユーザーが自分で開き直したタブ（pendingDiscardに無い）は対象外なので、
// 「開く→読み込み→また休止される」ループにはならない。
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  handleTabComplete(tabId, tab).catch(() => {});
});

async function handleTabComplete(tabId, tab) {
  let wasPending = false;
  await updateSession((s) => {
    if (!s.pendingDiscard.includes(tabId)) return null;
    wasPending = true;
    return { pendingDiscard: s.pendingDiscard.filter((id) => id !== tabId) };
  });
  if (!wasPending || tab.active) return;

  const settings = await getSettings();
  if (!settings.discardAfterLoad) return;
  try {
    await chrome.tabs.discard(tabId);
  } catch {
    // すでに破棄済み・閉鎖済みなどは無視
  }
}

// 閲覧中のため削除を見送ったstaleタブを、フォーカスが外れた時点で閉じる
chrome.tabs.onActivated.addListener(() => {
  cleanupPendingStale().catch(() => {});
});

async function cleanupPendingStale() {
  const { pendingStaleIds, groupId } = await chrome.storage.session.get([
    'pendingStaleIds',
    'groupId',
  ]);
  if (!Array.isArray(pendingStaleIds) || pendingStaleIds.length === 0) return;

  const settings = await getSettings();
  if (!settings.removeStale) {
    await updateSession(() => ({ pendingStaleIds: [] }));
    return;
  }

  const remaining = [];
  for (const id of pendingStaleIds) {
    try {
      const t = await chrome.tabs.get(id);
      if (t.active) {
        remaining.push(id);
        continue;
      }
      // ユーザーがグループ外へ移動したタブには触らない
      if (typeof groupId === 'number' && t.groupId !== groupId) continue;
      await chrome.tabs.remove(id);
    } catch {
      // すでに閉じられている
    }
  }
  await updateSession(() => ({ pendingStaleIds: remaining }));
}

// discardするとタブIDが変わるため、追跡情報を新IDへ引き継ぐ
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  updateSession((s) => {
    const keyMap = {};
    for (const [key, id] of Object.entries(s.keyMap)) {
      keyMap[key] = id === removedTabId ? addedTabId : id;
    }
    return {
      keyMap,
      pendingDiscard: s.pendingDiscard.map((id) => (id === removedTabId ? addedTabId : id)),
      pendingStaleIds: s.pendingStaleIds.map((id) => (id === removedTabId ? addedTabId : id)),
    };
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateSession((s) => {
    const keyMap = {};
    for (const [key, id] of Object.entries(s.keyMap)) {
      if (id !== tabId) keyMap[key] = id;
    }
    return {
      keyMap,
      pendingDiscard: s.pendingDiscard.filter((id) => id !== tabId),
      pendingStaleIds: s.pendingStaleIds.filter((id) => id !== tabId),
    };
  }).catch(() => {});
});

// ---------------------------------------------------------------------------
// ステータス・バッジ
// ---------------------------------------------------------------------------

async function setStatus(patch) {
  const { status } = await chrome.storage.session.get('status');
  await chrome.storage.session.set({ status: { ...(status || {}), ...patch } });
}

async function getStatus() {
  const { status } = await chrome.storage.session.get('status');
  return status || {};
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}
