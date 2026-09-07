import * as daily from './daily.js';
import * as weekly from './weekly.js';
import * as streak from './streak.js';
import * as leaderboard from './leaderboard.js';
import * as history from './history.js';
import * as note from './note.js';
import * as noteSave from './note-save.js';
import * as setup from './setup.js';

export const commandModules = [daily, weekly, streak, leaderboard, history, note, noteSave, setup];

export const commandsByName = new Map(commandModules.map((m) => [m.data.name, m]));

export const modalHandlers = new Map(
  commandModules.filter((m) => m.modalPrefix).map((m) => [m.modalPrefix, m]),
);

export const buttonHandlers = new Map(
  commandModules.filter((m) => m.buttonPrefix).map((m) => [m.buttonPrefix, m]),
);

export const commandJSON = commandModules.map((m) => m.data.toJSON());
