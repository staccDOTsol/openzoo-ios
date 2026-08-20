import Foundation
import StoreKit

@objc(OpenZooStore)
class OpenZooStore: CDVPlugin {
#if DEBUG
    private static let unlockDefaultsKey = "openzoo.debug.localUnlock"
    private static let unlockEmail = "jarettrsdunn1999@gmail.com"
#endif

    @objc(products:)
    func products(_ command: CDVInvokedUrlCommand) {
        let ids = (command.arguments.first as? [String]) ?? []
        Task {
            do {
                let found = try await Product.products(for: Set(ids))
                let rows: [[String: Any]] = found.map { product in
                    [
                        "id": product.id,
                        "displayName": product.displayName,
                        "displayPrice": product.displayPrice,
                        "price": NSDecimalNumber(decimal: product.price).doubleValue
                    ]
                }
                self.sendOk(command, rows)
            } catch {
                self.sendErr(command, error.localizedDescription)
            }
        }
    }

    @objc(purchase:)
    func purchase(_ command: CDVInvokedUrlCommand) {
        guard let productId = command.arguments.first as? String, !productId.isEmpty else {
            sendErr(command, "missing product id")
            return
        }
        Task {
            do {
                let found = try await Product.products(for: [productId])
                guard let product = found.first else {
                    self.sendErr(command, "App Store does not list \(productId)")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    let payload = try self.payload(from: verification)
                    if let transaction = try? verification.payloadValue {
                        await transaction.finish()
                    }
                    self.sendOk(command, payload)
                case .userCancelled:
                    self.sendErr(command, "Purchase cancelled")
                case .pending:
                    self.sendErr(command, "Purchase is pending approval")
                @unknown default:
                    self.sendErr(command, "Unknown purchase result")
                }
            } catch {
                self.sendErr(command, error.localizedDescription)
            }
        }
    }

    @objc(restore:)
    func restore(_ command: CDVInvokedUrlCommand) {
        Task {
            do {
                try await AppStore.sync()
            } catch {
                if !Self.isCancel(error) {
                    self.sendErr(command, error.localizedDescription)
                    return
                }
            }
            let rows = await self.currentEntitlements()
            self.sendOk(command, rows)
        }
    }

    @objc(entitlements:)
    func entitlements(_ command: CDVInvokedUrlCommand) {
        Task {
            let rows = await self.currentEntitlements()
            self.sendOk(command, rows)
        }
    }

    @objc(debugBuild:)
    func debugBuild(_ command: CDVInvokedUrlCommand) {
#if DEBUG
        sendOk(command, true)
#else
        sendOk(command, false)
#endif
    }

    @objc(debugUnlock:)
    func debugUnlock(_ command: CDVInvokedUrlCommand) {
#if DEBUG
        let raw = (command.arguments.first as? String) ?? ""
        let email = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard email == OpenZooStore.unlockEmail else {
            sendErr(command, "invalid")
            return
        }
        UserDefaults.standard.set(true, forKey: OpenZooStore.unlockDefaultsKey)
        sendOk(command, ["ok": true, "unlocked": true] as [String: Any])
#else
        sendErr(command, "unavailable")
#endif
    }

    @objc(debugUnlockStatus:)
    func debugUnlockStatus(_ command: CDVInvokedUrlCommand) {
#if DEBUG
        let unlocked = UserDefaults.standard.bool(forKey: OpenZooStore.unlockDefaultsKey)
        sendOk(command, ["unlocked": unlocked] as [String: Any])
#else
        sendOk(command, ["unlocked": false] as [String: Any])
#endif
    }

    @objc(testFlight:)
    func testFlight(_ command: CDVInvokedUrlCommand) {
#if DEBUG
        sendOk(command, false)
#else
        let isTestFlight = Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
        sendOk(command, isTestFlight)
#endif
    }

    private static func isCancel(_ error: Error) -> Bool {
        if let storeKit = error as? StoreKitError {
            if case .userCancelled = storeKit {
                return true
            }
        }
        if error is CancellationError {
            return true
        }
        let text = error.localizedDescription.lowercased()
        return text.contains("cancel")
    }

    private func currentEntitlements() async -> [[String: Any]] {
        var rows: [[String: Any]] = []
        for await entitlement in Transaction.currentEntitlements {
            if let payload = try? payload(from: entitlement) {
                rows.append(payload)
            }
        }
        return rows
    }

    private func payload(from verification: VerificationResult<Transaction>) throws -> [String: Any] {
        let transaction = try verification.payloadValue
        var row: [String: Any] = [
            "productId": transaction.productID,
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "jws": verification.jwsRepresentation
        ]
        if #available(iOS 16.0, *) {
            row["environment"] = String(describing: transaction.environment)
        }
        return row
    }

    private func sendOk(_ command: CDVInvokedUrlCommand, _ message: Any) {
        let result: CDVPluginResult
        if let flag = message as? Bool {
            result = CDVPluginResult(status: CDVCommandStatus_OK, messageAs: flag)
        } else if let dict = message as? [String: Any] {
            result = CDVPluginResult(status: CDVCommandStatus_OK, messageAs: dict)
        } else if let arr = message as? [Any] {
            result = CDVPluginResult(status: CDVCommandStatus_OK, messageAs: arr)
        } else {
            result = CDVPluginResult(status: CDVCommandStatus_OK, messageAs: String(describing: message))
        }
        commandDelegate.send(result, callbackId: command.callbackId)
    }

    private func sendErr(_ command: CDVInvokedUrlCommand, _ message: String) {
        commandDelegate.send(CDVPluginResult(status: CDVCommandStatus_ERROR, messageAs: message), callbackId: command.callbackId)
    }
}
