export default class Role {
  constructor(name, order) {
    this.name = name;
    this.order = order;
  }

  nightAction(game, player) {
    // overridden by subclasses
  }
}
