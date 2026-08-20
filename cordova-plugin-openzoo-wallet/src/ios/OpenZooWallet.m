#import "OpenZooWallet.h"
#import <Security/Security.h>
#import <UIKit/UIKit.h>

static NSString * const kOpenZooKeychainService = @"fun.openzoo.ios";

@implementation OpenZooWallet

- (NSMutableDictionary*)baseQuery:(NSString*)account {
    return [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kOpenZooKeychainService,
        (__bridge id)kSecAttrAccount: account
    } mutableCopy];
}

- (void)storeSecret:(CDVInvokedUrlCommand*)command {
    NSString *key = [command argumentAtIndex:0];
    NSString *value = [command argumentAtIndex:1];
    if (key.length == 0 || value == nil) {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"missing key or value"] callbackId:command.callbackId];
        return;
    }
    NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
    NSMutableDictionary *query = [self baseQuery:key];
    SecItemDelete((__bridge CFDictionaryRef)query);
    query[(__bridge id)kSecValueData] = data;
    query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    if (status == errSecSuccess) {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
    } else {
        NSString *msg = [NSString stringWithFormat:@"Keychain store failed (%d)", (int)status];
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:msg] callbackId:command.callbackId];
    }
}

- (void)loadSecret:(CDVInvokedUrlCommand*)command {
    NSString *key = [command argumentAtIndex:0];
    if (key.length == 0) {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"missing key"] callbackId:command.callbackId];
        return;
    }
    NSMutableDictionary *query = [self baseQuery:key];
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecItemNotFound) {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:@""] callbackId:command.callbackId];
        return;
    }
    if (status != errSecSuccess || result == NULL) {
        NSString *msg = [NSString stringWithFormat:@"Keychain load failed (%d)", (int)status];
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:msg] callbackId:command.callbackId];
        return;
    }
    NSData *data = CFBridgingRelease(result);
    NSString *value = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:value] callbackId:command.callbackId];
}

- (void)deleteSecret:(CDVInvokedUrlCommand*)command {
    NSString *key = [command argumentAtIndex:0];
    if (key.length == 0) {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"missing key"] callbackId:command.callbackId];
        return;
    }
    SecItemDelete((__bridge CFDictionaryRef)[self baseQuery:key]);
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
}

- (void)canOpenURL:(CDVInvokedUrlCommand*)command {
    NSString *urlString = [command argumentAtIndex:0];
    NSURL *url = [NSURL URLWithString:urlString ?: @""];
    BOOL installed = url != nil && [[UIApplication sharedApplication] canOpenURL:url];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{ @"installed": @(installed) }] callbackId:command.callbackId];
}

- (void)openURL:(CDVInvokedUrlCommand*)command {
    NSString *urlString = [command argumentAtIndex:0];
    NSURL *url = [NSURL URLWithString:urlString ?: @""];
    if (url == nil) {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"invalid url"] callbackId:command.callbackId];
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        [[UIApplication sharedApplication] openURL:url options:@{} completionHandler:^(BOOL success) {
            if (success) {
                [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
            } else {
                [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"system could not open url"] callbackId:command.callbackId];
            }
        }];
    });
}

- (void)copyToClipboard:(CDVInvokedUrlCommand*)command {
    NSString *text = [command argumentAtIndex:0];
    if (text == nil) {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"missing text"] callbackId:command.callbackId];
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        [UIPasteboard generalPasteboard].string = text;
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
    });
}

- (BOOL)isPhantomHandoffURL:(NSURL*)url {
    if (url == nil) {
        return NO;
    }
    NSString *scheme = url.scheme.lowercaseString;
    if ([scheme isEqualToString:@"phantom"]) {
        return YES;
    }
    if (![scheme isEqualToString:@"https"] && ![scheme isEqualToString:@"http"]) {
        return NO;
    }
    NSString *host = url.host.lowercaseString ?: @"";
    return [host isEqualToString:@"phantom.app"] || [host hasSuffix:@".phantom.app"];
}

- (void)handoffURL:(NSURL*)url {
    if (url == nil) {
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        [[UIApplication sharedApplication] openURL:url options:@{} completionHandler:nil];
    });
}

- (BOOL)shouldOverrideLoadWithRequest:(NSURLRequest*)request navigationType:(NSInteger)navigationType {
    NSURL *url = request.URL;
    if ([self isPhantomHandoffURL:url]) {
        [self handoffURL:url];
        return NO;
    }
    return YES;
}

@end
