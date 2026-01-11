import Role from './Role.js';

export default class Seer extends Role {
  constructor() {
    super('Seer', 2);
  }

  nightAction(game, player) {
    const target = game.players.find(p => p.id !== player.id);
    game.log(player.id, `You saw: ${target.name} is ${target.role.name}`);
  }
}
