import Role from './Role.js';

export default class Robber extends Role {
  constructor() {
    super('Robber', 3);
  }

  nightAction(game, player) {
    const target = game.players.find(p => p.id !== player.id);
    const temp = player.role;
    player.role = target.role;
    target.role = temp;

    game.log(player.id, `You swapped with ${target.name}. New role: ${player.role.name}`);
  }
}
