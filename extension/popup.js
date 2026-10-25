/* MV3 action popup: commands target only the current tab. No saved conversation data. */
(function (root) {
  'use strict';
  const UNAVAILABLE = 'このタブに接続できません。ChatGPTの通常タブで開いてください。導入直後は、未送信の入力を控えてからタブを再読み込みしてください。';

  function normalizeState(response) {
    if (!response || response.ok !== true || typeof response.enabled !== 'boolean' || typeof response.equalizeColumns !== 'boolean' ||
        !Number.isFinite(response.maxWidth) || response.maxWidth < 320 || !Number.isFinite(response.paneWidth) ||
        !Number.isInteger(response.visibleCount) || response.visibleCount < 0 || !Number.isInteger(response.totalCount) ||
        response.totalCount < response.visibleCount || !Array.isArray(response.hiddenPanes))
      throw new Error('拡張の状態を取得できませんでした。タブと拡張のバージョンを確認してください。');
    const maxWidth = Math.floor(response.maxWidth);
    const seen = new Set();
    const hiddenPanes = response.hiddenPanes.slice(0, 200).filter(pane => {
      if (!pane || typeof pane.id !== 'string' || !pane.id || pane.id.length > 200 || seen.has(pane.id)) return false;
      seen.add(pane.id);
      return true;
    }).map(pane => ({
      id: pane.id,
      title: typeof pane.title === 'string' ? pane.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) || '名前のない列' : '名前のない列'
    }));
    return { enabled: response.enabled, equalizeColumns: response.equalizeColumns,
      paneWidth: Math.max(320, Math.min(maxWidth, Math.round(response.paneWidth))), maxWidth,
      visibleCount: response.visibleCount, totalCount: response.totalCount, hiddenPanes };
  }

  function mount(document, chromeApi) {
    const node = id => document.getElementById(id);
    const panel = node('popup');
    const toggle = node('toggle-workspace');
    const controls = node('workspace-controls');
    const add = node('add-pane');
    const equal = node('equal-columns');
    const width = node('pane-width');
    const applyWidth = node('apply-width');
    const url = node('chat-url');
    const hidden = node('hidden-panes');
    const restore = node('restore-pane');
    const retry = node('retry-status');
    const options = node('open-options');
    const status = node('status');
    let state = null;
    let pending = false;

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.dataset.state = isError ? 'error' : 'ok';
    }

    function updateDisabled() {
      const disabled = pending || !state?.enabled;
      panel.setAttribute('aria-busy', String(pending));
      toggle.disabled = pending || !state;
      controls.disabled = disabled;
      add.disabled = disabled;
      equal.disabled = disabled;
      width.disabled = disabled || Boolean(state?.equalizeColumns);
      applyWidth.disabled = width.disabled;
      url.disabled = disabled;
      node('add-url').disabled = disabled;
      hidden.disabled = disabled || !state?.hiddenPanes.length;
      restore.disabled = hidden.disabled;
      retry.disabled = pending;
      options.disabled = pending;
    }

    function render() {
      toggle.textContent = state?.enabled ? '元の画面へ戻る' : '横並びを開始';
      toggle.setAttribute('aria-pressed', String(Boolean(state?.enabled)));
      node('pane-count').textContent = state ? `表示 ${state.visibleCount} / 全 ${state.totalCount} 列` : '接続できません';
      retry.hidden = Boolean(state);
      if (state) {
        equal.checked = state.equalizeColumns;
        width.max = String(state.maxWidth);
        width.value = String(state.paneWidth);
        node('width-help').textContent = `320〜${state.maxWidth} px。等分中は手動変更できません。`;
        const selected = hidden.value;
        hidden.replaceChildren();
        if (!state.hiddenPanes.length) {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = '隠した列はありません';
          hidden.appendChild(option);
        } else {
          for (const pane of state.hiddenPanes) {
            const option = document.createElement('option');
            option.value = pane.id;
            option.textContent = pane.title;
            hidden.appendChild(option);
          }
          hidden.value = state.hiddenPanes.some(pane => pane.id === selected) ? selected : state.hiddenPanes[0].id;
        }
      }
      updateDisabled();
    }

    async function command(action, data = {}, successMessage = '') {
      if (pending) return false;
      pending = true;
      updateDisabled();
      setStatus(action === 'status' ? '現在のタブに接続しています…' : '反映しています…');
      let response;
      try {
        const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs?.[0]?.id;
        if (!Number.isInteger(tabId) || tabId < 0) throw new Error('No active tab');
        response = await chromeApi.tabs.sendMessage(tabId, { type: 'CGWW_ACTION', action, ...data });
      } catch {
        state = null;
        setStatus(UNAVAILABLE, true);
        pending = false;
        render();
        return false;
      }
      let success = false;
      try {
        if (response?.ok === false) {
          const error = typeof response.error === 'string' ? response.error.trim().slice(0, 300) : '';
          setStatus(error || '操作できませんでした。もう一度お試しください。', true);
        } else {
          state = normalizeState(response);
          setStatus(successMessage || (state.enabled ? '横並び表示中です。' : '横並びは停止中です。開始すると列を操作できます。'));
          success = true;
        }
      } catch (error) {
        state = null;
        setStatus(error.message, true);
      } finally {
        pending = false;
        render();
      }
      return success;
    }

    toggle.addEventListener('click', () => {
      if (!state || pending) return;
      return command(state.enabled ? 'disable' : 'enable');
    });
    add.addEventListener('click', () => {
      if (!state?.enabled || pending) return;
      return command('add', {}, '右端に空の列を追加しました。');
    });
    equal.addEventListener('change', () => {
      if (!state?.enabled || pending) return;
      return command('equal', { value: equal.checked }, equal.checked ? '表示中の列を等分しました。' : '手動の列幅に戻しました。');
    });
    node('width-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!state?.enabled || pending || state.equalizeColumns) return;
      const value = Number(width.value);
      if (!width.value.trim() || !Number.isInteger(value) || value < 320 || value > state.maxWidth) {
        setStatus(`列幅は320〜${state.maxWidth}の整数で入力してください。`, true);
        width.focus();
        return;
      }
      return command('width', { value }, '列幅を変更しました。');
    });
    node('url-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (!state?.enabled || pending) return;
      const value = url.value.trim();
      if (!value || value.length > 2048) {
        setStatus('会話URLを2048文字以内で入力してください。', true);
        url.focus();
        return;
      }
      // The content handler is the authority for supported ChatGPT URL validation.
      if (await command('addUrl', { url: value }, '会話を右端に追加しました。')) url.value = '';
    });
    node('restore-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!state?.enabled || pending || !state.hiddenPanes.some(pane => pane.id === hidden.value)) return;
      return command('restore', { paneId: hidden.value }, '隠した列を戻しました。');
    });
    retry.addEventListener('click', () => command('status'));
    options.addEventListener('click', async () => {
      if (pending) return;
      pending = true;
      updateDisabled();
      try {
        await chromeApi.runtime.openOptionsPage();
        setStatus('その他の設定を開きました。');
      } catch { setStatus('設定画面を開けませんでした。拡張が有効か確認してください。', true); }
      finally { pending = false; updateDisabled(); }
    });
    void command('status');
    return { command };
  }

  const api = { normalizeState, mount, UNAVAILABLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else mount(root.document, root.chrome);
})(globalThis);
