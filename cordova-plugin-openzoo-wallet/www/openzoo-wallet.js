var cordovaExec = require('cordova/exec');

var OpenZooWallet = {
    /**
     * Persist a secret string in the iOS Keychain.
     * @param {string} key
     * @param {string} value
     * @param {function} success
     * @param {function} error
     */
    storeSecret: function(key, value, success, error) {
        cordovaExec(success, error, 'OpenZooWallet', 'storeSecret', [key, value]);
    },

    /**
     * Load a secret string from the iOS Keychain.
     * Success is called with the string, or '' when missing.
     */
    loadSecret: function(key, success, error) {
        cordovaExec(success, error, 'OpenZooWallet', 'loadSecret', [key]);
    },

    deleteSecret: function(key, success, error) {
        cordovaExec(success, error, 'OpenZooWallet', 'deleteSecret', [key]);
    },

    /**
     * iOS canOpenURL for a scheme such as phantom://app
     * Success is called with { installed: boolean }.
     */
    canOpenURL: function(url, success, error) {
        cordovaExec(success, error, 'OpenZooWallet', 'canOpenURL', [url]);
    },

    /**
     * Open a URL with UIApplication (Phantom/Solflare universal links).
     */
    openURL: function(url, success, error) {
        cordovaExec(success, error, 'OpenZooWallet', 'openURL', [url]);
    }
};

module.exports = OpenZooWallet;
