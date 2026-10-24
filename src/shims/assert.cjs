// Node's assert, as used by @babel/helper-module-imports when compiling cards in the browser
module.exports = function assert(value, message) {
  if (!value) throw new Error(message || "assertion failed");
};
