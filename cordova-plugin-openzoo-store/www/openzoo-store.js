var cordovaExec = require('cordova/exec');

var OpenZooStore = {
    products: function(ids, success, error) {
        cordovaExec(success, error, 'OpenZooStore', 'products', [ids || []]);
    },
    purchase: function(productId, success, error) {
        cordovaExec(success, error, 'OpenZooStore', 'purchase', [productId]);
    },
    restore: function(success, error) {
        cordovaExec(success, error, 'OpenZooStore', 'restore', []);
    },
    entitlements: function(success, error) {
        cordovaExec(success, error, 'OpenZooStore', 'entitlements', []);
    }
};

module.exports = OpenZooStore;
