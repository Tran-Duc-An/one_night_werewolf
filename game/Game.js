import { GameState } from './GameState.js';

export default class Game {
  constructor(players, roles) {
    this.players = players;
    this.roles = roles;
    this.centerRoles = [];
    this.state = GameState.SETUP;
    this.logs = [];
  }

  start() {
    this.assignRoles();
    this.state = GameState.NIGHT;
    this.runNight();
    this.state = GameState.DAY;
  }

  assignRoles() {
    const shuffled = [...this.roles].sort(() => Math.random() - 0.5);
    this.players.forEach((p, i) => p.setRole(shuffled[i]));
    this.centerRoles = shuffled.slice(this.players.length);
  }

  runNight() {
    const rolesInOrder = [...new Set(this.players.map(p => p.role))]
      .sort((a, b) => a.order - b.order);

    rolesInOrder.forEach(role => {
      this.players
        .filter(p => p.role.name === role.name)
        .forEach(p => role.nightAction(this, p));
    });
  }

  log(playerId, message) {
    this.logs.push({ playerId, message });
  }

  getLogsForPlayer(playerId) {
    return this.logs.filter(l => l.playerId === playerId);
  }
}
