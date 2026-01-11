import Role from './Role.js';

export default class Insomniac extends Role {
  constructor() {
    super('Insomniac', 5);
  }

  nightAction(game, player) {
    game.log(player.id, `Your final role is ${player.role.name}`);
  }
}
