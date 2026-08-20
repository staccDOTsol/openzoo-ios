#import <Cordova/CDVPlugin.h>

@interface OpenZooWallet : CDVPlugin

- (void)storeSecret:(CDVInvokedUrlCommand*)command;
- (void)loadSecret:(CDVInvokedUrlCommand*)command;
- (void)deleteSecret:(CDVInvokedUrlCommand*)command;
- (void)canOpenURL:(CDVInvokedUrlCommand*)command;
- (void)openURL:(CDVInvokedUrlCommand*)command;
- (void)copyToClipboard:(CDVInvokedUrlCommand*)command;
- (void)httpRequest:(CDVInvokedUrlCommand*)command;
- (BOOL)shouldOverrideLoadWithRequest:(NSURLRequest*)request navigationType:(NSInteger)navigationType;

@end
