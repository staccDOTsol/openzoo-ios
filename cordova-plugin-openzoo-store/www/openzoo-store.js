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
    },
    debugBuild: function(success, error) {
        cordovaExec(success, error, 'OpenZooStore', 'debugBuild', []);
    },
    debugUnlock: function(email, success, error) {
        cordovaExec(success, error, 'OpenZooStore', 'debugUnlock', [email || '']);
    },
    debugUnlockStatus: function(success, error) {
        cordovaExec(success, error, 'OpenZooStore', 'debugUnlockStatus', []);
    }
};

module.exports = OpenZooStore;
