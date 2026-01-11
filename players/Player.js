export default class Player {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.role = null;
    this.originalRole = null;
    this.vote = null;
  }

  setRole(role) {
    this.role = role;
    this.originalRole = role;
  }
}
