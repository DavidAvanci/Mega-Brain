import SwiftUI

struct DisplaySettings: Decodable, Equatable {
    var enabled = true
    var style = "detailed"
    var fontSize: CGFloat = 11
    var completionHeight: CGFloat = 54
    var maxHeight: CGFloat = 270
    var maxWidth: CGFloat = 660
    var taskSounds = true
    var monitorId: String? = nil
    var petAppearance = "auto"
    var petSize: CGFloat = 24
    var animations = true
    var animationSpeed: Double = 100
    var runningColor = "#64B8FF"
    var thinkingColor = "#B69CFF"
    var waitingColor = "#FFB454"
    var successColor = "#73D99A"
    var errorColor = "#FF7373"
    var autoExpandOnWaiting = true
    var compactOthers = true
    var showActivity = true
    var cornerRadius: CGFloat = 30
    var compactWidth: CGFloat = 480
    var hiddenCodexProfileIds: [String] = []
    var showProfileBadge = true

    init() {}

    enum CodingKeys: String, CodingKey {
        case enabled, style, fontSize, completionHeight, maxHeight, maxWidth, taskSounds, monitorId
        case petAppearance, petSize, animations, animationSpeed, runningColor, thinkingColor
        case waitingColor, successColor, errorColor, autoExpandOnWaiting, compactOthers, showActivity
        case cornerRadius, compactWidth, hiddenCodexProfileIds, showProfileBadge
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try values.decodeIfPresent(Bool.self, forKey: .enabled) ?? enabled
        style = try values.decodeIfPresent(String.self, forKey: .style) ?? style
        fontSize = try values.decodeIfPresent(CGFloat.self, forKey: .fontSize) ?? fontSize
        completionHeight = try values.decodeIfPresent(CGFloat.self, forKey: .completionHeight) ?? completionHeight
        maxHeight = try values.decodeIfPresent(CGFloat.self, forKey: .maxHeight) ?? maxHeight
        maxWidth = try values.decodeIfPresent(CGFloat.self, forKey: .maxWidth) ?? maxWidth
        taskSounds = try values.decodeIfPresent(Bool.self, forKey: .taskSounds) ?? taskSounds
        monitorId = try values.decodeIfPresent(String.self, forKey: .monitorId)
        petAppearance = try values.decodeIfPresent(String.self, forKey: .petAppearance) ?? petAppearance
        petSize = try values.decodeIfPresent(CGFloat.self, forKey: .petSize) ?? petSize
        animations = try values.decodeIfPresent(Bool.self, forKey: .animations) ?? animations
        animationSpeed = try values.decodeIfPresent(Double.self, forKey: .animationSpeed) ?? animationSpeed
        runningColor = try values.decodeIfPresent(String.self, forKey: .runningColor) ?? runningColor
        thinkingColor = try values.decodeIfPresent(String.self, forKey: .thinkingColor) ?? thinkingColor
        waitingColor = try values.decodeIfPresent(String.self, forKey: .waitingColor) ?? waitingColor
        successColor = try values.decodeIfPresent(String.self, forKey: .successColor) ?? successColor
        errorColor = try values.decodeIfPresent(String.self, forKey: .errorColor) ?? errorColor
        autoExpandOnWaiting = try values.decodeIfPresent(Bool.self, forKey: .autoExpandOnWaiting) ?? autoExpandOnWaiting
        compactOthers = try values.decodeIfPresent(Bool.self, forKey: .compactOthers) ?? compactOthers
        showActivity = try values.decodeIfPresent(Bool.self, forKey: .showActivity) ?? showActivity
        cornerRadius = try values.decodeIfPresent(CGFloat.self, forKey: .cornerRadius) ?? cornerRadius
        compactWidth = try values.decodeIfPresent(CGFloat.self, forKey: .compactWidth) ?? compactWidth
        hiddenCodexProfileIds = try values.decodeIfPresent([String].self, forKey: .hiddenCodexProfileIds) ?? hiddenCodexProfileIds
        showProfileBadge = try values.decodeIfPresent(Bool.self, forKey: .showProfileBadge) ?? showProfileBadge
    }

    func color(for state: String) -> Color {
        let hex: String
        switch state {
        case "thinking", "reading": hex = thinkingColor
        case "waiting": hex = waitingColor
        case "complete": hex = successColor
        case "error": hex = errorColor
        case "idle", "stopped": return Color(red: 0.57, green: 0.60, blue: 0.64)
        default: hex = runningColor
        }
        let number = UInt32(hex.dropFirst(), radix: 16) ?? 0x64B8FF
        return Color(red: Double((number >> 16) & 255) / 255,
                     green: Double((number >> 8) & 255) / 255, blue: Double(number & 255) / 255)
    }
}

struct LiveActivity: Decodable, Identifiable {
    var id: String { taskId }
    let taskId: String
    let cardId: String?
    let threadId: String?
    let project: String?
    let title: String
    let agent: String
    let status: String
    let activity: String?
    let stage: String?
    let checked: Int
    let total: Int
    let visualState: String?
    let question: String?
    let replyMode: String?
    var codexProfileId: String? = nil
    var codexProfileName: String? = nil
    var codexProfileColor: String? = nil
    var state: String { status == "stopped" ? "stopped" : visualState ?? (status == "running" ? "working" : status) }
    var stateLabel: String {
        switch state {
        case "thinking": return "Pensando"
        case "reading": return "Lendo"
        case "editing": return "Editando"
        case "testing": return "Testando"
        case "waiting": return "Aguardando resposta"
        case "complete": return "Concluído"
        case "error": return "Erro na execução"
        case "stopped": return "Interrompido"
        case "idle": return "Pronto"
        default: return "Trabalhando"
        }
    }
}

struct CodexProfile: Decodable, Identifiable {
    let id: String
    let name: String
    let home: String
    let color: String
}

struct IslandSnapshot: Decodable {
    var live: [LiveActivity]
    var recent: [LiveActivity]? = nil
    var display: DisplaySettings?
    var codexProfiles: [CodexProfile]? = nil
    var activeCodexProfileId: String? = nil
}

struct IslandReplyResult: Decodable {
    let delivery: String?
    let message: String?
    let error: String?
}
