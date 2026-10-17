// 「発声」モード：1音・音程・フレーズの 3 種類を切り替えて使う入れ物

import { createMimicMode } from './mimic.js';
import { createPhraseMode } from './phrase.js';
import { getSettings, updateSettings } from '../settings.js';

export const MODE_ID = 'voice';

/**
 * @param {HTMLElement} root #mode-voice（.sub-switch・#voice-mimic・#voice-phrase を含む）
 */
export function createVoiceMode(root, hooks = {}) {
  const mimicRoot = root.querySelector('#voice-mimic');
  const phraseRoot = root.querySelector('#voice-phrase');
  const mimic = createMimicMode(mimicRoot, hooks);
  const phrase = createPhraseMode(phraseRoot, hooks);
  const buttons = root.querySelectorAll('.sub-switch button');
  let active = false;
  let current = null;

  function show(type) {
    current?.deactivate();
    if (type !== 'phrase') mimic.setType(type);
    current = type === 'phrase' ? phrase : mimic;
    mimicRoot.hidden = type === 'phrase';
    phraseRoot.hidden = type !== 'phrase';
    buttons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.voice === type)));
    updateSettings({ voiceType: type });
    if (active) current.activate();
  }

  buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.voice)));
  show(getSettings().voiceType);

  return {
    id: MODE_ID,
    activate() {
      active = true;
      current.activate();
    },
    deactivate() {
      active = false;
      current.deactivate();
    },
  };
}
