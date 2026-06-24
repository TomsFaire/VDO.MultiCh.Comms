'use strict';

// Channel types
const TYPE = Object.freeze({ PARTYLINE: 'partyline', DIRECT: 'direct' });

// Position modes: partylines are freely draggable; direct channels are pinned
const POSITION_MODE = Object.freeze({ FREE: 'free', FIXED: 'fixed' });

// Input source for the operator's outgoing audio on this channel
const INPUT_SOURCE = Object.freeze({
  DEDICATED: 'dedicated', // continuous hardware feed, no PTT
  SHARED_MIC: 'sharedMic', // gated by transmittingChannels (PTT / latch)
});

/**
 * Factory — creates a channel with required fields and sensible defaults.
 * @param {object} fields
 * @param {string}  fields.id          — stable channel ID (PL id string or direct channel UUID)
 * @param {string}  fields.label       — display name
 * @param {'partyline'|'direct'} [fields.type]
 * @param {'free'|'fixed'}       [fields.positionMode]
 * @param {number}  [fields.azimuth]   — degrees, -180..180 (0 = front, -90 = left, +90 = right)
 * @param {number}  [fields.elevation] — degrees, Day 2 only; default 0
 * @param {number}  [fields.volume]    — linear gain, default 1.0
 * @param {boolean} [fields.listening] — whether this channel is in the mix at all
 * @param {'dedicated'|'sharedMic'} [fields.inputSource]
 */
function createChannel(fields) {
  if (!fields.id) throw new Error('channel requires id');
  if (!fields.label) throw new Error('channel requires label');

  return {
    id: fields.id,
    label: fields.label,
    type: fields.type ?? TYPE.PARTYLINE,
    positionMode: fields.positionMode ?? (fields.type === TYPE.DIRECT ? POSITION_MODE.FIXED : POSITION_MODE.FREE),
    azimuth: fields.azimuth ?? 0,
    elevation: fields.elevation ?? 0,
    volume: fields.volume ?? 1.0,
    listening: fields.listening ?? true,
    inputSource: fields.inputSource ?? INPUT_SOURCE.SHARED_MIC,
  };
}

/**
 * Hydrate a channel from config — handles legacy configs that lack spatial fields.
 * A config.json line entry has: id, name, group, input_channel, output_channel, etc.
 */
function fromConfigLine(line) {
  return createChannel({
    id: String(line.id),
    label: line.name,
    type: TYPE.PARTYLINE,
    azimuth: line.azimuth ?? 0,
    volume: line.volume ?? 1.0,
    listening: line.listening ?? true,
    inputSource: line.inputSource ?? INPUT_SOURCE.SHARED_MIC,
  });
}

/**
 * Merge spatial state back into a config line entry for persistence.
 */
function toConfigLine(channel, existingLine) {
  return {
    ...existingLine,
    azimuth: channel.azimuth,
    volume: channel.volume,
    listening: channel.listening,
    inputSource: channel.inputSource,
  };
}

module.exports = { TYPE, POSITION_MODE, INPUT_SOURCE, createChannel, fromConfigLine, toConfigLine };
