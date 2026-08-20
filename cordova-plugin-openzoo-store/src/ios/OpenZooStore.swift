import Foundation
import StoreKit

@objc(OpenZooStore)
class OpenZooStore: CDVPlugin {
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
                let rows = await self.currentEntitlements()
                self.sendOk(command, rows)
            } catch {
                self.sendErr(command, error.localizedDescription)
            }
        }
    }

    @objc(entitlements:)
    func entitlements(_ command: CDVInvokedUrlCommand) {
        Task {
            let rows = await self.currentEntitlements()
            self.sendOk(command, rows)
        }
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
        return [
            "productId": transaction.productID,
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "jws": verification.jwsRepresentation,
            "environment": String(describing: transaction.environment)
        ]
    }

    private func sendOk(_ command: CDVInvokedUrlCommand, _ message: Any) {
        let result: CDVPluginResult
        if let dict = message as? [String: Any] {
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
