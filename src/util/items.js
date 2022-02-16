const Items = require('./items.json');
const Str = require('./string.js');

module.exports = {
    getName: function (id) {
        return Items[id].name;
    },

    getId: function (name) {
        return Object.keys(Items).find(key => Items[key].name === name);
    },

    getClosestItemIdByName: function (name, similarity = 0.9) {
        return Object.keys(Items).find(key => Str.similarity(Items[key].name, name) >= similarity);
    },
}
