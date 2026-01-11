
import Role from './Role.js';

export default class Werewolf extends Role {
  constructor() {
    super('Werewolf', 1);
  }

  nightAction(game, player) {
    const wolves = game.players
      .filter(p => p.role.name === 'Werewolf')
      .map(p => p.name);

    game.log(player.id, `Other werewolves: ${wolves.join(', ') || 'None'}`);
  }
}
