import Role from './Role.js';

export default class Troublemaker extends Role {
  constructor() {
    super('Troublemaker', 4);
  }

  nightAction(game, player) {
    const [a, b] = game.players.filter(p => p.id !== player.id);
    const temp = a.role;
    a.role = b.role;
    b.role = temp;

    game.log(player.id, `You swapped ${a.name} and ${b.name}`);
  }
}
