export type RemotePlayback = { itemId: string; position: number; playing: boolean };
export type RemoteDevice = { id: string; name: string; playback: RemotePlayback | null };
export type RemoteAction = { action: 'start' | 'seek'; itemId: string; position: number } | { action: 'play' | 'pause'; itemId: string };
export type RemoteCommand = RemoteAction & { id: string };
export type RemoteState = { enabled: boolean; devices: RemoteDevice[]; error: string };
type Device = { id: string; key: string };
type Post = (path: string, body: unknown, timeout?: number) => Promise<unknown>;

export function createRemote({ post, playback, receive, changed }: {
  post: Post;
  playback: () => RemotePlayback | null;
  receive: (command: RemoteCommand) => Promise<void>;
  changed: (state: RemoteState) => void;
}) {
  let device: Device | null = null, label = '', run = 0, active = true;
  let state: RemoteState = { enabled: false, devices: [], error: '' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = (route: string, body: unknown, timeout?: number) => post('/api/remote/' + route, body, timeout);
  const update = (patch: Partial<RemoteState>) => { state = { ...state, ...patch }; changed(state); };
  const leave = (registration: Device) => { void call('leave', registration, 3000).catch(() => {}); };
  const join = async (name: string) => await call('join', { name }, 5000) as Device;

  async function deliver(registration: Device, command: RemoteCommand) {
    let ok = false;
    try { await receive(command); ok = true; } catch { /* The sender gets the failure. */ }
    if (device === registration) await call('result', { ...registration, commandId: command.id, ok }, 4000).catch(() => {});
  }

  async function poll(epoch: number) {
    if (epoch !== run || !label || !active) return;
    try {
      if (!device) {
        const registration = await join(label);
        if (epoch !== run) { leave(registration); return; }
        device = registration;
      }
      const registration = device;
      const result = await call('sync', { ...registration, playback: playback() }, 4500) as { devices: RemoteDevice[]; command: RemoteCommand | null };
      if (epoch !== run) return;
      update({ devices: result.devices, error: '' });
      if (result.command) void deliver(registration, result.command);
    } catch (error) {
      if (epoch !== run) return;
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) device = null;
      update({ devices: [], error: 'Could not reach connected devices. Retrying…' });
    }
    if (epoch === run) timer = setTimeout(() => void poll(epoch), 1250);
  }

  function disable() {
    run++; clearTimeout(timer); label = '';
    if (device) leave(device);
    device = null;
    update({ enabled: false, devices: [], error: '' });
  }

  return {
    state: () => state,
    async enable(name: string) {
      const epoch = ++run;
      const registration = await join(name);
      if (epoch !== run || !active) { leave(registration); return; }
      device = registration; label = name;
      update({ enabled: true, error: '' });
      void poll(epoch);
    },
    disable,
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      const epoch = ++run; clearTimeout(timer);
      if (value) void poll(epoch);
      else {
        if (device) leave(device);
        device = null;
        update({ devices: [], error: '' });
      }
    },
    async command(target: string, action: RemoteAction) {
      if (!device) throw new Error('Connect this device first.');
      await call('command', { ...device, target, ...action }, 23000);
    },
  };
}

export type RemoteController = ReturnType<typeof createRemote>;
