const ACTIONS = {
  GBA: [
    ['up', '上'], ['down', '下'], ['left', '左'], ['right', '右'],
    ['a', 'A'], ['b', 'B'], ['l', 'L'], ['r', 'R'], ['start', 'START'], ['select', 'SELECT']
  ],
  FC: [
    ['up', '上'], ['down', '下'], ['left', '左'], ['right', '右'],
    ['a', 'A'], ['b', 'B'], ['select', 'SELECT'], ['start', 'START']
  ],
  街机: [
    ['up', '上'], ['down', '下'], ['left', '左'], ['right', '右'],
    ['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D'], ['coin', '投币'], ['start', 'START']
  ]
};

const DEFAULTS = {
  GBA: {
    P1: {
      up: { key: 'ArrowUp', pad: 12 }, down: { key: 'ArrowDown', pad: 13 },
      left: { key: 'ArrowLeft', pad: 14 }, right: { key: 'ArrowRight', pad: 15 },
      a: { key: 'KeyX', pad: 0 }, b: { key: 'KeyZ', pad: 1 },
      l: { key: 'KeyQ', pad: 4 }, r: { key: 'KeyE', pad: 5 },
      start: { key: 'Enter', pad: 9 }, select: { key: 'ShiftLeft', pad: 8 }
    }
  },
  FC: {
    P1: {
      up: { key: 'ArrowUp', pad: 12 }, down: { key: 'ArrowDown', pad: 13 },
      left: { key: 'ArrowLeft', pad: 14 }, right: { key: 'ArrowRight', pad: 15 },
      a: { key: 'KeyZ', pad: 0 }, b: { key: 'KeyX', pad: 1 },
      select: { key: 'ShiftLeft', pad: 8 }, start: { key: 'Enter', pad: 9 }
    },
    P2: {
      up: { key: 'KeyW', pad: 12 }, down: { key: 'KeyS', pad: 13 },
      left: { key: 'KeyA', pad: 14 }, right: { key: 'KeyD', pad: 15 },
      a: { key: 'KeyG', pad: 0 }, b: { key: 'KeyH', pad: 1 },
      select: { key: 'KeyT', pad: 8 }, start: { key: 'KeyY', pad: 9 }
    }
  },
  街机: {
    P1: {
      up: { key: 'ArrowUp', pad: 12 }, down: { key: 'ArrowDown', pad: 13 },
      left: { key: 'ArrowLeft', pad: 14 }, right: { key: 'ArrowRight', pad: 15 },
      a: { key: 'KeyZ', pad: 0 }, b: { key: 'KeyX', pad: 1 },
      c: { key: 'KeyC', pad: 2 }, d: { key: 'KeyV', pad: 3 },
      coin: { key: 'KeyB', pad: 8 }, start: { key: 'Enter', pad: 9 }
    },
    P2: {
      up: { key: 'KeyW', pad: 12 }, down: { key: 'KeyS', pad: 13 },
      left: { key: 'KeyA', pad: 14 }, right: { key: 'KeyD', pad: 15 },
      a: { key: 'KeyG', pad: 0 }, b: { key: 'KeyH', pad: 1 },
      c: { key: 'KeyJ', pad: 2 }, d: { key: 'KeyK', pad: 3 },
      coin: { key: 'KeyT', pad: 8 }, start: { key: 'KeyY', pad: 9 }
    }
  }
};

const VALUES = {
  GBA: { up: 1, down: 2, left: 4, right: 8, a: 16, b: 32, l: 1024, r: 2048, start: 1 << 22, select: 1 << 23 },
  FC: { up: 1, down: 2, left: 4, right: 8, a: 16, b: 32, select: 1 << 23, start: 1 << 22 },
  街机: { up: 1, down: 2, left: 4, right: 8, a: 16, b: 32, c: 64, d: 128, coin: 1 << 23, start: 1 << 22 }
};

const KEY_LABELS = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'Shift', Space: 'Space',
  Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab', ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', MetaLeft: 'Cmd',
  MetaRight: 'Cmd', NumpadEnter: 'Enter'
};

function platformSlug(platform) {
  if (platform === '街机') return 'arcade';
  if (platform === 'FC') return 'fc';
  return 'gba';
}

export function actionsFor(platform) {
  return (ACTIONS[platform] || ACTIONS.GBA).map(([id, label]) => ({ id, label }));
}

export function playersFor(platform) {
  return platform === 'GBA' ? 1 : 2;
}

let gamepadAssignments = { platform: '', playerCount: 0, slots: [] };

export function assignGamepads(pads, { platform, playerCount }) {
  const connected = Array.from(pads || []).filter(pad => pad && pad.connected !== false);
  if (playerCount <= 1) {
    gamepadAssignments = { platform, playerCount: 1, slots: [] };
    return [connected[0] || null];
  }
  if (gamepadAssignments.platform !== platform || gamepadAssignments.playerCount !== playerCount) {
    gamepadAssignments = { platform, playerCount, slots: Array(playerCount).fill(null) };
  }
  const slots = gamepadAssignments.slots.slice();
  for (let index = 0; index < playerCount; index += 1) {
    const slot = slots[index];
    if (!slot) continue;
    const current = connected.find(pad => pad.index === slot.index);
    if (!current || (slot.id !== undefined && current.id !== slot.id)) slots[index] = null;
  }
  for (const pad of connected) {
    if (slots.some(slot => slot && slot.index === pad.index && slot.id === pad.id)) continue;
    const empty = slots.findIndex(slot => slot === null);
    if (empty < 0) break;
    slots[empty] = { index: pad.index, id: pad.id };
  }
  gamepadAssignments.slots = slots;
  return slots.map(slot => slot ? connected.find(pad => pad.index === slot.index && pad.id === slot.id) || null : null);
}

export function actionValues(platform, padSetting) {
  const values = { ...(VALUES[platform] || VALUES.GBA) };
  if (platform === '街机' && padSetting && Array.isArray(padSetting.BUTTONS)) {
    const names = { BUTTON_A: 'a', BUTTON_B: 'b', BUTTON_C: 'c', BUTTON_D: 'd' };
    for (const button of padSetting.BUTTONS) {
      const action = names[button.name];
      const value = Number(button.vaule);
      if (action && value > 0) values[action] = value;
    }
  }
  return values;
}

function cloneDefaults(platform) {
  return JSON.parse(JSON.stringify(DEFAULTS[platform] || DEFAULTS.GBA));
}

export function loadBindings(platform) {
  const defaults = cloneDefaults(platform);
  try {
    const stored = JSON.parse(localStorage.getItem(`ra:keys:${platformSlug(platform)}`) || 'null');
    if (!stored || typeof stored !== 'object') return defaults;
    for (const player of Object.keys(defaults)) {
      for (const action of Object.keys(defaults[player])) {
        const value = stored[player]?.[action];
        if (value && typeof value === 'object') {
          if (typeof value.key === 'string') defaults[player][action].key = value.key;
          if (Number.isInteger(value.pad)) defaults[player][action].pad = value.pad;
        }
      }
    }
  } catch {
    /* use defaults */
  }
  return defaults;
}

export function saveBindings(platform, bindings) {
  try {
    localStorage.setItem(`ra:keys:${platformSlug(platform)}`, JSON.stringify(bindings));
  } catch {
    /* private mode */
  }
}

export function resetBindings(platform) {
  try { localStorage.removeItem(`ra:keys:${platformSlug(platform)}`); } catch {}
  return cloneDefaults(platform);
}

export function keyLabel(code) {
  if (!code) return '未绑定';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F\d+$/.test(code)) return code;
  return code;
}

export function bindingLabel(binding) {
  const parts = [keyLabel(binding?.key)];
  if (Number.isInteger(binding?.pad)) parts.push(`手柄${binding.pad + 1}`);
  return parts.join(' · ');
}

export function maskForPlayer({
  platform,
  bindings,
  player,
  heldKeys,
  touchActions,
  pad,
  padIndex,
  values
}) {
  const playerBindings = bindings[player] || {};
  const actionValues = values || actionValues(platform);
  let mask = 0;
  for (const action of actionsFor(platform)) {
    const binding = playerBindings[action.id];
    if (!binding) continue;
    const pressed = heldKeys.has(binding.key)
      || touchActions.has(action.id)
      || Boolean(pad?.buttons?.[binding.pad]?.pressed);
    if (pressed) mask |= actionValues[action.id] || 0;
  }
  if (pad) {
    const axisX = pad.axes[0] || 0;
    const axisY = pad.axes[1] || 0;
    if (axisY < -0.55) mask |= actionValues.up;
    if (axisY > 0.55) mask |= actionValues.down;
    if (axisX < -0.55) mask |= actionValues.left;
    if (axisX > 0.55) mask |= actionValues.right;
  }
  return mask;
}

