import { createRemote } from '../../../packages/core/client/remote.ts';
import { api } from './http.js';
import { dialog, h } from './dom.js';

export function createRemoteUi(accountId) {
  let bridge, box, refresh, label = window.matroDesktop ? 'Desktop receiver' : 'Web browser';

  function attach(player) {
    bridge = createRemote({
      post: (path, body, timeout) => api('POST', path, body, { accountId, keepalive: path.endsWith('/leave'), signal: AbortSignal.timeout(timeout) }),
      playback: player.playback,
      receive: async command => {
        await player.receive(command);
        if (command.action === 'start') box?.close();
      },
      changed: () => refresh?.(),
    });
    window.addEventListener('pagehide', () => bridge.disable());
  }

  function open({ title, start, continueHere } = {}) {
    if (!bridge) return;
    // A dialog that is closed but not yet cleaned up must not swallow the next open.
    if (box?.el.open) return box.done;
    let busy = false, listKey = '', message = '';
    const status = h('p', { class: 'web-status', role: 'status' });
    const name = h('input', { maxLength: 48, value: label, autocomplete: 'off' });
    const select = h('select');
    const description = h('p', { class: 'muted' });
    const setup = h('div', { class: 'remote-device-field' }, h('label', {}, 'This device’s name', name));
    const peers = h('div', { class: 'remote-device-field' }, h('label', {}, 'Other device', select), description);
    const button = (text, run, primary = false) => h('button', {
      class: `pill${primary ? ' primary' : ''}`, type: 'button', onclick: () => void perform(run),
    }, text);
    const toggle = button('Enable remote playback', async () => {
      if (bridge.state().enabled) { bridge.disable(); return; }
      label = name.value.trim();
      await bridge.enable(label);
    });
    const target = () => bridge.state().devices.find(device => device.id === select.value);
    function send(action, delta = 0) {
      const device = target();
      if (!device?.playback) throw new Error('Select a device that has a title open.');
      const { itemId, position } = device.playback;
      return bridge.command(device.id, { action, itemId, ...(action === 'seek' ? { position: Math.max(0, position + delta) } : {}) });
    }
    const moveOut = start && button(start.label, async () => {
      const device = target(), transfer = start.snapshot();
      if (!device || !transfer) throw new Error('This playback is no longer available.');
      await bridge.command(device.id, { action: 'start', itemId: transfer.itemId, position: transfer.position });
      await transfer.pause?.();
      message = `Playing on ${device.name}.`;
    }, true);
    const moveHere = continueHere && button('Continue on this device', async () => {
      const device = target();
      if (!device?.playback) throw new Error('Select a device that has a title open.');
      await continueHere(device.playback);
      try {
        await bridge.command(device.id, { action: 'pause', itemId: device.playback.itemId });
        box?.close();
      } catch {
        throw new Error(`Playing here. Pause ${device.name} on that device.`);
      }
    }, !start);
    const controls = [
      button('Play', () => send('play')),
      button('Pause', () => send('pause')),
      button('Back 10 s', () => send('seek', -10)),
      button('Ahead 10 s', () => send('seek', 10)),
    ];
    const actions = h('div', { class: 'show-actions remote-device-actions' }, moveOut, moveHere, controls);
    async function perform(run) {
      if (busy) return;
      busy = true; render();
      try { message = ''; await run(); }
      catch (error) { message = error.message; }
      finally { busy = false; render(); }
    }
    function render() {
      const { enabled, devices, error } = bridge.state();
      const nextKey = JSON.stringify(devices.map(({ id, name }) => [id, name]));
      if (listKey !== nextKey) {
        listKey = nextKey;
        const previous = select.value;
        select.replaceChildren(...(devices.length ? devices.map(device => h('option', { value: device.id }, device.name))
          : [h('option', { value: '' }, 'No devices connected')]));
        if (devices.some(device => device.id === previous)) select.value = previous;
      }
      const selected = target();
      setup.hidden = enabled;
      toggle.textContent = enabled ? 'Disable remote playback' : 'Enable remote playback';
      peers.hidden = actions.hidden = !enabled;
      select.disabled = !devices.length;
      description.textContent = selected?.playback ? `${title?.(selected.playback.itemId) || 'Title open'} · ${selected.playback.playing ? 'Playing' : 'Paused'}`
        : selected ? 'Ready to play' : 'Enable remote playback on another device signed in to this account.';
      if (moveOut) moveOut.disabled = !selected;
      for (const control of [moveHere, ...controls]) if (control) control.disabled = !selected?.playback;
      for (const control of [toggle, moveOut, moveHere, ...controls]) if (control) control.setAttribute('aria-disabled', String(busy));
      status.textContent = busy ? 'Sending to Matro…' : message || error;
    }
    select.addEventListener('change', () => { message = ''; render(); });
    box = dialog('Connected devices', h('div', { class: 'remote-device' },
      h('p', { class: 'muted' }, 'Devices signed in to this Matro server can control playback here while remote playback is enabled.'),
      setup, toggle, peers, actions, status));
    refresh = render;
    render();
    const { done } = box, mine = box;
    void done.then(() => { if (box === mine) { box = null; refresh = null; } });
    return done;
  }

  return { attach, open, disable: () => bridge?.disable() };
}
